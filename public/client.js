// client.js - 完整版，包含等待室、准备、开始游戏、公共聊天、游戏逻辑
let socket;
let currentRoomId = null;
let currentUserName = null;
let roundEndTime = null;
let timerInterval = null;
let isOwner = false;

const joinContainer = document.getElementById('join-container');
const gameContainer = document.getElementById('game-container');
const joinBtn = document.getElementById('join-btn');
const roomIdInput = document.getElementById('room-id');
const userNameInput = document.getElementById('user-name');
const joinError = document.getElementById('join-error');

const waitingRoomDiv = document.getElementById('waiting-room');
const gamePlayArea = document.getElementById('game-play-area');
const waitingPlayersList = document.getElementById('waiting-players-list');
const readyStatusSpan = document.getElementById('ready-status-text');
const readyBtn = document.getElementById('ready-btn');
const unreadyBtn = document.getElementById('unready-btn');
const startGameBtn = document.getElementById('start-game-btn');
const waitingError = document.getElementById('waiting-error');

const roomDisplay = document.getElementById('room-display');
const roundTimerSpan = document.getElementById('round-timer');
const actionPointsSpan = document.getElementById('action-points');
const summaryText = document.getElementById('summary-text');
const chatMessages = document.getElementById('chat-messages');
const publicChatMessages = document.getElementById('public-chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const skipBtn = document.getElementById('skip-btn');
const surrenderBtn = document.getElementById('surrender-btn');
const voteKickBtn = document.getElementById('vote-kick-btn');
const publicInput = document.getElementById('public-input');
const publicSendBtn = document.getElementById('public-send-btn');
const playerListUl = document.getElementById('player-list-ul');
const skipNamesSpan = document.getElementById('skip-names');

joinBtn.onclick = () => {
    const roomId = roomIdInput.value.trim();
    const userName = userNameInput.value.trim();
    if (!roomId || !userName) {
        joinError.innerText = '房间ID和名字不能为空';
        return;
    }
    socket = io();
    socket.emit('join_room', { roomId, userName }, (response) => {
        if (response.error) {
            joinError.innerText = response.error;
            socket.disconnect();
            return;
        }
        currentRoomId = roomId;
        currentUserName = userName;
        isOwner = response.isOwner;
        joinContainer.style.display = 'none';
        gameContainer.style.display = 'block';
        roomDisplay.innerText = `房间: ${roomId} | 玩家: ${userName}`;
        actionPointsSpan.innerText = `行动点: ${response.actionPoints}`;
        summaryText.innerText = response.worldSummary;

        // 显示等待室
        waitingRoomDiv.style.display = 'block';
        gamePlayArea.style.display = 'none';
        if (isOwner) {
            startGameBtn.style.display = 'inline-block';
            startGameBtn.disabled = true;
        } else {
            startGameBtn.style.display = 'none';
        }

        // 监听准备状态更新
        socket.on('player_ready_update', ({ readyList, allReady, ownerId }) => {
            updateWaitingPlayers(readyList, allReady, ownerId);
            if (allReady && isOwner) {
                startGameBtn.disabled = false;
            } else if (isOwner) {
                startGameBtn.disabled = true;
            }
        });

        socket.on('game_started', ({ message }) => {
            waitingRoomDiv.style.display = 'none';
            gamePlayArea.style.display = 'block';
            addMessage('系统', message, 'system');
            addPublicMessage('系统', message);
        });

        socket.on('start_game_error', ({ error }) => {
            waitingError.innerText = error;
            setTimeout(() => { waitingError.innerText = ''; }, 3000);
        });

        // 游戏内事件
        socket.on('ai_reply', ({ reply, isCommand, gameOver, winner }) => {
            addMessage('世界', reply, 'ai');
            if (gameOver) {
                addMessage('系统', `游戏结束！胜利者：${winner || '无'}`, 'system');
                disableGame();
            }
        });
        socket.on('round_start', ({ remaining }) => {
            roundEndTime = Date.now() + remaining * 1000;
            startTimer();
            addMessage('系统', '新的一轮开始了！行动点已恢复为3。', 'system');
        });
        socket.on('round_time', ({ remaining }) => {
            roundEndTime = Date.now() + remaining * 1000;
            startTimer();
        });
        socket.on('skip_confirmed', () => {
            addMessage('系统', '你已跳过本轮指令机会。', 'system');
        });
        socket.on('skip_update', ({ skippers }) => {
            skipNamesSpan.innerText = skippers.length ? skippers.join(', ') : '无';
        });
        socket.on('player_list', (players) => {
            playerListUl.innerHTML = '';
            players.forEach(p => {
                const li = document.createElement('li');
                li.textContent = p;
                playerListUl.appendChild(li);
            });
        });
        socket.on('user_joined', ({ userName }) => {
            addMessage('系统', `${userName} 加入了世界。`, 'system');
            addPublicMessage('系统', `${userName} 加入了房间。`);
        });
        socket.on('user_left', ({ userName }) => {
            addMessage('系统', `${userName} 离开了世界。`, 'system');
            addPublicMessage('系统', `${userName} 离开了房间。`);
        });
        socket.on('public_message', ({ userName, message }) => {
            addPublicMessage(userName, message);
        });
        socket.on('vote_progress', ({ targetName, currentVotes, required, voters }) => {
            const votersList = voters ? ` (已投票: ${voters.join(', ')})` : '';
            showVotePanel(`投票踢出 ${targetName}: ${currentVotes}/${required}${votersList}`);
        });
        socket.on('kicked', () => {
            alert('你被投票踢出了房间！');
            location.reload();
        });
        socket.on('surrender_confirmed', () => {
            addMessage('系统', '你已投降，游戏结束。', 'system');
            disableGame();
        });
        socket.on('you_died', ({ reason }) => {
            addMessage('系统', `你已死亡（${reason}），游戏结束。`, 'system');
            disableGame();
        });
        socket.on('game_over', ({ winner }) => {
            addMessage('系统', `游戏结束！胜利者：${winner || '无'}`, 'system');
            disableGame();
        });
        socket.on('update_action_points', (points) => {
            actionPointsSpan.innerText = `行动点: ${points}`;
        });
        socket.on('disconnect', () => {
            alert('与服务器断开连接，页面将刷新');
            location.reload();
        });
        socket.on('system_message', ({ text }) => {
            addMessage('系统', text, 'system');
        });
    });
};

function updateWaitingPlayers(readyList, allReady, ownerId) {
    waitingPlayersList.innerHTML = '';
    if (readyList.length === 0) {
        waitingPlayersList.innerText = '暂无玩家';
    } else {
        waitingPlayersList.innerText = '已准备：' + readyList.join(', ');
    }
    readyStatusSpan.innerText = allReady ? '全部准备' : '等待其他玩家准备';
}

readyBtn.onclick = () => {
    socket.emit('player_ready', { roomId: currentRoomId, ready: true });
    readyBtn.style.display = 'none';
    unreadyBtn.style.display = 'inline-block';
};

unreadyBtn.onclick = () => {
    socket.emit('player_ready', { roomId: currentRoomId, ready: false });
    readyBtn.style.display = 'inline-block';
    unreadyBtn.style.display = 'none';
};

startGameBtn.onclick = () => {
    socket.emit('start_game', { roomId: currentRoomId });
};

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!roundEndTime) return;
        const remaining = Math.max(0, Math.floor((roundEndTime - Date.now()) / 1000));
        roundTimerSpan.innerText = `回合剩余: ${remaining}s`;
        if (remaining <= 0) {
            clearInterval(timerInterval);
            roundTimerSpan.innerText = '回合结束';
        }
    }, 1000);
}

function addMessage(sender, text, type = 'user') {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = `<div class="user">${sender === currentUserName ? '你' : sender}</div><div class="text">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addPublicMessage(sender, text) {
    const div = document.createElement('div');
    div.className = 'public-message';
    div.innerHTML = `<strong>${escapeHtml(sender)}:</strong> ${escapeHtml(text)}`;
    publicChatMessages.appendChild(div);
    publicChatMessages.scrollTop = publicChatMessages.scrollHeight;
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function disableGame() {
    messageInput.disabled = true;
    sendBtn.disabled = true;
    skipBtn.disabled = true;
    surrenderBtn.disabled = true;
    voteKickBtn.disabled = true;
    publicInput.disabled = true;
    publicSendBtn.disabled = true;
}

sendBtn.onclick = () => {
    const msg = messageInput.value.trim();
    if (!msg) return;
    messageInput.value = '';
    addMessage(currentUserName, msg, 'user');
    socket.emit('send_message', { roomId: currentRoomId, message: msg }, (res) => {
        if (res && res.error) addMessage('系统', `错误: ${res.error}`, 'system');
    });
};

publicSendBtn.onclick = () => {
    const msg = publicInput.value.trim();
    if (!msg) return;
    publicInput.value = '';
    addPublicMessage(currentUserName, msg);
    socket.emit('public_message', { roomId: currentRoomId, message: msg });
};

skipBtn.onclick = () => {
    socket.emit('skip_round', { roomId: currentRoomId });
};

surrenderBtn.onclick = () => {
    if (confirm('确定投降吗？投降后你将退出游戏并视为死亡。')) {
        socket.emit('surrender', { roomId: currentRoomId });
    }
};

voteKickBtn.onclick = () => {
    const playerItems = document.querySelectorAll('#player-list-ul li');
    const players = Array.from(playerItems).map(li => li.textContent);
    if (players.length === 0) {
        alert('暂无玩家列表');
        return;
    }
    const target = prompt(`输入要投票踢出的玩家名字:\n当前玩家: ${players.join(', ')}`);
    if (target && target !== currentUserName) {
        socket.emit('vote_kick', { roomId: currentRoomId, targetUserName: target });
    } else {
        alert('无效的玩家名或不能踢自己');
    }
};

function showVotePanel(text) {
    let panel = document.getElementById('vote-panel');
    panel.style.display = 'block';
    panel.innerText = text;
    setTimeout(() => {
        panel.style.display = 'none';
    }, 5000);
}
