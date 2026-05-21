// ========================================================
// 九连棋 AI 对战测试
// 用法: node battle.js <mode1> <mode2> <round> <output>
// 示例: node battle.js Normal Master 1 battle_Normal_vs_Master_r1.log
// ========================================================

const fs = require('fs');
const vm = require('vm');

// 加载所有模块
const engineCode = fs.readFileSync('./engine.js', 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const strategyCode = fs.readFileSync('./strategy.js', 'utf-8').replace('const Strategy = (() => {', 'Strategy = (() => {');
const aiCode = fs.readFileSync('./ai.js', 'utf-8').replace('const AI = (() => {', 'AI = (() => {');
const narratorCode = fs.readFileSync('./narrator.js', 'utf-8').replace('const Narrator = (() => {', 'Narrator = (() => {');

const sandbox = { console, Engine: null, Strategy: null, AI: null, Narrator: null, Math };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(strategyCode, sandbox);
vm.runInContext(aiCode, sandbox);
vm.runInContext(narratorCode, sandbox);

const Engine = sandbox.Engine;
const Strategy = sandbox.Strategy;
const AI = sandbox.AI;
const Narrator = sandbox.Narrator;

// ==================== 命令行参数 ====================

const args = process.argv.slice(2);
const mode1 = args[0] || 'Normal';
const mode2 = args[1] || 'Master';
const round = args[2] || '1';
const outputFile = args[3] || `battle_${mode1}_vs_${mode2}_r${round}.log`;

// ==================== 日志系统 ====================

const logLines = [];
let logFd = null;

function log(msg) {
    logLines.push(msg);
    // 增量写入文件（便于实时查看进度）
    if (logFd === null) {
        try {
            logFd = fs.openSync(outputFile, 'w');
        } catch (e) {}
    }
    if (logFd !== null) {
        fs.writeSync(logFd, msg + '\n');
    }
}

function logBoard(board) {
    // 3x8 棋盘可视化（简化版）
    // 九连棋棋盘布局：
    //   0---1---2
    //   | 3-4-5 |
    //   || 678 ||
    //   9-10-11-12-13-14
    //   || 15-16-17 ||
    //   | 18-19-20 |
    //   21--22--23

    const symbols = { null: '.', 1: 'W', 2: 'B' };
    const b = board.map(v => symbols[v] || '?');

    log(`    ${b[0]}---${b[1]}---${b[2]}`);
    log(`    | ${b[3]}-${b[4]}-${b[5]} |`);
    log(`    || ${b[6]}${b[7]}${b[8]} ||`);
    log(`${b[9]}-${b[10]}-${b[11]}-${b[12]}-${b[13]}-${b[14]}`);
    log(`    || ${b[15]}-${b[16]}-${b[17]} ||`);
    log(`    | ${b[18]}-${b[19]}-${b[20]} |`);
    log(`    ${b[21]}--${b[22]}--${b[23]}`);
}

function formatMove(move) {
    if (move.type === 'place') return `place → ${move.to}`;
    if (move.type === 'remove') return `remove ${move.remove}`;
    if (move.type === 'fly') return `fly ${move.from} → ${move.to}`;
    return `move ${move.from} → ${move.to}`;
}

// ==================== 对战主循环 ====================

function runBattle() {
    const t0 = Date.now();

    log('========================================================');
    log(`九连棋 AI 对战日志`);
    log(`日期: ${new Date().toISOString()}`);
    log(`白方 (TYPE_HUMAN): ${mode1} 模式`);
    log(`黑方 (TYPE_AI):    ${mode2} 模式`);
    log('========================================================');
    log('');

    Engine.init({ firstPlayer: Engine.TYPE_HUMAN });

    let moveNum = 0;
    let gameOver = false;
    const MAX_MOVES = 200; // 防止无限循环

    while (!gameOver && moveNum < MAX_MOVES) {
        const state = Engine.getState();
        const currentPlayer = state.currentPlayer;
        const playerName = currentPlayer === Engine.TYPE_HUMAN ? `${mode1}(白)` : `${mode2}(黑)`;

        moveNum++;

        // 选择性能模式
        if (currentPlayer === Engine.TYPE_HUMAN) {
            AI.setPerformanceMode(mode1);
        } else {
            AI.setPerformanceMode(mode2);
        }

        log(`--- 第 ${moveNum} 手 | ${playerName} ---`);
        log(`阶段: ${state.playerHuman.piecesOnHand > 0 ? '放置' : (state.playerHuman.piecesOnBoard === 3 ? '飞行' : '走子')}`);
        log(`白方: 手中${state.playerHuman.piecesOnHand} 棋盘${state.playerHuman.piecesOnBoard} 失${state.playerHuman.piecesLost}`);
        log(`黑方: 手中${state.playerAI.piecesOnHand} 棋盘${state.playerAI.piecesOnBoard} 失${state.playerAI.piecesLost}`);
        log('');

        // AI 思考
        const thinkStart = Date.now();
        const result = AI.selectBestMoveForPlayer(currentPlayer);
        const thinkTime = Date.now() - thinkStart;

        if (!result || !result.move) {
            log(`[!] 无合法走法，游戏结束`);
            break;
        }

        // 记录走法
        const chosenEntry = result.allScores[0]; // 最高分走法
        log(`走法: ${formatMove(result.move)}`);
        log(`评分: ${result.score} | 原始: ${chosenEntry.rawScore || 'N/A'}`);
        log(`标签: [${(chosenEntry.tags || []).join(', ')}]`);
        log(`风险: ${chosenEntry.risk || 'N/A'}`);
        log(`策略: ${result.mode}`);
        log(`用时: ${thinkTime}ms | 节点: ${result.stats.nodeCount} | 深度: ${result.stats.depth}`);
        log('');

        // 执行走法
        Engine.makeMove(result.move);

        // 记录 FEN
        log(`FEN: ${Engine.toFen()}`);
        log('');

        // 检查游戏结束
        const newState = Engine.getState();
        if (newState.gameOver) {
            gameOver = true;
            const winner = newState.winner === Engine.TYPE_HUMAN ? `${mode1}(白)` : `${mode2}(黑)`;
            log('========================================================');
            log(`游戏结束！胜者: ${winner}`);
            log(`总手数: ${moveNum}`);
            log(`总用时: ${Date.now() - t0}ms`);
            log('========================================================');
        }
    }

    if (!gameOver) {
        log('[!] 达到最大手数限制，判定为平局');
    }

    // 关闭日志文件
    if (logFd !== null) {
        fs.closeSync(logFd);
        logFd = null;
    }
    console.log(`日志已保存: ${outputFile}`);

    return { moves: moveNum, winner: Engine.getState().winner, elapsed: Date.now() - t0 };
}

// ==================== 执行 ====================

const result = runBattle();
console.log(`对战完成: ${mode1} vs ${mode2} | ${result.moves} 手 | ${result.elapsed}ms`);
