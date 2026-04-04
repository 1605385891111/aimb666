//server.js-服务器入口，处理房间、消息、回合
需要('dotenv').配置();
Const表达=需要('快递');
const路径=需要('路径');
ConstHTTP=需要('http');
Const{ 服务器 }=需要('socket.io');
ConstroomManager=需要('./roomManager');

Const应用程序=表达();
Const服务器=HTTP.createServer(应用程序);
ConstIO=新的 服务器(服务器);

应用程序.使用(表达.静态的(路径.参与(__目录名, 'public')));
全球的.IO=IO;

IO.在……之上('连接', (插座)=>{
  控制台.日志('新联系：', 插座.身份标识);

  插座.在……之上('连接房间'，({ roomid, 用户名 }, 回调)=>{
    Const结果=roomManager.adduser(roomid, 插座.身份标识, 用户名);
    如果 (!结果.成功) {
      回调({ 误差: 结果.误差 });
      插座.断开连接(正确);
      返回;
    }
    插座.参与(roomid);
    插座.数据.roomid=roomid;
    插座.数据.用户名=用户名;
    回调({ 成功: 正确, 操作点: 结果.操作点, worldSummary: 结果.worldSummary });

    插座.到(roomid).发出('User_joined', { 用户名 });
    Const房间=roomManager.getRoom(roomid);
    如果 (房间 && 房间.roundEndTime) {
      Const剩下的=数学.最大值(0, 数学.地板((房间.roundEndTime - Date.now()) / 1000));
      插座.发出('循环时间', { 剩下的 });
    }
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
