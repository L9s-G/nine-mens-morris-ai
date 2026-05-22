// FEN 诊断测试：输入 FEN，输出所有走法和评分
// 用法: node test_fen.js <FEN> [player]
// 示例: node test_fen.js "120011020000000000000000/2/630/720/0"

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const srcDir = path.resolve(__dirname, '..');

const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const strategyCode = fs.readFileSync(path.join(srcDir, 'strategy.js'), 'utf-8').replace('const Strategy = (() => {', 'Strategy = (() => {');
const aiCode = fs.readFileSync(path.join(srcDir, 'ai.js'), 'utf-8').replace('const AI = (() => {', 'AI = (() => {');

const sandbox = { console, Engine: null, Strategy: null, AI: null, Math };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(strategyCode, sandbox);
vm.runInContext(aiCode, sandbox);

const Engine = sandbox.Engine;
const Strategy = sandbox.Strategy;
const AI = sandbox.AI;

// ==================== 参数 ====================

const fen = process.argv[2];
const playerArg = process.argv[3]; // '1' 或 '2'

if (!fen) {
    console.log('用法: node test_fen.js <FEN> [player]');
    console.log('示例: node test_fen.js "120011020000000000000000/2/630/720/0"');
    process.exit(1);
}

// ==================== 加载局面 ====================

Engine.fromFen(fen);
const state = Engine.getState();
const player = playerArg ? parseInt(playerArg) : state.currentPlayer;

console.log('=== FEN 诊断 ===');
console.log(`FEN: ${fen}`);
console.log(`当前玩家: ${player === Engine.TYPE_OPPONENT ? '白(OPPONENT)' : '黑(AI)'}`);
console.log(`阶段: ${state.playerOpponent.piecesOnHand > 0 || state.playerAI.piecesOnHand > 0 ? '放置' : '走子'}`);
console.log('');

// 棋盘显示
const board = Engine.getBoard();
const symbols = { null: 'o', 1: 'W', 2: 'B' };
const b = board.map(v => symbols[v] || '?');
console.log(`${b[0]}-----${b[1]}-----${b[2]}`);
console.log(`| ${b[3]}---${b[4]}---${b[5]} |`);
console.log(`| | ${b[6]}-${b[7]}-${b[8]} | |`);
console.log(`${b[9]}-${b[10]}-${b[11]}   ${b[12]}-${b[13]}-${b[14]}`);
console.log(`| | ${b[15]}-${b[16]}-${b[17]} | |`);
console.log(`| ${b[18]}---${b[19]}---${b[20]} |`);
console.log(`${b[21]}-----${b[22]}-----${b[23]}`);
console.log('');

// 玩家状态
const pOpp = state.playerOpponent;
const pAI = state.playerAI;
console.log(`白: 手${pOpp.piecesOnBoard}盘${pOpp.piecesOnBoard}丢${pOpp.piecesLost}`);
console.log(`黑: 手${pAI.piecesOnBoard}盘${pAI.piecesOnBoard}丢${pAI.piecesLost}`);
console.log('');

// ==================== 走法评估 ====================

// 使用 AI 的 selectBestMoveForPlayer 获取所有走法评分
const result = AI.selectBestMoveForPlayer(player);

if (!result || !result.allScores || result.allScores.length === 0) {
    console.log('无走法或评估数据');
    process.exit(0);
}

console.log('=== 所有走法评分 (前20) ===');
console.log('排名 | 走法                  | 最终分 | 原始分 | 标签');
console.log('-----|----------------------|--------|--------|----');

const scores = result.allScores.slice(0, 20);
for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    let moveStr = '';
    if (s.move.type === 'place') moveStr = `place → ${String(s.move.to).padStart(2)}`;
    else if (s.move.type === 'remove') moveStr = `remove ${String(s.move.remove).padStart(2)}`;
    else if (s.move.type === 'fly') moveStr = `fly ${s.move.from}→${s.move.to}`;
    else moveStr = `move ${s.move.from}→${String(s.move.to).padStart(2)}`;

    const tags = (s.tags || []).join(',');
    console.log(`  ${String(i + 1).padStart(2)} | ${moveStr.padEnd(20)} | ${String(s.score).padStart(6)} | ${String(s.rawScore || 'N/A').padStart(6)} | ${tags}`);
}

console.log('');
console.log(`最佳走法: ${result.move.type === 'place' ? 'place → ' + result.move.to : result.move.from + ' → ' + result.move.to}`);
console.log(`最终评分: ${result.score}`);
console.log(`策略模式: ${result.mode}`);

// ==================== 威胁分析 ====================

const MILLS = [
    [0,1,2], [3,4,5], [6,7,8], [9,10,11], [12,13,14], [15,16,17], [18,19,20], [21,22,23],
    [0,9,21], [3,10,18], [6,11,15], [8,12,17], [5,13,20], [2,14,23], [1,4,7], [16,19,22]
];

const opponent = player === Engine.TYPE_AI ? Engine.TYPE_OPPONENT : Engine.TYPE_AI;

console.log('');
console.log('=== 威胁分析 ===');

// 对手的 near mills
const oppThreats = [];
for (const mill of MILLS) {
    const vals = mill.map(i => board[i]);
    const oppCount = vals.filter(v => v === opponent).length;
    const emptyCount = vals.filter(v => v === null).length;
    if (oppCount === 2 && emptyCount === 1) {
        const emptyPos = mill[vals.indexOf(null)];
        oppThreats.push(emptyPos);
    }
}

if (oppThreats.length > 0) {
    console.log(`对手有 ${oppThreats.length} 个 near mill，威胁位置: ${[...new Set(oppThreats)].join(', ')}`);

    // 检查最佳走法是否堵截
    const bestTarget = result.move.to;
    const blockedThreats = [...new Set(oppThreats)].filter(t => t === bestTarget);
    if (blockedThreats.length > 0) {
        console.log(`✓ 最佳走法堵截了位置 ${blockedThreats.join(', ')}`);
    } else {
        console.log(`✗ 最佳走法未堵截！走到 ${bestTarget}，应该堵 ${[...new Set(oppThreats)].join(', ')}`);
    }
} else {
    console.log('对手无 near mill 威胁');
}
