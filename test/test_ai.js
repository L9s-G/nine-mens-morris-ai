// ai.js 功能测试
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const srcDir = path.resolve(__dirname, '..');

// 加载所有模块
const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const strategyCode = fs.readFileSync(path.join(srcDir, 'strategy.js'), 'utf-8').replace('const Strategy = (() => {', 'Strategy = (() => {');
const aiCode = fs.readFileSync(path.join(srcDir, 'ai.js'), 'utf-8').replace('const AI = (() => {', 'AI = (() => {');

const sandbox = { console, Engine: null, Strategy: null, AI: null };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(strategyCode, sandbox);
vm.runInContext(aiCode, sandbox);

const Engine = sandbox.Engine;
const Strategy = sandbox.Strategy;
const AI = sandbox.AI;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) { passed++; }
    else { failed++; console.log(`[FAIL] ${msg}`); }
}

// --- Test 1: 初始局面评估应接近 0（双方均势）---
Engine.init();
const score = AI.evaluatePosition();
assert(Math.abs(score) < 100, `初始局面评估应接近 0，实际: ${score}`);

// --- Test 2: AI 有材料优势时评估应为正 ---
Engine.init({ firstPlayer: Engine.TYPE_AI });
// AI 放 3 个子，对手放 1 个子
Engine.makeMove({ player: Engine.TYPE_AI, type: 'place', from: -1, to: 0, remove: null });
Engine.makeMove({ player: Engine.TYPE_OPPONENT, type: 'place', from: -1, to: 5, remove: null });
Engine.makeMove({ player: Engine.TYPE_AI, type: 'place', from: -1, to: 1, remove: null });
Engine.makeMove({ player: Engine.TYPE_OPPONENT, type: 'place', from: -1, to: 6, remove: null });
Engine.makeMove({ player: Engine.TYPE_AI, type: 'place', from: -1, to: 4, remove: null });
const score2 = AI.evaluatePosition();
assert(score2 > 0, `AI 有优势时评估应为正，实际: ${score2}`);

// --- Test 3: 策略模式判断 ---
const report = Strategy.generateReport();
const mode = AI.determineMode(report);
assert(
    mode === AI.MODE_EXPANSION || mode === AI.MODE_SUPPRESSION || mode === AI.MODE_DECISIVE,
    `策略模式应为有效值，实际: ${mode}`
);

// --- Test 4: Minimax 搜索返回有效分数 ---
Engine.init();
const result = AI.selectBestMove(2); // 使用较小深度加快测试
assert(result !== null, "selectBestMove 应返回结果");
assert(result.move !== null, "应选择一个走法");
assert(typeof result.score === 'number', "分数应为数字");
assert(result.mode !== undefined, "应包含策略模式");
assert(result.report !== undefined, "应包含战术报告");

// --- Test 5: AI 选择的走法应该是合法走法 ---
const legalMoves = Engine.generateLegalMoves(Engine.TYPE_AI);
const isLegal = legalMoves.some(m =>
    m.from === result.move.from &&
    m.to === result.move.to &&
    m.remove === result.move.remove
);
assert(isLegal, "AI 选择的走法应为合法走法");

// --- Test 6: 多步对弈测试（AI vs AI，10步）---
Engine.init({ firstPlayer: Engine.TYPE_AI });
let gameOver = false;
let steps = 0;
const maxSteps = 20;

while (!gameOver && steps < maxSteps) {
    const moveResult = AI.selectBestMove(2);
    if (!moveResult || !moveResult.move) break;

    Engine.makeMove(moveResult.move);
    const state = Engine.getState();
    gameOver = state.gameOver;
    steps++;

    // 对手随机走
    if (!gameOver) {
        const oppMoves = Engine.generateLegalMoves(state.currentPlayer);
        if (oppMoves.length === 0) break;
        Engine.makeMove(oppMoves[0]);
        const state2 = Engine.getState();
        gameOver = state2.gameOver;
        steps++;
    }
}

assert(steps > 0, `AI 对弈应至少走一步，实际: ${steps}`);
console.log(`  AI vs AI 对弈了 ${steps} 步`);

// --- Test 7: allScores 应按降序排列 ---
Engine.init();
const result2 = AI.selectBestMove(2);
if (result2 && result2.allScores) {
    let sorted = true;
    for (let i = 1; i < result2.allScores.length; i++) {
        if (result2.allScores[i].score > result2.allScores[i - 1].score) {
            sorted = false;
            break;
        }
    }
    assert(sorted, "allScores 应按评分降序排列");
} else {
    assert(false, "selectBestMove 应返回 allScores");
}

// --- 结果 ---
console.log(`\n=== AI.js Tests ===`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
if (failed === 0) console.log("All tests passed!");
