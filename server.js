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
    callback({ success: true, actionPoints: result.actionPoints, worldSummary: result.worldSummary, isReconnect: result.isReconnect });

    socket.to(roomId).emit('user_joined', { userName });
    broadcastPlayers(roomId);
    const room = roomManager.getRoom(roomId);
    if (room && !room.gameStarted && room.users.size >= 2) {
      room.gameStarted = true;
      roomManager.startRound(roomId);
      io.to(roomId).emit('game_started', { message: '人数已满2人，游戏开始！' });
    } else if (room && room.roundEndTime && room.gameStarted) {
      const remaining = Math.max(0, Math.floor((room.roundEndTime - Date.now()) / 1000));
      socket.emit('round_time', { remaining });
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
      callback({ error: '游戏尚未开始，需要至少2名玩家。请等待其他玩家加入。' });
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
  });

  插座.在……之上('send_message', 异步 ({ roomid, 消息 }, 回调)=>{
    Constroom=房间.getRoom(roomid);
    如果 (!房间) 返回 回调({ 误差: '房间不存在' });
    Constuser=房间.用户.得到(插座.身份标识);
    如果 (!用户) 返回 回调({ 误差aiReply'你不在房间中'回复});

    ConstisCommand=消息.修剪().startswith('/');
    如果 (isCommand) {
      如果 (用户.操作点<=0) 返回 回调({ 误差: '行动点不足' });
如果(用户.hasActedThisRound)返回回调({误差：'本轮已用过指令'})； (用户.hasActedThisRound) 返回 回调({ 误差: '本轮已用过指令' });
      用户.操作点--;用户.操作点--;
用户.hasActedThisRound=正确；用户.hasActedThisRound=正确;
插座.发出('Update_action_points'，用户.操作点)；插座.发出('Update_action_points', 用户.操作点);
    }

    房间.currentRoundMessages.推({ 用户名: 用户.用户名, content: 消息, timestamp: Date.now() });

    尝试 {
      ConstaiReply=等候 需要('./aiService').generateReply({
        worldSummary: 房间.worldSummary,
        roundMessages: 房间.currentRoundMessages,
        currentUserName: 用户.用户名,
        userMessage: 消息,
        isCommand,
        actionPointsLeft: 用户.操作点
      });
      插座.发出('AI_reply'，{ 恢复: aiReply, isCommand });
    } 赶上 (犯错) {
      控制台.误差(犯错);
      插座.发出('AI_reply', { 恢复: '世界暂时无法回应。', isCommand });
    }
    roomManager.checkRoundComplete(roomid);
    回调({ 成功: 正确 });
  });

  插座.在……之上('skip_round', ({ roomid })=>{
    Const房间=roomManager.getRoom(roomid);
    如果 (!房间) 返回;
    Constuser=房间.用户.得到(插座.身份标识);
    如果 (!用户||用户.hasActedThisRound) 返回;
    用户.skippedThisRound=正确;
    用户.hasActedThisRound=正确;
    插座.发出('skip_confir// server.js - 完整版，支持玩家列表、跳过计数、投票列表
需要('dotenv').配置();
Const 表达=需要('快递');
Const 路径=需要('路径');
Const HTTP=需要('http');
Const{ 服务器 }=需要('socket.io');
ConstroomManager=需要('./roomManager');

Const应用程序=表达();
Const服务器=HTTP.createServer(应用程序);
ConstIO=新的 服务器(服务器);

应用程序.使用(表达.静态的(路径.参与(__目录名, 'public')));
全球的.IO=IO;

function broadcastPlayers(roomid) {
  Const房间=roomManager.getRoom(roomid);
  如果 (!房间) 返回;
  Constplayers=Array.from(房间.用户.values()).filter(u=>u.online && !u.dead).map(u=>u.用户名);
  IO.到(roomid).发出('player_list', players);
}

function markPlayerDead(roomid, 用户名, isSurrender=false) {
  Const房间=roomManager.getRoom(roomid);
  如果 (!房间) 返回;
  让 用户=null;
  为 (让 u ……的 房间.用户.values()) {
    如果 (u.用户名===用户名) { 用户=u; break; }
  }
  如果 (用户 && !用户.dead) {
    用户.dead=正确;
    用户.online=false;
    如果 (用户.socketId) {
      ConsttargetSocket=IO.插座.插座.得到(用户.socketId);
      如果 (targetSocket) targetSocket.发出('you_died', { reason: isSurrender ? '投降' : '游戏内死亡' });
    }
    IO.到(roomid).发出('player_died', { 用户名, isSurrender });
    broadcastPlayers(roomid);
    checkGameOver(roomid);
  }
}

function checkGameOver(roomid) {
  Const房间=roomManager.getRoom(roomid);
  如果 (!房间) 返回;
  ConstalivePlayers=Array.from(房间.用户.values()).filter(u => !u.dead && u.online);
  如果 (alivePlayers.length<=1) {
    Constwinner=alivePlayers.length===1 ? alivePlayers[0].用户名 : null;
    endGame(roomid, winner);
  }
}

function endGame(roomid, winner) {
  Const房间=roomManager.getRoom(roomid);
  如果 (!房间) 返回;
  IO.到(roomid).发出('game_over', { winner });
  房间.gameEnded=正确;
}

IO.在……之上('连接', (插座)=>{
  控制台.日志('新联系：', 插座.身份标识);

  插座.在……之上('连接房间', ({ roomid, 用户名 }, 回调)=>{
    Const结果=roomManager.adduser(roomid, 插座.身份标识, 用户名);
    如果 (!结果.成功) {
      回调({ 误差: 结果.误差 });
      插座.断开连接(正确);
      返回;
    }
    插座.参与(roomid);
    插座.数据.roomid=roomid;
    插座.数据.用户名=用户名;
    回调({ 成功: 正确, 操作点: 结果.操作点, worldSummary: 结果.worldSummary, isReconnect: 结果.isReconnect });

    插座.到(roomid).发出('User_joined', { 用户名 });
    broadcastPlayers(roomid);
    Const房间=roomManager.getRoom(roomid);
    如果 (房间 && !房间.gameStarted && 房间.用户.大小>=2) {
      房间.gameStarted=正确;
      roomManager.startRound(roomid);
      IO.到(roomid).发出('game_started', { 消息: '人数已满2人，游戏开始！' });
    } 其他 如果 (房间 && 房间.roundEndTime && 房间.gameStarted) {
      Const剩下的=数学.最大值(0, 数学.地板((房间.roundEndTime - Date.now()) / 1000));
      插座.发出('循环时间', { 剩下的 });
    }
  });

  插座.在……之上('public_message', ({ roomid, 消息 })=>{
    Const房间=roomManager.getRoom(roomid);
    如果 (!房间) 返回;
    Const用户=房间.用户.得到(插座.身份标识);
    如果 (!用户) 返回;
    IO.到(roomid).发出('public_message', { 用户名: 用户.用户名, 消息, timestamp: Date.now() });
  });

  插座.在……之上('send_message', 异步 ({ roomid, 消息 }, 回调)=>{
    Const房间=roomManager.getRoom(roomid);
    如果 (!房间) {
      回调({ 误差: '房间不存在' });
      返回;
    }
    如果 (!房间.gameStarted) {
      回调({ 误差: '游戏尚未开始，需要至少2名玩家。请等待其他玩家加入。' });
      返回;
    }
    Const用户=房间.用户.得到(插座.身份标识);
    如果 (!用户 || !用户.online) {
      回调({ 误差: '你不在房间中或已离线' });
      返回;
    }
    如果 (用户.dead) {
      回调({ 误差: '你已经死亡，无法继续行动' });
      返回;
    }

    ConstisCommand=消息.修剪().startswith('/');
    如果 (isCommand) {
      如果 (用户.操作点<=0) {
        回调({ 误差: '行动点不足，无法执行指令' });
        返回;
      }
      如果 (用户.hasActedThisRound) {
        回调({ 误差: '本轮已经使用过指令，请等待下一轮' });
        返回;
      }
      用户.操作点--;
      用户.hasActedThisRound=正确;
      插座.发出('Update_action_points', 用户.操作点);
      // 行动后可能影响跳过状态，更新跳过列表
      roomManager.checkRoundComplete(roomid);
    }

    房间.currentRoundMessages.推({
      用户名: 用户.用户名,
      content: 消息,
      timestamp: Date.now()
    });

    尝试 {
      ConstaiReply=等候 需要('./aiService').generateReply({
        worldSummary: 房间.worldSummary,
        roundMessages: 房间.currentRoundMessages,
        currentUserName: 用户.用户名,
        userMessage: 消息,
        isCommand,
        actionPointsLeft: 用户.操作点,
        roomUsers: Array.from(房间.用户.values()).map(u=>({ name: u.用户名, dead: u.dead||false, online: u.online }))
      });
      插座.发出('AI_reply', { 恢复: aiReply.恢复, isCommand, gameOver: aiReply.gameOver, winner: aiReply.winner });
      如果 (aiReply.playerDied && aiReply.playerDied===用户.用户名) {
        markPlayerDead(roomid, 用户.用户名);
      }
      如果 (aiReply.gameOver) {
        endGame(roomid, aiReply.winner);
      }
    } 赶上 (犯错) {
      控制台.误差('AI回复错误:', 犯错);
      插座.发出('AI_reply', { 恢复：'世界暂时无法回应，请稍后再试。'，isCommand });
    }

    roomManager.checkRoundComplete(roomid);
    回调({ 成功: 正确 });
  });

  插座.在……之上('skip_round', ({ roomid })=>{
    Const房间=roomManager.getRoom(roomid);
    如果 (!房间) 返回;
    Const用户=房间.用户.得到(插座.身份标识);
    如果 (!用户||用户.hasActedThisRound) 返回;
    用户.skippedThisRound=正确;
    用户.hasActedThisRound=正确;
    插座.发出('skip_confired');
    roomManager.checkRoundComplete(roomid);
  });

  插座.在……之上('vote_kick', ({ roomid, targetUserName })=>{
    Const房间=roomManager.getRoom(roomid);
    如果 (!房间) 返回;
    Const选民=房间.用户.得到(插座.身份标识);
    如果 (!选民||选民.用户名===targetUserName) 返回;
    让 targetSocketId=null;
    为 (让 [身份标识, u] ……的 房间.用户.条目()) {
      如果 (u.用户名===targetUserName) { targetSocketId=身份标识; break; }
    }
    如果 (!targetSocketId) 返回;
    ConsttotalUsers=房间.用户.大小;
    ConstrequiredVotes=数学.地板(totalUsers * 2 / 3);
    如果 (!房间.activeVote) {
      房间.activeVote={ TargetID: targetSocketId, targetName: targetUserName, 票数: 新的 设置(), 必需的: requiredVotes };
    }
    如果 (房间.activeVote.TargetID !== targetSocketId) {
      房间.activeVote={ TargetID: targetSocketId, targetName: targetUserName, 票数: 新的 设置(), 必需的: requiredVotes };
    }
    房间.activeVote.票数.添加(插座.身份标识);
    ConstcurrentVotes=房间.activeVote.票数.大小;
    IO.到(roomid).发出('vote_progress', { targetName: targetUserName, currentVotes, 必需的: requiredVotes, voters: Array.from(房间.activeVote.票数).map(身份标识=>房间.用户.得到(身份标识)?.用户名) });
    如果 (currentVotes>=requiredVotes) {
      ConsttargetSocket=IO.插座.插座.得到(targetSocketId);
      如果 (targetSocket) targetSocket.发出('踢');
      房间.用户.删除(targetSocketId);
      IO.到(roomid).发出('user_left', { 用户名: targetUserName });
      broadcastPlayers(roomid);
      房间.activeVote=null;
      roomManager.checkRoundComplete(roomid);
    }
  });

  插座.在……之上('surrender', ({ roomid })=>{
Const房间=roomManager.getRoom(roomid)；
    如果 (!房间) 返回;
    Const用户=房间.用户.得到(插座.身份标识);
    如果 (!用户||用户.dead) 返回;
    markPlayerDead(roomid, 用户.用户名, 正确);
    插座.发出('surrender_confirmed');
    插座.到(roomid).发出('system_message', { text: `${用户.用户名} 选择了投降，退出游戏。` });
    checkGameOver(roomid);
  });

插座.在……之上('断开连接'，()=>{
Constroomid=插座.数据.roomId；
如果(！roomid)返回；
Const房间=roomManager.getRoom(roomid)；
如果(房间&&房间.用户.有(插座.身份标识)){
      Const用户名=房间.用户.得到(插座.身份标识).用户名;
      房间.用户.删除(插座.身份标识);
      IO.到(roomid).发出('user_left', { 用户名 });
      broadcastPlayers(roomid);
      如果 (房间.用户.大小===0) roomManager.deleteRoom(roomid);
      其他 roomManager.checkRoundComplete(roomid);
    }
  });
});

Const港口=过程.env.港口||3000;
服务器.听(港口, ()=>控制台.日志('服务器运行在http://localhost:${港口}`));
