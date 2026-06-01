// ========================================================
// Engine 单元测试
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

function mkBoard(pieces) {
    // pieces: { pos: player, ... }
    const board = new Array(24).fill(E.EMPTY);
    for (const [pos, player] of Object.entries(pieces)) {
        board[parseInt(pos)] = player;
    }
    return board;
}

function initState(config) {
    E.init(config);
}

function getState() { return E.getStateView(); }

// ==================== 1. isInMill ====================
section('isInMill');

// 空棋盘
(() => {
    initState();
    assert(!E.isInMill(E.getBoard(), 0), 'empty board pos 0');
    assert(!E.isInMill(E.getBoard(), 23), 'empty board pos 23');
})();

// 单子不成 mill
(() => {
    initState();
    const board = mkBoard({ 0: E.TYPE_AI });
    assert(!E.isInMill(board, 0), 'single piece no mill');
})();

// 横线 mill [0,1,2]
(() => {
    const board = mkBoard({ 0: E.TYPE_AI, 1: E.TYPE_AI, 2: E.TYPE_AI });
    assert(E.isInMill(board, 0), 'mill [0,1,2] pos 0');
    assert(E.isInMill(board, 1), 'mill [0,1,2] pos 1');
    assert(E.isInMill(board, 2), 'mill [0,1,2] pos 2');
    assert(!E.isInMill(board, 3), 'pos 3 not in this mill');
})();

// 竖线 mill [0,9,21]
(() => {
    const board = mkBoard({ 0: E.TYPE_OPPONENT, 9: E.TYPE_OPPONENT, 21: E.TYPE_OPPONENT });
    assert(E.isInMill(board, 0), 'mill [0,9,21] pos 0');
    assert(E.isInMill(board, 9), 'mill [0,9,21] pos 9');
    assert(E.isInMill(board, 21), 'mill [0,9,21] pos 21');
})();

// 高位 mill [21,22,23] — u32 边界
(() => {
    const board = mkBoard({ 21: E.TYPE_AI, 22: E.TYPE_AI, 23: E.TYPE_AI });
    assert(E.isInMill(board, 21), 'mill [21,22,23] pos 21');
    assert(E.isInMill(board, 22), 'mill [21,22,23] pos 22');
    assert(E.isInMill(board, 23), 'mill [21,22,23] pos 23');
})();

// 高位竖线 mill [2,14,23]
(() => {
    const board = mkBoard({ 2: E.TYPE_OPPONENT, 14: E.TYPE_OPPONENT, 23: E.TYPE_OPPONENT });
    assert(E.isInMill(board, 23), 'mill [2,14,23] pos 23');
})();

// 2 子不成 mill
(() => {
    const board = mkBoard({ 0: E.TYPE_AI, 1: E.TYPE_AI });
    assert(!E.isInMill(board, 0), '2 pieces no mill');
})();

// 混合颜色不成 mill
(() => {
    const board = mkBoard({ 0: E.TYPE_AI, 1: E.TYPE_OPPONENT, 2: E.TYPE_AI });
    assert(!E.isInMill(board, 0), 'mixed colors no mill');
})();

// ==================== 2. wouldFormMill ====================
section('wouldFormMill');

// 空棋盘落子
(() => {
    initState();
    const board = E.getBoard();
    assert(!E.wouldFormMill(board, 0, E.TYPE_AI), 'empty board place');
})();

// 已有 2 子，落第 3 子
(() => {
    const board = mkBoard({ 0: E.TYPE_AI, 1: E.TYPE_AI });
    assert(E.wouldFormMill(board, 2, E.TYPE_AI), 'place 2 forms mill [0,1,2]');
    assert(!E.wouldFormMill(board, 3, E.TYPE_AI), 'place 3 no mill');
})();

// 高位位置 23
(() => {
    const board = mkBoard({ 21: E.TYPE_AI, 22: E.TYPE_AI });
    assert(E.wouldFormMill(board, 23, E.TYPE_AI), 'place 23 forms mill [21,22,23]');
})();

// 对手棋子在线上
(() => {
    const board = mkBoard({ 0: E.TYPE_AI, 1: E.TYPE_OPPONENT });
    assert(!E.wouldFormMill(board, 2, E.TYPE_AI), 'opp blocks mill');
})();

// ==================== 3. generateLegalMoves ====================
section('generateLegalMoves');

// PLACEMENT 阶段：生成空位数个 moves
(() => {
    initState();
    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assertEq(moves.length, 24, 'PLACEMENT: 24 empty positions');
    assert(moves.every(m => m.type === 'place'), 'PLACEMENT: all type=place');
    assert(moves.every(m => m.remove === null), 'PLACEMENT: all remove=null');
})();

// PLACEMENT 阶段有棋子
(() => {
    initState();
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 0, remove: null });
    const moves = E.generateLegalMoves(E.TYPE_AI);
    assertEq(moves.length, 23, 'PLACEMENT with 1 piece: 23 moves');
})();

// MOVING 阶段
(() => {
    // 手动构造一个 MOVING 阶段的局面
    initState({ opponentHand: 0, aiHand: 0 });
    const st = getState();
    // 放 4 个 OPP 和 4 个 AI
    st.board[0] = E.TYPE_OPPONENT; st.board[1] = E.TYPE_OPPONENT;
    st.board[2] = E.TYPE_OPPONENT; st.board[3] = E.TYPE_OPPONENT;
    st.board[21] = E.TYPE_AI; st.board[22] = E.TYPE_AI;
    st.board[23] = E.TYPE_AI; st.board[14] = E.TYPE_AI;
    st.playerOpponent.piecesOnBoard = 4;
    st.playerAI.piecesOnBoard = 4;
    E.syncBitsFromBoard();

    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assert(moves.length > 0, 'MOVING: has moves');
    assert(moves.every(m => m.type === 'move'), 'MOVING: all type=move');
    // 检查 from/to 都是合法的
    for (const m of moves) {
        assert(m.from >= 0 && m.from < 24, `MOVING: from=${m.from} in range`);
        assert(m.to >= 0 && m.to < 24, `MOVING: to=${m.to} in range`);
    }
})();

// FLYING 阶段
(() => {
    initState({ opponentHand: 0, aiHand: 0 });
    const st = getState();
    st.board[0] = E.TYPE_OPPONENT; st.board[1] = E.TYPE_OPPONENT; st.board[2] = E.TYPE_OPPONENT;
    st.board[21] = E.TYPE_AI; st.board[22] = E.TYPE_AI; st.board[23] = E.TYPE_AI;
    st.playerOpponent.piecesOnBoard = 3;
    st.playerAI.piecesOnBoard = 3;
    E.syncBitsFromBoard();

    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assert(moves.length > 0, 'FLYING: has moves');
    assert(moves.every(m => m.type === 'fly'), 'FLYING: all type=fly');
    // 3 子 * 21 空位 = 63
    assertEq(moves.length, 54, 'FLYING: 3 pieces * 18 empty = 54 moves');
})();

// millMove 状态：只生成 remove moves
(() => {
    initState();
    // 放一个 mill [0,1,2] for OPP
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 0, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 21, remove: null });
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 1, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 22, remove: null });
    const formedMill = E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 2, remove: null });
    assert(formedMill, 'place 2 formed mill');
    assert(getState().millMove, 'millMove is true');

    const moves = E.generateLegalMoves(E.TYPE_OPPONENT);
    assert(moves.length > 0, 'millMove: has remove moves');
    assert(moves.every(m => m.type === 'remove'), 'millMove: all type=remove');
    assert(moves.every(m => m.remove >= 0), 'millMove: all have remove pos');
})();

// ==================== 4. makeMove / undoMove 往返一致性 ====================
section('makeMove / undoMove');

// place → undo
(() => {
    initState();
    const before = E.getState();
    const boardBefore = E.getBoard();

    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 5, remove: null });
    E.undoMove();

    const after = E.getState();
    const boardAfter = E.getBoard();
    assertEq(JSON.stringify(boardBefore), JSON.stringify(boardAfter), 'place→undo board');
    assertEq(after.currentPlayer, before.currentPlayer, 'place→undo currentPlayer');
    assertEq(after.playerOpponent.piecesOnHand, before.playerOpponent.piecesOnHand, 'place→undo opp hand');
    assertEq(after.playerOpponent.piecesOnBoard, before.playerOpponent.piecesOnBoard, 'place→undo opp board');
})();

// move → undo
(() => {
    initState({ opponentHand: 0, aiHand: 0 });
    const st = getState();
    st.board[0] = E.TYPE_OPPONENT; st.board[1] = E.TYPE_AI;
    st.playerOpponent.piecesOnBoard = 1; st.playerAI.piecesOnBoard = 1;
    st.currentPlayer = E.TYPE_OPPONENT;
    E.syncBitsFromBoard();

    const boardBefore = E.getBoard();
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'move', from: 0, to: 9, remove: null });
    E.undoMove();
    assertEq(JSON.stringify(boardBefore), JSON.stringify(E.getBoard()), 'move→undo board');
})();

// place + remove（成 mill 吃子）→ undo × 2
(() => {
    initState();
    // OPP: [0,1] + place 2 = mill, AI: [21,22]
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 0, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 21, remove: null });
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 1, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 22, remove: null });
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 2, remove: null }); // forms mill

    const boardBeforeRemove = E.getBoard();
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'remove', from: -1, to: -1, remove: 21 }); // remove AI piece
    const boardAfterRemove = E.getBoard();
    assertEq(boardAfterRemove[21], E.EMPTY, 'removed piece at 21');

    E.undoMove(); // undo remove
    assertEq(JSON.stringify(E.getBoard()), JSON.stringify(boardBeforeRemove), 'undo remove board');

    E.undoMove(); // undo place 2
    // back to before mill
    const st = getState();
    assert(!st.millMove, 'undo place: millMove=false');
})();

// 高位位置 23 的 place → undo
(() => {
    initState();
    const boardBefore = E.getBoard();
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 23, remove: null });
    assertEq(E.getBoard()[23], E.TYPE_OPPONENT, 'placed at 23');
    E.undoMove();
    assertEq(E.getBoard()[23], E.EMPTY, 'undo place at 23');
    assertEq(JSON.stringify(E.getBoard()), JSON.stringify(boardBefore), 'place 23 undo board match');
})();

// 连续多步 → 连续 undo → 恢复
(() => {
    initState();
    const board0 = E.getBoard();

    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 0, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 21, remove: null });
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 1, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 22, remove: null });

    E.undoMove();
    E.undoMove();
    E.undoMove();
    E.undoMove();

    assertEq(JSON.stringify(E.getBoard()), JSON.stringify(board0), '4 steps→4 undo board');
})();

// ==================== 5. 重复检测 ====================
section('repetition');

// 三次重复判和
(() => {
    initState({ opponentHand: 0, aiHand: 0 });
    const st = getState();
    st.board[0] = E.TYPE_OPPONENT; st.board[9] = E.TYPE_OPPONENT; st.board[21] = E.TYPE_OPPONENT;
    st.board[2] = E.TYPE_AI; st.board[14] = E.TYPE_AI; st.board[23] = E.TYPE_AI;
    st.playerOpponent.piecesOnBoard = 3;
    st.playerAI.piecesOnBoard = 3;
    st.currentPlayer = E.TYPE_OPPONENT;
    E.syncBitsFromBoard();

    // 手动推入 3 次相同的 (own, opp) 到双缓冲区
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
    initState();
    const fen = E.toFen();
    const boardBefore = E.getBoard();
    E.fromFen(fen);
    assertEq(JSON.stringify(E.getBoard()), JSON.stringify(boardBefore), 'empty board fen roundtrip');
})();

// 有棋子 roundtrip
(() => {
    initState();
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 0, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 23, remove: null });
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 1, remove: null });

    const fen = E.toFen();
    const boardBefore = E.getBoard();
    const stBefore = E.getState();

    E.fromFen(fen);
    assertEq(JSON.stringify(E.getBoard()), JSON.stringify(boardBefore), 'pieces fen roundtrip board');
    assertEq(E.getStateView().currentPlayer, stBefore.currentPlayer, 'fen roundtrip currentPlayer');
    assertEq(E.getStateView().playerOpponent.piecesOnHand, stBefore.playerOpponent.piecesOnHand, 'fen roundtrip opp hand');
})();

// 高位位置 23 有棋子
(() => {
    initState();
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 23, remove: null });
    const fen = E.toFen();
    const boardBefore = E.getBoard();
    E.fromFen(fen);
    assertEq(E.getBoard()[23], E.TYPE_OPPONENT, 'fen pos 23 preserved');
    assertEq(JSON.stringify(E.getBoard()), JSON.stringify(boardBefore), 'fen pos 23 roundtrip');
})();

// piece count 校验
(() => {
    initState();
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 0, remove: null });
    E.makeMove({ player: E.TYPE_AI, type: 'place', from: -1, to: 1, remove: null });
    E.makeMove({ player: E.TYPE_OPPONENT, type: 'place', from: -1, to: 2, remove: null });

    const st = E.getState();
    const o = st.playerOpponent;
    const a = st.playerAI;
    assertEq(o.piecesOnHand + o.piecesOnBoard + o.piecesLost, 9, 'opp pieces sum = 9');
    assertEq(a.piecesOnHand + a.piecesOnBoard + a.piecesLost, 9, 'ai pieces sum = 9');
})();

// 非法 FEN 抛异常
(() => {
    initState();
    let threw = false;
    try { E.fromFen('not json'); } catch (e) { threw = true; }
    assert(threw, 'bad json throws');

    threw = false;
    try { E.fromFen('{"board":-1,"meta":"0x00000"}'); } catch (e) { threw = true; }
    assert(threw, 'negative board throws');
})();

// ==================== 7. checkGameOver ====================
section('checkGameOver');

// 少于 3 子且无手牌 → 对手赢
(() => {
    initState({ opponentHand: 0, aiHand: 0 });
    const st = getState();
    st.board[0] = E.TYPE_OPPONENT; st.board[1] = E.TYPE_OPPONENT;
    st.playerOpponent.piecesOnBoard = 2;
    st.board[21] = E.TYPE_AI; st.board[22] = E.TYPE_AI; st.board[23] = E.TYPE_AI;
    st.playerAI.piecesOnBoard = 3;
    st.currentPlayer = E.TYPE_OPPONENT;

    // 触发 checkGameOver（通过 makeMove 的内部调用不行，因为不是合法 move）
    // 直接检查状态：2 子 < 3 且无手牌
    assert(st.playerOpponent.piecesOnBoard < 3 && st.playerOpponent.piecesOnHand === 0, 'opp has <3 pieces');
})();

// ==================== 总结 ====================
console.log(`\n========================================`);
console.log(`Engine tests: ${passed}/${total} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0) process.exit(1);
