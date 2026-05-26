// ========================================================
// Nine Men's Morris AI 对战测试
// 用法: node battle.js <mode1> <mode2> <round> <output>
// 示例: node battle.js Normal Master 1 battle_Normal_vs_Master_r1.log
// ========================================================

const fs = require('fs');
const vm = require('vm');

// 加载所有模块
const path = require('path');
const srcDir = path.resolve(__dirname, '..');
const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const evaluatorCode = fs.readFileSync(path.join(srcDir, 'evaluator.js'), 'utf-8').replace('const Evaluator = (() => {', 'Evaluator = (() => {');
const searcherCode = fs.readFileSync(path.join(srcDir, 'searcher.js'), 'utf-8').replace('const Searcher = (() => {', 'Searcher = (() => {');
const aiCode = fs.readFileSync(path.join(srcDir, 'ai.js'), 'utf-8').replace('const AI = (() => {', 'AI = (() => {');
const narratorCode = fs.readFileSync(path.join(srcDir, 'narrator.js'), 'utf-8').replace('const Narrator = (() => {', 'Narrator = (() => {');

const sandbox = { console, Engine: null, Evaluator: null, Searcher: null, AI: null, Narrator: null, Math };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(evaluatorCode, sandbox);
vm.runInContext(searcherCode, sandbox);
vm.runInContext(aiCode, sandbox);
vm.runInContext(narratorCode, sandbox);

const Engine = sandbox.Engine;
const Evaluator = sandbox.Evaluator;
const Searcher = sandbox.Searcher;
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

function getBoardLines(board) {
    const symbols = { null: 'o', 1: 'W', 2: 'B' };
    const b = board.map(v => symbols[v] || '?');

    return [
        `${b[0]}-----${b[1]}-----${b[2]}`,
        `| ${b[3]}---${b[4]}---${b[5]} |`,
        `| | ${b[6]}-${b[7]}-${b[8]} | |`,
        `${b[9]}-${b[10]}-${b[11]}   ${b[12]}-${b[13]}-${b[14]}`,
        `| | ${b[15]}-${b[16]}-${b[17]} | |`,
        `| ${b[18]}---${b[19]}---${b[20]} |`,
        `${b[21]}-----${b[22]}-----${b[23]}`
    ];
}

function logSideBySide(boardLines, infoLines) {
    const PAD = '   ';
    const maxLen = Math.max(...boardLines.map(l => l.length));
    const rows = Math.max(boardLines.length, infoLines.length);
    for (let i = 0; i < rows; i++) {
        const left = (boardLines[i] || '').padEnd(maxLen);
        const right = infoLines[i] || '';
        log(left + PAD + right);
    }
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
    log(`Nine Men's Morris AI 对战日志`);
    log(`日期: ${new Date().toISOString()}`);
    log(`白方 (TYPE_OPPONENT): ${mode1} 模式`);
    log(`黑方 (TYPE_AI):    ${mode2} 模式`);
    log('========================================================');
    log('');

    Engine.init({ firstPlayer: Engine.TYPE_OPPONENT });

    let moveNum = 0;
    let gameOver = false;
    const MAX_MOVES = 1000; // 防止无限循环（测试 250 步判和）

    while (!gameOver && moveNum < MAX_MOVES) {
        const state = Engine.getState();
        const currentPlayer = state.currentPlayer;
        const playerName = currentPlayer === Engine.TYPE_OPPONENT ? `${mode1}(白)` : `${mode2}(黑)`;

        moveNum++;

        // 选择性能模式
        if (currentPlayer === Engine.TYPE_OPPONENT) {
            AI.setPerformanceMode(mode1);
        } else {
            AI.setPerformanceMode(mode2);
        }

        // AI 思考
        const thinkStart = Date.now();
        const result = AI.selectBestMoveForPlayer(currentPlayer);
        const thinkTime = Date.now() - thinkStart;

        if (!result || !result.move) {
            log(`[!] 无合法走法，游戏结束`);
            break;
        }

        // 执行走法
        Engine.makeMove(result.move);

        // 棋盘 + 走法信息并排显示
        const boardLines = getBoardLines(Engine.getBoard());
        const pOpp = state.playerOpponent;
        const pAI = state.playerAI;

        const infoLines = [
            `初始：白-${pOpp.piecesOnHand}-${pOpp.piecesOnBoard}-${pOpp.piecesLost} 黑-${pAI.piecesOnHand}-${pAI.piecesOnBoard}-${pAI.piecesLost}`,
            `走法: ${formatMove(result.move)}`,
            `评分: ${result.score}`,
            `用时: ${thinkTime}ms | 节点: ${result.stats.nodeCount} | 深度: ${result.stats.depth}`
        ];

        log(`--- 第 ${moveNum} 手 | ${playerName} ---`);
        logSideBySide(boardLines, infoLines);
        log(`FEN: ${Engine.toFen()}`);
        log('');

        // 检查游戏结束
        if (Engine.isGameOver()) {
            gameOver = true;
            const w = Engine.getWinner();
            const winner = w === null ? '平局' : w === Engine.TYPE_OPPONENT ? `${mode1}(白)` : `${mode2}(黑)`;
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

    return { moves: moveNum, winner: Engine.getWinner(), elapsed: Date.now() - t0 };
}

// ==================== 执行 ====================

const result = runBattle();
console.log(`对战完成: ${mode1} vs ${mode2} | ${result.moves} 手 | ${result.elapsed}ms`);
