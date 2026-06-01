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

const sandbox = { console, Engine: null, Evaluator: null, Searcher: null, AI: null, Math };
vm.createContext(sandbox);

// Worker 模拟：同步调用 Searcher.search，无需真实线程
// 注意：Node.js 环境共享 Engine 实例，fromFen 会重建 state
// 搜索前保存写指针/缓冲区，搜索后恢复，避免污染游戏状态
sandbox.Worker = class {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage(data) {
        try {
            const st = sandbox.Engine.getStateView();
            const savedWIdx = st.writeIdx;
            const savedOwn = new Float64Array(st.posOwn);
            const savedOpp = new Float64Array(st.posOpp);
            sandbox.Engine.fromFen(data.fen);
            const result = sandbox.Searcher.search(data.player, data.depth, data.timeLimit);
            const st2 = sandbox.Engine.getStateView();
            st2.writeIdx = savedWIdx;
            st2.posOwn.set(savedOwn);
            st2.posOpp.set(savedOpp);
            if (this.onmessage) this.onmessage({ data: { success: true, result } });
        } catch (error) {
            if (this.onmessage) this.onmessage({ data: { success: false, error: error.message } });
        }
    }
    terminate() {}
};

vm.runInContext(engineCode, sandbox);
vm.runInContext(evaluatorCode, sandbox);
vm.runInContext(searcherCode, sandbox);
vm.runInContext(aiCode, sandbox);

const Engine = sandbox.Engine;
const Evaluator = sandbox.Evaluator;
const Searcher = sandbox.Searcher;
const AI = sandbox.AI;

// ==================== 命令行参数 ====================

const args = process.argv.slice(2);
const mode1 = args[0] || 'Normal';
const mode2 = args[1] || 'Master';
const round = args[2] || '1';
const logDir = path.resolve(__dirname, 'battle_logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const outputFile = args[3] || path.join(logDir, `battle_${mode1}_vs_${mode2}_r${round}.log`);

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
    const symbols = { 0: '·', 1: '●', 2: '○' };
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

async function runBattle() {
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
    const MAX_MOVES = 500; // 防止无限循环

    while (!gameOver && moveNum < MAX_MOVES) {
        const state = Engine.getStateView();
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
        const result = await AI.selectBestMoveForPlayer(currentPlayer);
        const thinkTime = Date.now() - thinkStart;

        if (!result || !result.move) {
            log(`[!] 无合法走法，游戏结束`);
            break;
        }

        // 执行走法
        const formedMill = Engine.makeMove(result.move);

        // 日志函数
        function logMove(num, label, move, score, depth, targetDepth, ms, nodes) {
            const bLines = getBoardLines(Engine.getBoard());
            const st = Engine.getStateView();
            const o = st.playerOpponent, a = st.playerAI;
            const tp = ms > 0 ? Math.round(nodes / ms) : 0;
            const oM = Evaluator.countMobility(Engine.TYPE_OPPONENT);
            const aM = Evaluator.countMobility(Engine.TYPE_AI);
            const oMills = Evaluator.analyzeMills(Engine.TYPE_OPPONENT);
            const aMills = Evaluator.analyzeMills(Engine.TYPE_AI);
            const iLines = [
                `棋子: 白${o.piecesOnHand}+${o.piecesOnBoard}-${o.piecesLost} | 黑${a.piecesOnHand}+${a.piecesOnBoard}-${a.piecesLost}`,
                `走法: ${formatMove(move)}`,
                `评分: ${score} | 深度: ${depth}/${targetDepth}`,
                `用时: ${ms}ms | 节点: ${nodes} | 吞吐: ${tp}n/ms`,
                `机动: 白${oM} 黑${aM}`,
                `磨坊: 白 ${oMills.nearMills}/${oMills.hardNearMills} : ${oMills.rollingForks}/${oMills.hardRollingForks} | 黑 ${aMills.nearMills}/${aMills.hardNearMills} : ${aMills.rollingForks}/${aMills.hardRollingForks} [nm/hnm : rf/hrf]`,
            ];
            log(`--- 第 ${num} 手 | ${label} ---`);
            logSideBySide(bLines, iLines);
            log(`FEN: ${Engine.toFen()}`);
            const sv = Engine.getStateView();
            log(`own=${sv.own} opp=${sv.opp} | buf[${(sv.writeIdx - 1) & 31}]=(${sv.posOwn[(sv.writeIdx - 1) & 31]},${sv.posOpp[(sv.writeIdx - 1) & 31]}) | wIdx=${sv.writeIdx}`);
            log('');
        }

        logMove(moveNum, playerName, result.move, result.score, result.stats.depth, result.stats.targetDepth, thinkTime, result.stats.nodeCount);

        // 成磨后必须吃子
        if (formedMill) {
            const captureMoves = Engine.generateLegalMoves(currentPlayer);
            if (captureMoves.length > 0) {
                let best = captureMoves[0], bestScore = -Infinity;
                for (const cm of captureMoves) {
                    Engine.makeMove(cm);
                    const s = Evaluator.evaluate(0, null);
                    Engine.undoMove();
                    if (s > bestScore) { bestScore = s; best = cm; }
                }
                Engine.makeMove(best);
                moveNum++;
                logMove(moveNum, playerName + ' 吃子', best, bestScore, 0, 0, 0, 0);
            }
        }

        // 检查游戏结束
        if (Engine.isGameOver()) {
            gameOver = true;
            const w = Engine.getWinner();
            const result = w === null ? '平局：发生3次循环' : `${w === Engine.TYPE_OPPONENT ? mode1 : mode2}获胜`;
            log('========================================================');
            log(`游戏结束！${result}`);
            log(`总手数: ${moveNum} | 总用时: ${Date.now() - t0}ms`);
            log('========================================================');
        }
    }

    if (!gameOver) {
        log('========================================================');
        log(`游戏结束！平局：最大回合${MAX_MOVES}`);
        log(`总手数: ${moveNum} | 总用时: ${Date.now() - t0}ms`);
        log('========================================================');
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

runBattle().then(result => {
    console.log(`对战完成: ${mode1} vs ${mode2} | ${result.moves} 手 | ${result.elapsed}ms`);
});
