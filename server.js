require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const roomManager = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
global.io = io;

function broadcastPlayers(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  const players = Array.from(room.users.values()).filter(u => u.online && !u.dead).map(u => u.userName);
  io.to(roomId).emit('player_list', players);
}

function markPlayerDead(roomId, userName, isSurrender = false) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  let user = null;
  for (let u of room.users.values()) {
    if (u.userName === userName) { user = u; break; }
  }
  if (user && !user.dead) {
    user.dead = true;
    user.online = false;
    if (user.socketId) {
      const targetSocket = io.sockets.sockets.get(user.socketId);
      if (targetSocket) targetSocket.emit('you_died', { reason: isSurrender ? '投降' : '游戏内死亡' });
    }
    io.to(roomId).emit('player_died', { userName, isSurrender });
    broadcastPlayers(roomId);
    checkGameOver(roomId);
  }
}

function checkGameOver(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  const alivePlayers = Array.from(room.users.values()).filter(u => !u.dead && u.online);
  if (alivePlayers.length <= 1) {
    const winner = alivePlayers.length === 1 ? alivePlayers[0].userName : null;
    endGame(roomId, winner);
  }
}

function endGame(roomId, winner) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('game_over', { winner });
  room.gameEnded = true;
}

io.on('connection', (socket) => {
  console.log('新连接:', socket.id);

  socket.on('join_room', ({ roomId, userName }, callback) => {
    const result = roomManager.addUser(roomId, socket.id, userName);
    if (!result.success) {
      callback({ error: result.error });
      socket.disconnect(true);
      return;
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName;
    callback({
      success: true,
      actionPoints: result.actionPoints,
      worldSummary: result.worldSummary,
      isReconnect: result.isReconnect,
      isOwner: result.isOwner
    });

    socket.to(roomId).emit('user_joined', { userName });
    broadcastPlayers(roomId);
    const room = roomManager.getRoom(roomId);
    if (room && room.gameStarted && room.roundEndTime) {
      const remaining = Math.max(0, Math.floor((room.roundEndTime - Date.now()) / 1000));
      socket.emit('round_time', { remaining });
    }
  });

  socket.on('player_ready', ({ roomId, ready }) => {
    roomManager.setPlayerReady(roomId, socket.id, ready);
  });

  socket.on('start_game', ({ roomId }) => {
    const result = roomManager.startGameByOwner(roomId, socket.id);
    if (!result.success) {
      socket.emit('start_game_error', { error: result.error });
    }
  });

  socket.on('public_message', ({ roomId, message }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    io.to(roomId).emit('public_message', { userName: user.userName, message, timestamp: Date.now() });
  });

  socket.on('send_message', async ({ roomId, message }, callback) => {
    const room = roomManager.getRoom(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }
    if (!room.gameStarted) {
      callback({ error: '游戏尚未开始，请等待房主开始。' });
      return;
    }
    const user = room.users.get(socket.id);
    if (!user || !user.online) {
      callback({ error: '你不在房间中或已离线' });
      return;
    }
    if (user.dead) {
      callback({ error: '你已经死亡，无法继续行动' });
      return;
    }

    const isCommand = message.trim().startsWith('/');
    if (isCommand) {
      if (user.actionPoints <= 0) {
        callback({ error: '行动点不足，无法执行指令' });
        return;
      }
      if (user.hasActedThisRound) {
        callback({ error: '本轮已经使用过指令，请等待下一轮' });
        return;
      }
      user.actionPoints--;
      user.hasActedThisRound = true;
      socket.emit('update_action_points', user.actionPoints);
      roomManager.checkRoundComplete(roomId);
    }

    room.currentRoundMessages.push({
      userName: user.userName,
      content: message,
      timestamp: Date.now()
    });

    try {
      const aiReply = await require('./aiService').generateReply({
        worldSummary: room.worldSummary,
        roundMessages: room.currentRoundMessages,
        currentUserName: user.userName,
        userMessage: message,
        isCommand,
        actionPointsLeft: user.actionPoints,
        roomUsers: Array.from(room.users.values()).map(u => ({ name: u.userName, dead: u.dead || false, online: u.online }))
      });
      socket.emit('ai_reply', { reply: aiReply.reply, isCommand, gameOver: aiReply.gameOver, winner: aiReply.winner });
      if (aiReply.playerDied && aiReply.playerDied === user.userName) {
        markPlayerDead(roomId, user.userName);
      }
      if (aiReply.gameOver) {
        endGame(roomId, aiReply.winner);
      }
    } catch (err) {
      console.error('AI回复错误:', err);
      socket.emit('ai_reply', { reply: '世界暂时无法回应，请稍后再试。', isCommand });
    }

    roomManager.checkRoundComplete(roomId);
    callback({ success: true });
  });

  socket.on('skip_round', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user || user.hasActedThisRound) return;
    user.skippedThisRound = true;
    user.hasActedThisRound = true;
    socket.emit('skip_confirmed');
    roomManager.checkRoundComplete(roomId);
  });

  socket.on('vote_kick', ({ roomId, targetUserName }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const voter = room.users.get(socket.id);
    if (!voter || voter.userName === targetUserName) return;
    let targetSocketId = null;
    for (let [id, u] of room.users.entries()) {
      if (u.userName === targetUserName) { targetSocketId = id; break; }
    }
    if (!targetSocketId) return;
    const totalUsers = room.users.size;
    const requiredVotes = Math.floor(totalUsers * 2 / 3);
    if (!room.activeVote) {
      room.activeVote = { targetId: targetSocketId, targetName: targetUserName, votes: new Set(), required: requiredVotes };
    }
    if (room.activeVote.targetId !== targetSocketId) {
      room.activeVote = { targetId: targetSocketId, targetName: targetUserName, votes: new Set(), required: requiredVotes };
    }
    room.activeVote.votes.add(socket.id);
    const currentVotes = room.activeVote.votes.size;
    io.to(roomId).emit('vote_progress', { targetName: targetUserName, currentVotes, required: requiredVotes, voters: Array.from(room.activeVote.votes).map(id => room.users.get(id)?.userName) });
    if (currentVotes >= requiredVotes) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.emit('kicked');
      room.users.delete(targetSocketId);
      io.to(roomId).emit('user_left', { userName: targetUserName });
      broadcastPlayers(roomId);
      room.activeVote = null;
      roomManager.checkRoundComplete(roomId);
    }
  });

  socket.on('surrender', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user || user.dead) return;
    markPlayerDead(roomId, user.userName, true);
    socket.emit('surrender_confirmed');
    socket.to(roomId).emit('system_message', { text: `${user.userName} 选择了投降，退出游戏。` });
    checkGameOver(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room && room.users.has(socket.id)) {
      const userName = room.users.get(socket.id).userName;
      room.users.delete(socket.id);
      io.to(roomId).emit('user_left', { userName });
      broadcastPlayers(roomId);
      if (room.users.size === 0) roomManager.deleteRoom(roomId);
      else roomManager.checkRoundComplete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`服务器运行在 http://localhost:${PORT}`));
