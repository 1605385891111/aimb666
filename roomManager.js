// roomManager.js - 房间管理、回合制、行动点、断线自动跳过、重连
const aiService = require('./aiService');

const rooms = new Map(); // roomId -> room object

function getRoom(roomId) {
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    // 清除所有离线计时器
    for (const timeout of room.offlineTimeoutMap?.values() || []) {
      clearTimeout(timeout);
    }
  }
  rooms.delete(roomId);
}

// 添加用户或重连
function addUser(roomId, socketId, userName) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      users: new Map(),       // key: socketId (便于快速查找)
      usersByName: new Map(), // key: userName (用于重连)
      currentRoundMessages: [],
      worldSummary: '世界刚刚开始。一切都是未知的。',
      roundEndTime: null,
      roundTimer: null,
      activeVote: null,
      offlineTimeoutMap: new Map(), // userName -> timeout
    };
    rooms.set(roomId, room);
    startRound(roomId);
  }

  // 检查是否已有同名用户（用于重连）
  const existingUser = room.usersByName.get(userName);
  if (existingUser && existingUser.online) {
    return { success: false, error: '用户名已被使用' };
  }
  if (existingUser && !existingUser.online) {
    // 重连：恢复数据
    existingUser.socketId = socketId;
    existingUser.online = true;
    // 清除离线计时器
    const timeout = room.offlineTimeoutMap.get(userName);
    if (timeout) {
      clearTimeout(timeout);
      room.offlineTimeoutMap.delete(userName);
    }
    // 更新映射
    room.users.set(socketId, existingUser);
    return {
      success: true,
      actionPoints: existingUser.actionPoints,
      worldSummary: room.worldSummary,
      isReconnect: true,
    };
  }

  // 新用户
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
  };
  room.users.set(socketId, newUser);
  room.usersByName.set(userName, newUser);
  return {
    success: true,
    actionPoints: 3,
    worldSummary: room.worldSummary,
    isReconnect: false,
  };
}

// 用户断线（不删除数据，标记离线，并设置自动跳过计时器）
function userDisconnect(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const user = room.users.get(socketId);
  if (!user) return;
  user.online = false;
  // 如果本轮尚未行动且未跳过，设置5秒后自动跳过
  if (!user.hasActedThisRound && !user.skippedThisRound) {
    const timeout = setTimeout(() => {
      const stillRoom = rooms.get(roomId);
      if (stillRoom) {
        const stillUser = stillRoom.users.get(socketId);
        if (stillUser && !stillUser.online && !stillUser.hasActedThisRound) {
          stillUser.skippedThisRound = true;
          stillUser.hasActedThisRound = true;
          const io = global.io;
          if (io) {
            io.to(roomId).emit('system_message', { text: `${stillUser.userName} 因断线自动跳过了本轮。` });
          }
          checkRoundComplete(roomId);
        }
      }
    }, 5000);
    room.offlineTimeoutMap.set(user.userName, timeout);
  }
}

// 开始新的一轮
function startRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.roundTimer) clearTimeout(room.roundTimer);
  // 重置所有在线玩家的本轮行动标记
  for (const user of room.users.values()) {
    if (user.online) {
      user.hasActedThisRound = false;
      user.skippedThisRound = false;
    } else {
      // 离线玩家直接标记为已跳过（防止卡回合）
      if (!user.hasActedThisRound) {
        user.skippedThisRound = true;
        user.hasActedThisRound = true;
      }
    }
  }
  room.roundEndTime = Date.now() + 100 * 1000;
  room.roundTimer = setTimeout(() => {
    endRound(roomId);
  }, 100 * 1000);
  const io = global.io;
  if (io) {
    io.to(roomId).emit('round_start', { remaining: 100 });
  }
}

// 结束本轮：生成摘要，清空消息，开始下一轮
async function endRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.roundTimer) clearTimeout(room.roundTimer);
  // 强制标记所有在线未行动玩家为跳过（不扣行动点）
  for (const user of room.users.values()) {
    if (user.online && !user.hasActedThisRound) {
      user.hasActedThisRound = true;
      user.skippedThisRound = true;
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

// 检查是否所有在线玩家已完成本轮（用于提前结束）
function checkRoundComplete(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const onlineUsers = Array.from(room.users.values()).filter(u => u.online);
  const allActed = onlineUsers.every(u => u.hasActedThisRound === true);
  if (allActed && onlineUsers.length > 0) {
    endRound(roomId);
  }
}

module.exports = {
  getRoom,
  addUser,
  deleteRoom,
  userDisconnect,
  checkRoundComplete,
};