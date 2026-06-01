// ========================================================
// Evaluator 单元测试
// 用法: node test/test_evaluator.js
// ========================================================

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8')
    .replace('const Engine = (() => {', 'Engine = (() => {');
const evaluatorCode = fs.readFileSync(path.join(srcDir, 'evaluator.js'), 'utf-8')
    .replace('const Evaluator = (() => {', 'Evaluator = (() => {');

const sandbox = { console, Engine: null, Evaluator: null, Math };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(evaluatorCode, sandbox);
const E = sandbox.Engine;
const EV = sandbox.Evaluator;

let passed = 0, failed = 0, total = 0;

function assert(cond, msg) {
    total++;
    if (cond) { passed++; }
    else { failed++; console.log(`  FAIL: ${msg}`); }
}

function assertEq(a, b, msg) {
    assert(a === b, `${msg} (expected ${b}, got ${a})`);
}

function section(name) { console.log(`\n--- ${name} ---`); }

// ==================== 辅助函数 ====================

function setupBoard(config) {
    E.init({ opponentHand: 0, aiHand: 0, ...config.init });
    const st = E.getStateView();
    let own = 0, opp = 0;
    if (config.opp) {
        for (const pos of config.opp) opp |= (1 << pos);
        st.playerOpponent.piecesOnBoard = config.opp.length;
    }
    if (config.ai) {
        for (const pos of config.ai) own |= (1 << pos);
        st.playerAI.piecesOnBoard = config.ai.length;
    }
    st.own = own;
    st.opp = opp;
    if (config.currentPlayer) st.currentPlayer = config.currentPlayer;
    return st;
}

// ==================== 1. analyzeMillsBoth ====================
section('analyzeMillsBoth');

// 空棋盘 → 所有统计为 0
(() => {
    setupBoard({});
    const r = EV.analyzeMillsBoth();
    assertEq(r.ai.nearMills, 0, 'empty: ai nearMills = 0');
    assertEq(r.opp.nearMills, 0, 'empty: opp nearMills = 0');
    assertEq(r.ai.hardNearMills, 0, 'empty: ai hardNearMills = 0');
    assertEq(r.ai.rollingForks, 0, 'empty: ai rollingForks = 0');
    assertEq(r.ai.hardRollingForks, 0, 'empty: ai hardRollingForks = 0');
})();

// AI 2+1 横线：[0,1] 有 AI 棋子，[2] 空，MOVING 阶段且有邻居
(() => {
    setupBoard({
        ai: [0, 1, 9],        // pos 9 是 pos 0 的邻居，提供可达性
        opp: [21, 22, 23],
    });
    const st = E.getStateView();
    st.currentPlayer = E.TYPE_AI;

    const r = EV.analyzeMillsBoth();
    assert(r.ai.nearMills >= 1, 'ai 2+1 [0,1,2]: nearMills >= 1');
    // pos 2 的邻居有 [1,14]，pos 1 是 AI 棋子且在线外 → 可达
})();

// Opp 2+1：[21,22] 有 OPP 棋子，[23] 空
(() => {
    setupBoard({
        opp: [21, 22, 14],    // pos 14 是 pos 23 的邻居
        ai: [0, 1, 2],
    });
    const r = EV.analyzeMillsBoth();
    assert(r.opp.nearMills >= 1, 'opp 2+1 [21,22,23]: nearMills >= 1');
})();

// 2+1 空位可达（MOVING 阶段，空位有己方邻居在线外）
// analyzer 用 outsideMill 排除当前 mill 线上的己方棋子，只看线外邻居
// [0,1,2] 2+1，pos 2 空。pos 2 邻居 [1,14]。pos 1 在 mill 线内被排除。
// 需要 pos 14 有 AI 棋子 → 可达
(() => {
    setupBoard({
        ai: [0, 1, 14],       // [0,1,2] 2+1，pos 14 在线外且是 pos 2 的邻居
        opp: [21, 22, 23],
    });
    const r = EV.analyzeMillsBoth();
    assert(r.ai.nearMills >= 1, 'ai [0,1,2] 2+1 reachable via pos 14');
})();

// rollingFork：空位有邻居在已完成 mill 中
// AI 完成 mill [6,7,8]，[9,10,11] 是 2+1（9,10 有 AI，11 空）
// pos 11 的邻居 [6,10,15]。pos 10 在 mill 线内被排除。
// pos 6 在已完成 mill [6,7,8] 中 → rollingFork!
(() => {
    setupBoard({
        ai: [9, 10, 6, 7, 8],  // mill [6,7,8] completed + [9,10,11] 2+1
        opp: [21, 22, 23],
    });
    const r = EV.analyzeMillsBoth();
    assert(r.ai.rollingForks >= 1, 'ai rollingFork: pos 6 in completed mill [6,7,8]');
})();

// hardNearMill：对手不可达
// 需要 MOVING 阶段（>3 子）否则 hardNearMills 会被修正为 0
// AI 4 子：[0,1,14,9]，OPP 4 子：[21,22,23,12]
// [0,1,2] 2+1，pos 2 空。pos 2 邻居 [1,14] 都是 AI（可达）。
// OPP 不在 [1,14] 中 → hardNearMill
(() => {
    setupBoard({
        ai: [0, 1, 14, 9],    // 4 pieces → MOVING phase
        opp: [21, 22, 23, 12], // 4 pieces → MOVING phase, not near pos 2
    });
    const r = EV.analyzeMillsBoth();
    assert(r.ai.hardNearMills >= 1, 'ai hardNearMill: opp cannot block pos 2');
})();

// placement 阶段修正：hardNearMills = max(0, nearMills - 1)
(() => {
    E.init({ opponentHand: 3, aiHand: 3 });
    const st = E.getStateView();
    st.own = (1 << 0) | (1 << 1);    // AI at 0, 1
    st.opp = (1 << 21) | (1 << 22);  // OPP at 21, 22
    st.playerAI.piecesOnBoard = 2;
    st.playerOpponent.piecesOnBoard = 2;

    const r = EV.analyzeMillsBoth();
    if (r.ai.nearMills >= 1) {
        assertEq(r.ai.hardNearMills, Math.max(0, r.ai.nearMills - 1), 'placement: hardNearMills = nearMills - 1');
    }
})();

// 高位 mill [21,22,23] 的 2+1 — u32 边界
(() => {
    setupBoard({
        ai: [21, 22, 14],     // [21,22,23] 2+1，pos 23 的邻居 [14,22]
        opp: [0, 1, 2],
    });
    const r = EV.analyzeMillsBoth();
    assert(r.ai.nearMills >= 1, 'high bit mill [21,22,23]: nearMill detected');
})();

// ==================== 2. countMobility ====================
section('countMobility');

// PLACEMENT 阶段：返回所有空位数
(() => {
    E.init({ opponentHand: 3, aiHand: 3 });
    const st = E.getStateView();
    st.opp = (1 << 0);  // OPP at 0
    st.own = (1 << 1);  // AI at 1
    st.playerOpponent.piecesOnBoard = 1;
    st.playerAI.piecesOnBoard = 1;

    const mob = EV.countMobility(E.TYPE_OPPONENT);
    assertEq(mob, 22, 'PLACEMENT: mobility = empty count = 22');
})();

// FLYING 阶段：返回所有空位数
(() => {
    setupBoard({
        opp: [0, 1, 2],
        ai: [21, 22, 23],
    });
    const mob = EV.countMobility(E.TYPE_OPPONENT);
    assertEq(mob, 18, 'FLYING: mobility = empty count = 18');
})();

// MOVING 阶段：返回有己方邻居的空位数
(() => {
    setupBoard({
        opp: [0, 1, 2],       // 横线 mill
        ai: [21, 22, 23],
    });
    // OPP 在 [0,1,2]，空位中哪些有 OPP 邻居？
    // pos 0 邻居 [1,9] → pos 9 空且有 OPP 邻居 ✓
    // pos 1 邻居 [0,2,4] → pos 4 空 ✓
    // pos 2 邻居 [1,14] → pos 14 空 ✓
    const mob = EV.countMobility(E.TYPE_OPPONENT);
    assert(mob > 0, 'MOVING: mobility > 0');
    assert(mob <= 18, 'MOVING: mobility <= empty count');
})();

// 全满棋盘 → 0
(() => {
    setupBoard({
        opp: [0,1,2,3,4,5,6,7,8,9,10,11],
        ai: [12,13,14,15,16,17,18,19,20,21,22,23],
    });
    const mob = EV.countMobility(E.TYPE_OPPONENT);
    assertEq(mob, 0, 'full board: mobility = 0');
})();

// ==================== 3. getPieceMobility ====================
section('getPieceMobility');

// 正常情况
(() => {
    setupBoard({
        opp: [0, 1],
        ai: [21, 22, 23],
    });
    const result = EV.getPieceMobility(E.TYPE_OPPONENT);
    assertEq(result.length, 2, 'getPieceMobility: 2 OPP pieces');
    // pos 0 邻居 [1,9]，pos 1 被 OPP 占，pos 9 空 → mobility = 1
    const pos0 = result.find(r => r.pos === 0);
    assert(pos0, 'pos 0 found');
    assertEq(pos0.mobility, 1, 'pos 0 mobility = 1 (neighbor 9 is empty)');
    // pos 1 邻居 [0,2,4]，pos 0 被 OPP 占，pos 2 和 4 空 → mobility = 2
    const pos1 = result.find(r => r.pos === 1);
    assert(pos1, 'pos 1 found');
    assertEq(pos1.mobility, 2, 'pos 1 mobility = 2 (neighbors 2,4 empty)');
})();

// 单子
(() => {
    setupBoard({
        opp: [4],             // pos 4 邻居 [1,3,5,7]
        ai: [21, 22, 23],
    });
    const result = EV.getPieceMobility(E.TYPE_OPPONENT);
    assertEq(result.length, 1, 'single piece: 1 entry');
    assertEq(result[0].mobility, 4, 'pos 4 mobility = 4 (all neighbors empty)');
})();

// ==================== 4. evaluate ====================
section('evaluate');

// 终局：AI 赢
(() => {
    setupBoard({
        opp: [0],
        ai: [21, 22, 23],
    });
    const st = E.getStateView();
    st.gameOver = true;
    st.winner = E.TYPE_AI;

    const score = EV.evaluate(0, null);
    assert(score > 0, 'AI win: positive score');
    assert(score >= 10000, 'AI win: score >= 10000');
})();

// 终局：对手赢
(() => {
    setupBoard({
        opp: [0, 1, 2],
        ai: [21],
    });
    const st = E.getStateView();
    st.gameOver = true;
    st.winner = E.TYPE_OPPONENT;

    const score = EV.evaluate(0, null);
    assert(score < 0, 'opp win: negative score');
    assert(score <= -10000, 'opp win: score <= -10000');
})();

// 终局：平局
(() => {
    setupBoard({});
    const st = E.getStateView();
    st.gameOver = true;
    st.winner = null;

    const score = EV.evaluate(0, null);
    assertEq(score, 0, 'draw: score = 0');
})();

// 非终局：有分数
(() => {
    setupBoard({
        opp: [0, 1, 9],
        ai: [21, 22, 23],
    });
    const score = EV.evaluate(0, null);
    assert(typeof score === 'number', 'non-terminal: score is number');
})();

// ==================== 总结 ====================
console.log(`\n========================================`);
console.log(`Evaluator tests: ${passed}/${total} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0) process.exit(1);
