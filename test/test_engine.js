// ========================================================
// Engine 单元测试 — Bitboard 原生版
// 用法: node test/test_engine.js
// ========================================================

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8')
    .replace('const Engine = (() => {', 'Engine = (() => {');

const sandbox = { console, Engine: null, Math };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
const E = sandbox.Engine;

let passed = 0, failed = 0, total = 0;
function assert(cond, msg) { total++; if (cond) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } }
function assertEq(a, b, msg) { assert(a === b, `${msg} (expected ${b}, got ${a})`); }
function section(name) { console.log(`\n--- ${name} ---`); }

// ==================== 辅助函数 ====================

/** 快捷编码：mk(TYPE_OPPONENT, 'place', -1, 5) → encoded integer */
function mk(player, type, from, to, remove) {
    return E.encodeMove(player, E.TYPE_ENCODE[type], from, to, remove);
}

/** 解码 move 的 remove 字段是否为 null */
function moveRemoveNull(m) {
    return ((m >> 10) & 0x1F) === E.MOVE_NONE;
}

/** 解码 move 的 type 字段（返回字符串） */
function moveType(m) {
    return E.TYPE_DECODE[(m >> 15) & 3];
}

/** 设置棋盘：ai=[pos,...], opp=[pos,...] */
function setupBoard(ai, opp) {
    E.init({ opponentHand: 0, aiHand: 0 });
    const st = E.getStateView();
    let own = 0, oppBits = 0;
    if (ai) for (const p of ai) own |= (1 << p);
    if (opp) for (const p of opp) oppBits |= (1 << p);
    st.own = own;
    st.opp = oppBits;
    st.playerAI.piecesOnBoard = ai ? ai.length : 0;
    st.playerOpponent.piecesOnBoard = opp ? opp.length : 0;
    return st;
}

/** 检查 playerBits 在 pos 是否成 mill */
function checkIsInMill(playerBits, pos) {
    const pms = E.POSITION_MILLS[pos];
    for (let i = 0; i < pms.length; i++) {
        if ((playerBits & E.MILL_MASKS[pms[i]]) === E.MILL_MASKS[pms[i]]) return true;
    }
    return false;
}

/** 检查在 to 落子是否会成 mill */
function checkWouldFormMill(playerBits, to) {
    const pms = E.POSITION_MILLS[to];
    for (let i = 0; i < pms.length; i++) {
        if ((playerBits & E.MILL_WITHOUT[to][i]) === E.MILL_WITHOUT[to][i]) return true;
    }
    return false;
}

// ==================== 1. isInMill ====================
section('isInMill (via bitboard)');

// 空棋盘
(() => {
    setupBoard([], []);
    assert(!checkIsInMill(E.getOwn(), 0), 'empty board pos 0');
    assert(!checkIsInMill(E.getOwn(), 23), 'empty board pos 23');
})();

// 单子不成 mill
(() => {
    setupBoard([0], []);
    assert(!checkIsInMill(E.getOwn(), 0), 'single piece no mill');
})();

// 横线 mill [0,1,2]
(() => {
    setupBoard([0, 1, 2], []);
    assert(checkIsInMill(E.getOwn(), 0), 'mill [0,1,2] pos 0');
    assert(checkIsInMill(E.getOwn(), 1), 'mill [0,1,2] pos 1');
    assert(checkIsInMill(E.getOwn(), 2), 'mill [0,1,2] pos 2');
    assert(!checkIsInMill(E.getOwn(), 3), 'pos 3 not in this mill');
})();

// 竖线 mill [0,9,21]
(() => {
    setupBoard([], [0, 9, 21]);
    assert(checkIsInMill(E.getOpp(), 0), 'mill [0,9,21] pos 0');
    assert(checkIsInMill(E.getOpp(), 9), 'mill [0,9,21] pos 9');
    assert(checkIsInMill(E.getOpp(), 21), 'mill [0,9,21] pos 21');
})();

// 高位 mill [21,22,23] — u32 边界
(() => {
    setupBoard([21, 22, 23], []);
    assert(checkIsInMill(E.getOwn(), 21), 'mill [21,22,23] pos 21');
    assert(checkIsInMill(E.getOwn(), 22), 'mill [21,22,23] pos 22');
    assert(checkIsInMill(E.getOwn(), 23), 'mill [21,22,23] pos 23');
})();

// 高位竖线 mill [2,14,23]
(() => {
    setupBoard([], [2, 14, 23]);
    assert(checkIsInMill(E.getOpp(), 23), 'mill [2,14,23] pos 23');
})();

// 2 子不成 mill
(() => {
    setupBoard([0, 1], []);
    assert(!checkIsInMill(E.getOwn(), 0), '2 pieces no mill');
})();

// 混合颜色不成 mill
(() => {
    E.init({ opponentHand: 0, aiHand: 0 });
    const st = E.getStateView();
    st.own = (1 << 0) | (1 << 2);  // AI at 0, 2
    st.opp = (1 << 1);              // OPP at 1
    assert(!checkIsInMill(st.own, 0), 'mixed colors no mill');
})();

// ==================== 2. wouldFormMill ====================
section('wouldFormMill (via bitboard)');

// 空棋盘落子
(() => {
    setupBoard([], []);
    assert(!checkWouldFormMill(E.getOwn(), 0), 'empty board place');
})();

// 已有 2 子，落第 3 子
(() => {
    setupBoard([0, 1], []);
    assert(checkWouldFormMill(E.getOwn(), 2), 'place 2 forms mill [0,1,2]');
    assert(!checkWouldFormMill(E.getOwn(), 3), 'place 3 no mill');
})();

// 高位位置 23
(() => {
    setupBoard([21, 22], []);
    assert(checkWouldFormMill(E.getOwn(), 23), 'place 23 forms mill [21,22,23]');
})();

// 对手棋子在线上
(() => {
    E.init({ opponentHand: 0, aiHand: 0 });
    const st = E.getStateView();
    st.own = (1 << 0);  // AI at 0
    st.opp = (1 << 1);  // OPP at 1
    assert(!checkWouldFormMill(st.own, 2), 'opp blocks mill');
})();

// ==================== 3. generateLegalMoves ====================
section('generateLegalMoves');

// PLACEMENT 阶段
(() => {
    E.init();
    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assertEq(moves.length, 24, 'PLACEMENT: 24 empty positions');
    assert(moves.every(m => moveType(m) === 'place'), 'PLACEMENT: all type=place');
    assert(moves.every(m => moveRemoveNull(m)), 'PLACEMENT: all remove=null');
})();

// PLACEMENT 阶段有棋子
(() => {
    E.init();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 0));
    const moves = E.generateLegalMoves(E.TYPE_AI);
    assertEq(moves.length, 23, 'PLACEMENT with 1 piece: 23 moves');
})();

// MOVING 阶段
(() => {
    const st = setupBoard([21, 22, 23, 14], [0, 1, 2, 3]);
    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assert(moves.length > 0, 'MOVING: has moves');
    assert(moves.every(m => moveType(m) === 'move'), 'MOVING: all type=move');
})();

// FLYING 阶段
(() => {
    const st = setupBoard([21, 22, 23], [0, 1, 2]);
    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assert(moves.length > 0, 'FLYING: has moves');
    assert(moves.every(m => moveType(m) === 'fly'), 'FLYING: all type=fly');
    assertEq(moves.length, 54, 'FLYING: 3 pieces * 18 empty = 54 moves');
})();

// millMove 状态：只生成 remove moves
(() => {
    E.init();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 0));
    E.makeMove(mk(E.TYPE_AI, 'place', -1, 21));
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 1));
    E.makeMove(mk(E.TYPE_AI, 'place', -1, 22));
    const formedMill = E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 2));
    assert(formedMill, 'place 2 formed mill');
    assert(E.getStateView().millMove, 'millMove is true');

    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assert(moves.length > 0, 'millMove: has remove moves');
    assert(moves.every(m => moveType(m) === 'remove'), 'millMove: all type=remove');
    assert(moves.every(m => !moveRemoveNull(m)), 'millMove: all have remove pos');
})();

// ==================== 4. makeMove / undoMove ====================
section('makeMove / undoMove');

// place → undo
(() => {
    E.init();
    const before = E.getState();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 5));
    E.undoMove();
    const after = E.getState();
    assertEq(after.own, before.own, 'place→undo own');
    assertEq(after.opp, before.opp, 'place→undo opp');
    assertEq(after.currentPlayer, before.currentPlayer, 'place→undo currentPlayer');
    assertEq(after.playerOpponent.piecesOnHand, before.playerOpponent.piecesOnHand, 'place→undo opp hand');
})();

// move → undo
(() => {
    setupBoard([1], [0]);
    E.getStateView().currentPlayer = E.TYPE_OPPONENT;
    const before = E.getState();
    E.makeMove(mk(E.TYPE_OPPONENT, 'move', 0, 9));
    E.undoMove();
    const after = E.getState();
    assertEq(after.own, before.own, 'move→undo own');
    assertEq(after.opp, before.opp, 'move→undo opp');
})();

// place + remove → undo × 2
(() => {
    E.init();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 0));
    E.makeMove(mk(E.TYPE_AI, 'place', -1, 21));
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 1));
    E.makeMove(mk(E.TYPE_AI, 'place', -1, 22));
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 2)); // forms mill

    const oppBefore = E.getOpp();
    E.makeMove(mk(E.TYPE_OPPONENT, 'remove', -1, -1, 21));
    assert((E.getOwn() & (1 << 21)) === 0, 'removed AI piece at 21');

    E.undoMove(); // undo remove
    assertEq(E.getOpp(), oppBefore, 'undo remove restores opp');

    E.undoMove(); // undo place 2
    assert(!E.getStateView().millMove, 'undo place: millMove=false');
})();

// 高位位置 23 place → undo
(() => {
    E.init();
    const before = E.getState();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 23));
    assert((E.getOpp() & (1 << 23)) !== 0, 'placed at 23');
    E.undoMove();
    assert((E.getOpp() & (1 << 23)) === 0, 'undo place at 23');
    assertEq(E.getOpp(), before.opp, 'place 23 undo opp match');
})();

// 连续多步 → 连续 undo → 恢复
(() => {
    E.init();
    const before = E.getState();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 0));
    E.makeMove(mk(E.TYPE_AI, 'place', -1, 21));
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 1));
    E.makeMove(mk(E.TYPE_AI, 'place', -1, 22));
    E.undoMove();
    E.undoMove();
    E.undoMove();
    E.undoMove();
    const after = E.getState();
    assertEq(after.own, before.own, '4 steps→4 undo own');
    assertEq(after.opp, before.opp, '4 steps→4 undo opp');
})();

// ==================== 5. 重复检测 ====================
section('repetition');

// 三次重复
(() => {
    const st = setupBoard([2, 14, 23], [0, 9, 21]);
    const own = st.own, opp = st.opp;
    st.posOwn[0] = own; st.posOpp[0] = opp;
    st.posOwn[1] = own; st.posOpp[1] = opp;
    st.posOwn[2] = own; st.posOpp[2] = opp;
    st.writeIdx = 3;
    assertEq(E.getRepetitionCount(), 3, 'repetition count = 3');
})();

// ==================== 6. toFen / fromFen ====================
section('toFen / fromFen');

// 空棋盘 roundtrip
(() => {
    E.init();
    const fen = E.toFen();
    const before = E.getState();
    E.fromFen(fen);
    const after = E.getState();
    assertEq(after.own, before.own, 'empty fen roundtrip own');
    assertEq(after.opp, before.opp, 'empty fen roundtrip opp');
})();

// 有棋子 roundtrip
(() => {
    E.init();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 0));
    E.makeMove(mk(E.TYPE_AI, 'place', -1, 23));
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 1));
    const fen = E.toFen();
    const before = E.getState();
    E.fromFen(fen);
    const after = E.getState();
    assertEq(after.own, before.own, 'pieces fen roundtrip own');
    assertEq(after.opp, before.opp, 'pieces fen roundtrip opp');
    assertEq(after.currentPlayer, before.currentPlayer, 'fen roundtrip currentPlayer');
})();

// 高位位置 23
(() => {
    E.init();
    E.makeMove(mk(E.TYPE_OPPONENT, 'place', -1, 23));
    const fen = E.toFen();
    E.fromFen(fen);
    assert((E.getOpp() & (1 << 23)) !== 0, 'fen pos 23 preserved');
})();

// 非法 FEN 抛异常
(() => {
    E.init();
    let threw = false;
    try { E.fromFen('not json'); } catch (e) { threw = true; }
    assert(threw, 'bad json throws');

    threw = false;
    try { E.fromFen('{"own":-1,"opp":0,"meta":"0x00000"}'); } catch (e) { threw = true; }
    assert(threw, 'negative own throws');
})();

// ==================== 7. checkGameOver ====================
section('checkGameOver');

// 少于 3 子且无手牌
(() => {
    setupBoard([21, 22, 23], [0, 1]);
    E.getStateView().playerOpponent.piecesOnHand = 0;
    E.getStateView().currentPlayer = E.TYPE_OPPONENT;
    // 2 子 < 3 且无手牌 → should be game over on next check
    assert(E.getStateView().playerOpponent.piecesOnBoard < 3 && E.getStateView().playerOpponent.piecesOnHand === 0, 'opp has <3 pieces');
})();

// ==================== 总结 ====================
console.log(`\n========================================`);
console.log(`Engine tests: ${passed}/${total} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0) process.exit(1);
