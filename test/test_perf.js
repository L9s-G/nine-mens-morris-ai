// 性能测试：不同深度的搜索耗时与节点数
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const srcDir = path.resolve(__dirname, '..');

const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const strategyCode = fs.readFileSync(path.join(srcDir, 'strategy.js'), 'utf-8').replace('const Strategy = (() => {', 'Strategy = (() => {');
const aiCode = fs.readFileSync(path.join(srcDir, 'ai.js'), 'utf-8').replace('const AI = (() => {', 'AI = (() => {');

const sandbox = { console, Engine: null, Strategy: null, AI: null };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(strategyCode, sandbox);
vm.runInContext(aiCode, sandbox);

const Engine = sandbox.Engine;
const AI = sandbox.AI;

console.log('=== Nine Men's Morris AI 性能测试 ===\n');

// 测试不同深度
const depths = [2, 3, 4, 5, 6];

console.log('--- 初始局面（放置阶段，24 个空位）---');
console.log('深度 | 节点数    | 耗时(ms) | 节点/ms | 最佳走法');
console.log('-----|----------|----------|---------|--------');

for (const d of depths) {
    Engine.init();
    const result = AI.selectBestMove(d);
    const s = result.stats;
    const moveDesc = `place→${result.move.to}`;
    console.log(`  ${d}   | ${String(s.nodeCount).padStart(8)} | ${String(s.elapsed).padStart(8)} | ${String(s.nodesPerMs).padStart(7)} | ${moveDesc}`);
}

// 测试中盘局面
console.log('\n--- 中盘局面（走子阶段）---');
Engine.init({ firstPlayer: Engine.TYPE_AI });

// 放置 18 个棋子（每方 9 个）
const placementMoves = [
    [Engine.TYPE_AI, 0], [Engine.TYPE_OPPONENT, 1],
    [Engine.TYPE_AI, 2], [Engine.TYPE_OPPONENT, 3],
    [Engine.TYPE_AI, 4], [Engine.TYPE_OPPONENT, 5],
    [Engine.TYPE_AI, 6], [Engine.TYPE_OPPONENT, 7],
    [Engine.TYPE_AI, 8], [Engine.TYPE_OPPONENT, 9],
    [Engine.TYPE_AI, 10], [Engine.TYPE_OPPONENT, 11],
    [Engine.TYPE_AI, 12], [Engine.TYPE_OPPONENT, 13],
    [Engine.TYPE_AI, 14], [Engine.TYPE_OPPONENT, 15],
    [Engine.TYPE_AI, 16], [Engine.TYPE_OPPONENT, 17],
];

for (const [player, pos] of placementMoves) {
    Engine.makeMove({ player, type: 'place', from: -1, to: pos, remove: null });
}

console.log('深度 | 节点数    | 耗时(ms) | 节点/ms | 最佳走法');
console.log('-----|----------|----------|---------|--------');

for (const d of depths) {
    const result = AI.selectBestMove(d);
    const s = result.stats;
    const moveDesc = result.move.type === 'place' ?
        `place→${result.move.to}` :
        `${result.move.from}→${result.move.to}`;
    console.log(`  ${d}   | ${String(s.nodeCount).padStart(8)} | ${String(s.elapsed).padStart(8)} | ${String(s.nodesPerMs).padStart(7)} | ${moveDesc}`);
}

// 测试性能模式切换
console.log('\n--- 性能模式对比 ---');
Engine.init();

for (const mode of ['Eco', 'Normal', 'Master']) {
    AI.setPerformanceMode(mode);
    const config = AI.getPerformanceConfig();
    const result = AI.selectBestMove();
    const s = result.stats;
    console.log(`${config.label.padStart(8)} (D=${config.depth}): ${s.nodeCount} 节点, ${s.elapsed}ms`);
}

// 测试陷阱检测开销
console.log('\n--- 陷阱检测开销（D=0 vs D=2 作为浅层）---');
Engine.init();
AI.setPerformanceMode('Normal');

const baseResult = AI.selectBestMove();
console.log(`基础搜索 (D=4): ${baseResult.stats.nodeCount} 节点, ${baseResult.stats.elapsed}ms`);

// 陷阱检测开销
const trapStart = Date.now();
const withTraps = AI.detectTraps(baseResult.allScores.slice(0, 3), Engine.TYPE_AI, 50);
const trapElapsed = Date.now() - trapStart;
console.log(`陷阱检测 (top 3, D=0 vs D=4): ${trapElapsed}ms`);

const trapMoves = withTraps.filter(m => m.tags.includes('HIDDEN_TRAP'));
console.log(`发现陷阱走法: ${trapMoves.length} 个`);

console.log('\n=== 测试完成 ===');
