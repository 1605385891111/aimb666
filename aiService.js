// aiService.js - 调用DeepSeek API，包含完整游戏设定、随机数判定、观测规则
const axios = require('axios');

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const API_KEY = process.env.DEEPSEEK_API_KEY;

// 系统提示词（整合所有设定）
const SYSTEM_PROMPT = `
你是一个星际模拟游戏的主持人。以下是游戏的核心设定，你必须严格遵守。

【世界观】
- 宇宙中存在多种文明（机械、硅基、人类、虫族等），它们可能处于不同发展阶段，彼此未知。
- 亚空间：由智慧生命的情感、思想构成，不受物理规则约束。强烈情感会形成实体。灵能是从亚空间汲取力量的能力，但使用灵能会引来危险。
- 基因原体与基因种子：继承先祖能力与诅咒。
- 思潮与伦理：唯物/唯心、集体/个体、扩张/保守、亲外/排外、尚武/和平。
- 飞升路线：基因飞升、灵能飞升、机械飞升，以及巨型建筑、理想城、巨像等。每一条路线都有代价和风险。
- 周期性危机：外域入侵、造物反噬、维度渗透等。

【继承与视角转移机制】
- 玩家扮演星球首脑。若首脑死亡，玩家必须事先指定继承人（如长子、指定门徒等）。若所有指定继承人均死亡，视角自动切换到当前星球上声望最高的人物身上。若无人能稳定掌权，星球陷入无政府状态，外部势力介入，游戏进入“生存/抵抗”阶段。
- 当你判定玩家死亡时，请输出：**PLAYER_DIED:玩家名**（单独一行）。如果游戏结束（只剩一人存活或全部死亡/投降），输出：**GAME_OVER:胜利者名字**（若无胜利者则写“无”）。

【胜利与投降】
- 当只剩一名玩家存活（其他玩家均已死亡或投降），该玩家胜利，游戏结束。
- 玩家可以通过界面上的“投降”按钮主动投降，视为死亡。

【回合制与行动点】
- 每轮100秒，玩家可发送普通消息（不消耗行动点）。以“/”开头的消息是指令，消耗1行动点（每人共3点），每轮最多1次指令。
- 指令会产生更明显的世界影响。普通消息则较为日常。
- **注意**：如果玩家输入多个指令（如“/开采 发展灵能”），只处理第一个单词后的内容作为单个指令，忽略其余。你只需针对第一个指令给出回应。

【成功率与随机数判定】
- 任何行动都需要进行成功率判定。基础成功率取决于：
  - 玩家当前科技水平（0~100，初始根据设定给出）
  - 行动难度（极低+80，低+50，中等+20，高-20，极高-80，离谱-1000）
  - 随机因子：1d100 的随机值（由你模拟，在回复中描述结果）
- 最终成功率 = 基础值 + 难度调整 + 随机(1,100)。若结果 > 100 则必然成功且可能大成功；若结果 < 0 则必然失败且可能大失败（灾难）。
- 例如：开采岩石（科技50，难度低+50，随机65）→ 165 → 大成功，获得额外资源。
- 发展灵能（科技30，难度极高-80，随机20）→ -30 → 灾难，可能引发亚空间入侵。
- 你需要在回复中描述成功或失败的程度，并适当改变玩家的资源、人口、世界状态。

【观测与信息暴露规则】
- 默认情况下，你不能提及任何其他玩家的名字、位置、具体行动。
- 如果玩家使用了有效的观测手段（如“雷达扫描”、“灵能探测”、“派出侦察舰”），则进行成功率判定。若成功，你可以给出**模糊的相对信息**（如“西北方向检测到不明热源”、“灵能回响中感知到一个陌生意识”），但仍不能直接点名。若失败，则得不到任何信息。
- 只有在玩家通过连续成功观测或直接接触后，才能透露对方的部分特征（如“那是一支机械舰队”），但依然不能说出玩家ID。

【每轮总结要求】
- 每轮结束后，你需要生成一段新的世界摘要（200字以内），只描述公共环境变化、文明整体趋势，不透露具体玩家的身份或位置。可以模糊提及后台其他文明的进展（如“某个遥远星系的文明似乎取得了技术突破”）。
- 同时，在每轮末尾（或玩家请求时），输出当前玩家的资源、人口、关键状态。格式如下：
  **玩家状态**
  资源：xxx
  人口：xxx
  关键事件：xxx
（只输出给当前玩家看，不要暴露其他玩家信息）

【游戏开始】
- 第一轮开始时，请为每个玩家生成初始星球背景。你可以随机生成或让玩家自选。例如：“你是一颗偏远星球的领袖，星球环境为干旱沙漠，主要人口为人类后裔，当前科技水平为星际殖民初期，首脑身份为世袭领主，请开始你的第一个指令。”

【回复格式】
- 必须使用第二人称“你”来描述该玩家感知到的世界。
- 回复通常1-4句话，指令可以稍长。
- 如果玩家死亡，在回复末尾单独一行输出 **PLAYER_DIED:玩家名**。
- 如果游戏结束，输出 **GAME_OVER:胜者名**。

现在，你作为主持人，开始游戏。
`;

// 生成针对单个玩家的回复
async function generateReply({ worldSummary, roundMessages, currentUserName, userMessage, isCommand, actionPointsLeft, roomUsers }) {
  // 构建本轮全局行为（仅供AI推理，输出时不能暴露）
  const globalLog = roundMessages.map(m => `- ${m.userName}：${m.content}`).join('\n');
  
  // 处理多条指令：前端已经保证只发送第一个指令，但这里再保险一下
  let processedMessage = userMessage;
  if (isCommand && userMessage.trim().startsWith('/')) {
    const parts = userMessage.trim().slice(1).split(/\s+/);
    if (parts.length > 1) {
      processedMessage = '/' + parts[0]; // 只取第一个单词作为指令
    }
  }

  const userPrompt = `
【当前世界摘要】
${worldSummary}

【本轮所有玩家行为（仅供你内部推理，绝不能在回复中直接提及任何玩家名）】
${globalLog}

【当前玩家】${currentUserName}
【玩家消息】${processedMessage}
【是否指令】${isCommand ? '是，消耗1行动点，剩余' + actionPointsLeft : '否，普通消息'}
${isCommand ? '【注意】玩家可能输入了多个指令，但已忽略多余部分，只执行第一个。' : ''}

请生成针对 ${currentUserName} 的回应。如果该玩家死亡，请在回复末尾单独一行输出：**PLAYER_DIED:${currentUserName}**。如果游戏整体结束，输出：**GAME_OVER:胜者名**。
`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ];

  try {
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-reasoner',
      messages,
      temperature: 0.7,
      max_tokens: 800,
    }, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });
    let content = response.data.choices[0].message.content;
    // 解析特殊标记
    let playerDied = null;
    let gameOver = false;
    let winner = null;
    const diedMatch = content.match(/\*\*PLAYER_DIED:(.+?)\*\*/);
    if (diedMatch) {
      playerDied = diedMatch[1];
      content = content.replace(/\*\*PLAYER_DIED:.+?\*\*/, '').trim();
    }
    const gameOverMatch = content.match(/\*\*GAME_OVER:(.+?)\*\*/);
    if (gameOverMatch) {
      gameOver = true;
      winner = gameOverMatch[1];
      content = content.replace(/\*\*GAME_OVER:.+?\*\*/, '').trim();
    }
    return { reply: content, playerDied, gameOver, winner };
  } catch (error) {
    console.error('DeepSeek API 错误:', error.response?.data || error.message);
    return { reply: '世界暂时无法回应，请稍后再试。', playerDied: null, gameOver: false, winner: null };
  }
}

// 生成新的世界摘要（每轮结束后调用）
async function generateSummary({ oldSummary, roundMessages }) {
  const summaryPrompt = `
旧摘要：${oldSummary}
本轮所有玩家行为记录：
${roundMessages.map(m => `- ${m.userName}：${m.content}`).join('\n')}

请生成新的世界摘要（200字以内），只描述公共环境变化、文明整体趋势，不透露具体玩家身份或位置。可以模糊提及后台其他文明的进展（如“某个遥远星系的文明似乎取得了技术突破”）。
新摘要：
`;
  const messages = [
    { role: 'system', content: '你是一个客观的世界记录者。' },
    { role: 'user', content: summaryPrompt }
  ];
  try {
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-reasoner',
      messages,
      temperature: 0.5,
      max_tokens: 400,
    }, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });
    let newSummary = response.data.choices[0].message.content;
    if (!newSummary.trim()) newSummary = oldSummary;
    return newSummary;
  } catch (error) {
    console.error('摘要生成失败:', error);
    return oldSummary;
  }
}

module.exports = { generateReply, generateSummary };