// client.js - 完整版
let socket;
let currentRoomId = null;
let currentUserName = null;
let roundEndTime = null;
let timerInterval = null;

const joinContainer = document.getElementById('join-container');
const gameContainer = document.getElementById('game-container');
const joinBtn = document.getElementById('join-btn');
const roomIdInput = document.getElementById('room-id');
const userNameInput = document.getElementById('user-name');
const joinError = document.getElementById('join-error');
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
        joinContainer.style.display = 'none';
        gameContainer.style.display = 'block';
        roomDisplay.innerText = `房间: ${roomId} | 玩家: ${userName}`;
        actionPointsSpan.innerText = `行动点: ${response.actionPoints}`;
        summaryText.innerText = response.worldSummary;

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
            if (skippers.length === 0) skipNamesSpan.innerText = '无';
            else skipNamesSpan.innerText = skippers.join(', ');
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
        socket.on('game_started', ({ message }) => {
            addMessage('系统', message, 'system');
            addPublicMessage('系统', message);
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

skipBtn.onclick = () => socket.emit('skip_round', { roomId: currentRoomId });

surrenderBtn.onclick = () => {
    if (confirm('确定投降吗？投降后你将退出游戏并视为死亡。')) {
        socket.emit('surrender', { roomId: currentRoomId });
    }
};

voteKickBtn.onclick = () => {
    // 获取当前玩家列表（从界面或请求，简单方式：弹出一个带列表的对话框）
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
            return;
        }
        currentRoomId = roomId;
        currentUserName = userName;
        joinContainer.style.display = 'none';
        gameContainer.style.display = 'block';
        roomDisplay.innerText = `房间: ${roomId} | 玩家: ${userName}`;
        actionPointsSpan.innerText = `行动点: ${response.actionPoints}`;
        summaryText.innerText = response.worldSummary;

        // 监听事件
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
            addMessage('系统', '新的一轮开始了！你可以使用指令（/开头）消耗行动点，或普通对话。', 'system');
        });
        socket.on('round_time', ({ remaining }) => {
            roundEndTime = Date.now() + remaining * 1000;
            startTimer();
        });
        socket.on('skip_confirmed', () => {
            addMessage('系统', '你已跳过本轮指令机会。', 'system');
        });
        socket.on('user_joined', ({ userName }) => {
            addMessage('系统', `${userName} 加入了世界。`, 'system');
        });
        socket.on('user_left', ({ userName }) => {
            addMessage('系统', `${userName} 离开了世界。`, 'system');
        });
        socket.on('vote_progress', ({ targetName, currentVotes, required }) => {
            showVotePanel(`投票踢出 ${targetName}: ${currentVotes}/${required}`);
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
}

sendBtn.onclick = () => {
    const msg = messageInput.value.trim();
    if (!msg) return;
    messageInput.value = '';
    addMessage(currentUserName, msg, 'user');
    socket.emit('send_message', { roomId: currentRoomId, message: msg }, (res) => {
        if (res && res.error) {
            addMessage('系统', `错误: ${res.error}`, 'system');
        }
    });
};

skipBtn.onclick = () => {
    socket.emit('skip_round', { roomId: currentRoomId });
};

surrenderBtn.onclick = () => {
    if (confirm('确定要投降吗？投降后你将退出游戏并视为死亡。')) {
        socket.emit('surrender', { roomId: currentRoomId });
    }
};

voteKickBtn.onclick = () => {
    const target = prompt('输入要投票踢出的玩家名字:');
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
