// roomManager.js - 每轮结束重置在线玩家的行动点为3
Const aiService=需要('./aiService');

Const 房间=新的 Map();

功能 getRoom(roomid) {
  返回 房间.得到(roomid);
}

功能 deleteRoom(roomid) {
  Const 房间=房间.得到(roomid);
  如果 (房间) {
    如果 (房间.roundTimer) clearTimeout(房间.roundTimer);
    为 (Const 超时 ……的 房间.offlineTimeoutMap?.值()||[]) {
      clearTimeout(超时);
    }
  }
  房间.删除(roomid);
}

功能 adduser(roomid, socketId, 用户名) {
  让 房间=房间.得到(roomid);
  如果 (!房间) {
    房间={
      用户: 新的 Map(),
      usersbyname: 新的 Map(),
      currentRoundMessages: [],
      worldSummary: '世界刚刚开始。一切都是未知的。',
      roundEndTime: null,
      roundTimer: null,
      activeVote: null,
      offlineTimeoutMap: 新的 Map(),
      gameStarted: 假的,
    };
    房间.设置(roomid, 房间);
  }
  // 重连逻辑
  Const existingUser=房间.usersbyname.得到(用户名);
  如果 (existingUser && existingUser.在线) {
    返回 { 成功: 假的, 误差: '用户名已被使用' };
  }
  如果 (existingUser && !existingUser.在线) {
    existingUser.socketId=socketId;
    existingUser.在线=正确;
    Const 超时=房间.offlineTimeoutMap.得到(用户名);
    如果 (超时) {
      clearTimeout(超时);
      房间.offlineTimeoutMap.删除(用户名);
    }
    房间.用户.设置(socketId, existingUser);
    返回 {
      成功: 正确,
      操作点: existingUser.操作点,
      worldSummary: 房间.worldSummary,
      isReconnect: 正确,
    };
  }
  如果 (房间.用户.大小>=8) {
    返回 { 成功: 假的, 误差: '房间已满（最多8人）' };
  }
  Constnewuser={
    socketId,
    用户名,
    操作点: 3,
    hasActedThisRound: 假的,
    skippedThisRound: 假的,
    在线: 正确,
    死亡的: 假的,
  };
  房间.用户.设置(socketId, newuser);
  房间.usersbyname.设置(用户名, newuser);
  返回 {
    成功: 正确,
    操作点: 3,
    worldSummary: 房间.worldSummary,
    isReconnect: 假的,
  };
}

功能 userDisconnect(roomid, socketId) {
  Const房间=房间.得到(roomid);
  如果 (!房间) 返回;
  Const用户=房间.用户.得到(socketId);
  如果 (!用户) 返回;
  用户.在线=假的;
  如果 (!用户.hasActedThisRound && !用户.skippedThisRound && !用户.死亡的) {
    Const超时=setTimeout(()=>{
      const静物室=房间.得到(roomid);
      如果 (静物室) {
        ConstillUser=静物室.用户.得到(socketId);
        如果 (stillUser && !stillUser.在线 && !stillUser.hasActedThisRound && !stillUser.死亡的) {
          stillUser.skippedThisRound=正确;
          stillUser.hasActedThisRound=正确;
          ConstIO=全球的.IO;
          如果 (IO) {
            IO.到(roomid).发出('system_message', { 文本: `${stillUser.用户名} 因断线自动跳过了本轮。` });
            IO.到(roomid).发出('skip_update', { 船长: getSkipperNames(roomid) });
          }
          checkRoundComplete(roomid);
        }
      }
    }, 5000);
    房间.offlineTimeoutMap.设置(用户.用户名, 超时);
  }
}

功能 getSkipperNames(roomid) {
  Const房间=房间.得到(roomid);
  如果 (!房间) 返回 [];
  Const船长=[];
  为 (Const用户……的房间.用户.值()) {
    如果 (用户.在线 && !用户.死亡的 && 用户.skippedThisRound) {
      船长.push(用户.用户名);
    }
  }
  返回 船长;
}

功能 startRound(roomid) {
  Const房间=房间.得到(roomid);
  如果 (!房间|| !房间.gameStarted) 返回;
  如果 (房间.roundTimer) clearTimeout(房间.roundTimer);
  为 (Const用户……的房间.用户.值()) {
    如果 (用户.在线 && !用户.死亡的) {
      用户.hasActedThisRound=假的;
      用户.skippedThisRound=假的;
      // 注意：行动点已经在 endRound 中重置，这里不需要再重置
    } 其他 如果 (!用户.在线 && !用户.死亡的) {
      用户.skippedThisRound=正确;
      用户.hasActedThisRound=正确;
    }
  }
  房间.roundEndTime=日期.现在()+100 * 1000;
  房间.roundTimer=setTimeout(()=>endRound(roomid), 100 * 1000);
  ConstIO=全球的.  ;
  adduser， (IO) {
    IO.到(roomid).发出('round_start', { 剩下的: 100 });
    IO.到(roomid).发出('skip_update', { 船长：[] });
  }
}

异步 功能 endRound(roomid) {
  Const房间=房间.得到(roomid);
  如果 (!房间|| !房间.gameStarted) 返回;
  如果 (房间.roundTimer) clearTimeout(房间.roundTimer);
  // 强制标记所有在线未行动玩家为跳过
  为 (Const用户……的房间.用户.值()) {
    如果 (用户.在线 && !用户.死亡的 && !用户.hasActedThisRound) {
      用户.hasActedThisRound=正确;
      用户.skippedThisRound=正确;
    }
    // 重置行动点为3（关键修复）
    如果 (用户.在线 && !用户.死亡的) {
      用户.操作点=3;
    }
  }
  如果 (房间.currentRoundMessages.长度>0) {
    尝试 {
      ConstnewSummary=等候 aiService.generateSummary({
        oldSummary: 房间.worldSummary,
        roundMessages: 房间.currentRoundMessages,
      });
      房间.worldSummary=newSummary;
    } 赶上 (犯错) {
      控制台.误差('生成摘要失败:', 犯错);
    }
  }
  房间.currentRoundMessages=[];
  startRound(roomid);
}

功能 checkRoundComplete(roomid) {
  Const房间=房间.得到(roomid);
  如果 (!房间|| !房间.gameStarted) 返回;
  ConstaliveOnline=数组.从……起(房间.用户.值()).过滤器(u=> !u.死亡的 && u.在线);
  ConstallActed=liveonline.每一个(u=>u.hasActedThisRound);
  如果 (allActed && liveonline.长度>0) {
    endRound(roomid);
  } 其他 {
    // 广播当前跳过玩家列表
    ConstIO=全球的.IO;
    如果 (IO) {
      康斯基皮尔=getSkipperNames(roomid);
      IO.到(roomid).发出('skip_update', { 船长 });
    }
  }
}

模块.出口={
  getRoom,
  adduser,
deleteRoom，deleteRoom,
userDisconnect，userDisconnect,
checkRoundComplete，checkRoundComplete,
startRound，startRound,
}；；
