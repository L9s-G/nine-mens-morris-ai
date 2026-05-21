// undoMove 压力测试
// 1. 随机执行 N 步 makeMove
// 2. 执行 N 步 undoMove
// 3. 比对最终状态与初始状态

const fs = require('fs');
const vm = require('vm');

// 加载 engine.js（浏览器 IIFE 格式，用 vm 执行）
const code = fs.readFileSync('./engine.js', 'utf-8');
const sandbox = { console, Engine: null };
vm.createContext(sandbox);
// 将 const Engine 改为赋值给 sandbox.Engine
const patchedCode = code.replace('const Engine = (() => {', 'Engine = (() => {');
vm.runInContext(patchedCode, sandbox);
const Engine = sandbox.Engine;

const N = 100;
let passed = 0;
let failed = 0;

for (let test = 0; test < N; test++) {
    // 随机选择先手
    const firstPlayer = Math.random() < 0.5 ? Engine.TYPE_HUMAN : Engine.TYPE_AI;
    Engine.init({ firstPlayer });

    const initialFen = Engine.toFen();
    const moves = [];

    // 随机执行 50~150 步
    const steps = 50 + Math.floor(Math.random() * 100);

    for (let i = 0; i < steps; i++) {
        // 游戏结束则停止
        const state = Engine.getState();
        if (state.gameOver) break;

        const legalMoves = Engine.generateLegalMoves(state.currentPlayer);
        if (legalMoves.length === 0) break;

        const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        Engine.makeMove(move);
        moves.push(move);
    }

    // 撤销所有走法
    for (let i = moves.length - 1; i >= 0; i--) {
        Engine.undoMove();
    }

    // 比对状态
    const finalFen = Engine.toFen();
    const finalState = Engine.getState();

    if (initialFen === finalFen &&
        finalState.gameOver === false &&
        finalState.winner === null &&
        finalState.moveHistory.length === 0) {
        passed++;
    } else {
        failed++;
        console.log(`[FAIL] Test #${test}: FEN mismatch`);
        console.log(`  Initial: ${initialFen}`);
        console.log(`  Final:   ${finalFen}`);
        console.log(`  Moves played: ${moves.length}`);
        console.log(`  History left: ${finalState.moveHistory.length}`);
    }
}

console.log(`\n=== undoMove Stress Test ===`);
console.log(`Total: ${N}, Passed: ${passed}, Failed: ${failed}`);
if (failed === 0) console.log("All tests passed!");
