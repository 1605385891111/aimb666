// server.js - 服务器入口，处理房间、消息、回合
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
    callback({ success: true, actionPoints: result.actionPoints, worldSummary: result.worldSummary });

    socket.to(roomId).emit('user_joined', { userName });
    const room = roomManager.getRoom(roomId);
    if (room && room.roundEndTime) {
      const remaining = Math.max(0, Math.floor((room.roundEndTime - Date.now()) / 1000));
      socket.emit('round_time', { remaining });
    }
  });

  socket.on('send_message', async ({ roomId, message }, callback) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return callback({ error: '房间不存在' });
    const user = room.users.get(socket.id);
    if (!user) return callback({ error: '你不在房间中' });

    const isCommand = message.trim().startsWith('/');
    if (isCommand) {
      if (user.actionPoints <= 0) return callback({ error: '行动点不足' });
      if (user.hasActedThisRound) return callback({ error: '本轮已用过指令' });
      user.actionPoints--;
      user.hasActedThisRound = true;
      socket.emit('update_action_points', user.actionPoints);
    }

    room.currentRoundMessages.push({ userName: user.userName, content: message, timestamp: Date.now() });

    try {
      const aiReply = await require('./aiService').generateReply({
        worldSummary: room.worldSummary,
        roundMessages: room.currentRoundMessages,
        currentUserName: user.userName,
        userMessage: message,
        isCommand,
        actionPointsLeft: user.actionPoints
      });
      socket.emit('ai_reply', { reply: aiReply, isCommand });
    } catch (err) {
      console.error(err);
      socket.emit('ai_reply', { reply: '世界暂时无法回应。', isCommand });
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
    // 简化版投票逻辑，你可以后续完善
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const voter = room.users.get(socket.id);
    if (!voter || voter.userName === targetUserName) return;
    // 找到目标socketId
    let targetId = null;
    for (let [id, u] of room.users.entries()) {
      if (u.userName === targetUserName) { targetId = id; break; }
    }
    if (!targetId) return;
    if (!room.activeVote) {
      room.activeVote = { targetId, targetName: targetUserName, votes: new Set(), required: Math.floor(room.users.size * 2 / 3) };
    }
    room.activeVote.votes.add(socket.id);
    io.to(roomId).emit('vote_progress', { targetName: targetUserName, currentVotes: room.activeVote.votes.size, required: room.activeVote.required });
    if (room.activeVote.votes.size >= room.activeVote.required) {
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) targetSocket.emit('kicked');
      room.users.delete(targetId);
      io.to(roomId).emit('user_left', { userName: targetUserName });
      room.activeVote = null;
      roomManager.checkRoundComplete(roomId);
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room && room.users.has(socket.id)) {
      const userName = room.users.get(socket.id).userName;
      room.users.delete(socket.id);
      io.to(roomId).emit('user_left', { userName });
      if (room.users.size === 0) roomManager.deleteRoom(roomId);
      else roomManager.checkRoundComplete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`服务器运行在 http://localhost:${PORT}`));