const aiService = require('./aiService');

const rooms = new Map();

function getRoom(roomId) {
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    for (const timeout of room.offlineTimeoutMap?.values() || []) {
      clearTimeout(timeout);
    }
  }
  rooms.delete(roomId);
}

function addUser(roomId, socketId, userName) {
  let room = rooms.get(roomId);
  const isFirstUser = !room;

  if (!room) {
    room = {
      users: new Map(),
      usersByName: new Map(),
      currentRoundMessages: [],
      worldSummary: '世界刚刚开始。一切都是未知的。',
      roundEndTime: null,
      roundTimer: null,
      activeVote: null,
      offlineTimeoutMap: new Map(),
      gameStarted: false,
      ownerId: socketId,
      playersReady: new Set(),
    };
    rooms.set(roomId, room);
  }

  const existingUser = room.usersByName.get(userName);
  if (existingUser && existingUser.online) {
    return { success: false, error: '用户名已被使用' };
  }
  if (existingUser && !existingUser.online) {
    existingUser.socketId = socketId;
    existingUser.online = true;
    existingUser.ready = false;
    const timeout = room.offlineTimeoutMap.get(userName);
    if (timeout) {
      clearTimeout(timeout);
      room.offlineTimeoutMap.delete(userName);
    }
    room.users.set(socketId, existingUser);
    return {
      success: true,
      actionPoints: existingUser.actionPoints,
      worldSummary: room.worldSummary,
      isReconnect: true,
      isOwner: room.ownerId === socketId,
    };
  }

  if (room.users.size >= 8) {
    return { success: false, error: '房间已满（最多8人）' };
  }

  const newUser = {
    socketId,
    userName,
    actionPoints: 3,
    hasActedThisRound: false,
    skippedThisRound: false,
    online: true,
    dead: false,
    ready: false,
  };
  room.users.set(socketId, newUser);
  room.usersByName.set(userName, newUser);

  const io = global.io;
  if (io && !room.gameStarted) {
    io.to(roomId).emit('player_ready_update', {
      readyList: getReadyNames(roomId),
      allReady: checkAllReady(roomId),
      ownerId: room.ownerId,
    });
  }

  return {
    success: true,
    actionPoints: 3,
    worldSummary: room.worldSummary,
    isReconnect: false,
    isOwner: room.ownerId === socketId,
  };
}

function getReadyNames(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const readyNames = [];
  for (const user of room.users.values()) {
    if (user.online && user.ready) {
      readyNames.push(user.userName);
    }
  }
  return readyNames;
}

function checkAllReady(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  const onlineUsers = Array.from(room.users.values()).filter(u => u.online);
  if (onlineUsers.length === 0) return false;
  return onlineUsers.every(u => u.ready === true);
}

function setPlayerReady(roomId, socketId, isReady) {
  const room = rooms.get(roomId);
  if (!room) return false;
  const user = room.users.get(socketId);
  if (!user) return false;
  user.ready = isReady;
  const io = global.io;
  if (io && !room.gameStarted) {
    io.to(roomId).emit('player_ready_update', {
      readyList: getReadyNames(roomId),
      allReady: checkAllReady(roomId),
      ownerId: room.ownerId,
    });
  }
  return true;
}

function startGameByOwner(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: '房间不存在' };
  if (room.ownerId !== socketId) return { success: false, error: '只有房主可以开始游戏' };
  if (!checkAllReady(roomId)) return { success: false, error: '还有玩家未准备' };
  if (room.gameStarted) return { success: false, error: '游戏已经开始' };
  if (room.users.size < 2) return { success: false, error: '至少需要2名玩家' };

  room.gameStarted = true;
  startRound(roomId);
  const io = global.io;
  if (io) {
    io.to(roomId).emit('game_started', { message: '游戏开始！' });
  }
  return { success: true };
}

function userDisconnect(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const user = room.users.get(socketId);
  if (!user) return;
  user.online = false;
  room.playersReady.delete(socketId);
  const io = global.io;
  if (io && !room.gameStarted) {
    io.to(roomId).emit('player_ready_update', {
      readyList: getReadyNames(roomId),
      allReady: checkAllReady(roomId),
      ownerId: room.ownerId,
    });
  }
  if (!room.gameStarted) return;

  if (!user.hasActedThisRound && !user.skippedThisRound && !user.dead) {
    const timeout = setTimeout(() => {
      const stillRoom = rooms.get(roomId);
      if (stillRoom) {
        const stillUser = stillRoom.users.get(socketId);
        if (stillUser && !stillUser.online && !stillUser.hasActedThisRound && !stillUser.dead) {
          stillUser.skippedThisRound = true;
          stillUser.hasActedThisRound = true;
          if (io) {
            io.to(roomId).emit('system_message', { text: `${stillUser.userName} 因断线自动跳过了本轮。` });
            const skippers = getSkipperNames(roomId);
            io.to(roomId).emit('skip_update', { skippers });
          }
          checkRoundComplete(roomId);
        }
      }
    }, 5000);
    room.offlineTimeoutMap.set(user.userName, timeout);
  }
}

function getSkipperNames(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const skippers = [];
  for (const user of room.users.values()) {
    if (user.online && !user.dead && user.skippedThisRound) {
      skippers.push(user.userName);
    }
  }
  return skippers;
}

function startRound(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.gameStarted) return;
  if (room.roundTimer) clearTimeout(room.roundTimer);
  for (const user of room.users.values()) {
    if (user.online && !user.dead) {
      user.hasActedThisRound = false;
      user.skippedThisRound = false;
    } else if (!user.online && !user.dead) {
      user.skippedThisRound = true;
      user.hasActedThisRound = true;
    }
  }
  room.roundEndTime = Date.now() + 100 * 1000;
  room.roundTimer = setTimeout(() => endRound(roomId), 100 * 1000);
  const io = global.io;
  if (io) {
    io.to(roomId).emit('round_start', { remaining: 100 });
    io.to(roomId).emit('skip_update', { skippers: [] });
  }
}

async function endRound(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.gameStarted) return;
  if (room.roundTimer) clearTimeout(room.roundTimer);
  for (const user of room.users.values()) {
    if (user.online && !user.dead && !user.hasActedThisRound) {
      user.hasActedThisRound = true;
      user.skippedThisRound = true;
    }
    if (user.online && !user.dead) {
      user.actionPoints = 3;
    }
  }
  if (room.currentRoundMessages.length > 0) {
    try {
      const newSummary = await aiService.generateSummary({
        oldSummary: room.worldSummary,
        roundMessages: room.currentRoundMessages,
      });
      room.worldSummary = newSummary;
    } catch (err) {
      console.error('生成摘要失败:', err);
    }
  }
  room.currentRoundMessages = [];
  startRound(roomId);
}

function checkRoundComplete(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.gameStarted) return;
  const aliveOnline = Array.from(room.users.values()).filter(u => !u.dead && u.online);
  const allActed = aliveOnline.every(u => u.hasActedThisRound);
  if (allActed && aliveOnline.length > 0) {
    endRound(roomId);
  } else {
    const io = global.io;
    if (io) {
      const skippers = getSkipperNames(roomId);
      io.to(roomId).emit('skip_update', { skippers });
    }
  }
}

module.exports = {
  getRoom,
  addUser,
  deleteRoom,
  userDisconnect,
  checkRoundComplete,
  startRound,
  setPlayerReady,
  startGameByOwner,
};
