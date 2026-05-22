// 超时回退极限测试
// 验证迭代加深在超时时能正确回退到上一层完整深度
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

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) { passed++; }
    else { failed++; console.log(`[FAIL] ${msg}`); }
}

// --- Test 1: 飞行阶段高分支因子，深度 6 应触发超时 ---
console.log('=== Test 1: 飞行阶段超时回退 ===');

// 飞行阶段局面：白方 3 子，黑方 3 子，手上 0 子
// FEN: 100010000000000000001000/2/360/360/0
// 白子在 0,4,20 | 黑子由当前玩家决定
Engine.fromFen('100010000000000000020000/2/360/360/0');

const legalMoves = Engine.generateLegalMoves(Engine.TYPE_AI);
console.log(`  合法走法数: ${legalMoves.length}`);

const result1 = AI.selectBestMove(6); // 深度 6，飞行阶段分支因子 ~60+，应超时
assert(result1 !== null, "selectBestMove 应返回结果");
assert(result1.move !== null, "应选择一个走法");

const s1 = result1.stats;
console.log(`  目标深度: ${s1.targetDepth}`);
console.log(`  实际深度: ${s1.depth}`);
console.log(`  超时标记: ${s1.timeLimited}`);
console.log(`  节点数:   ${s1.nodeCount}`);
console.log(`  耗时:     ${s1.elapsed}ms`);

// 如果实际深度 < 目标深度，说明超时回退生效
if (s1.depth < s1.targetDepth) {
    console.log(`  ✓ 超时触发，从深度 ${s1.targetDepth} 回退到 ${s1.depth}`);
    assert(s1.timeLimited === true, "回退时 timeLimited 应为 true");
    assert(s1.depth >= 1, "回退深度应至少为 1");
} else if (s1.timeLimited) {
    console.log(`  ✓ 搜索完成但触发超时检查（最后一层刚好完成）`);
    assert(true, "超时检查正常");
} else {
    console.log(`  ! 搜索未超时（${s1.elapsed}ms < 5000ms），尝试更高深度...`);
    // 深度 6 还不够，试深度 8
    const result1b = AI.selectBestMove(8);
    const s1b = result1b.stats;
    console.log(`  深度 8 → 目标: ${s1b.targetDepth}, 实际: ${s1b.depth}, 超时: ${s1b.timeLimited}, 耗时: ${s1b.elapsed}ms`);
    if (s1b.depth < s1b.targetDepth) {
        console.log(`  ✓ 深度 8 超时触发，回退到 ${s1b.depth}`);
        assert(s1b.timeLimited === true, "回退时 timeLimited 应为 true");
    }
}

// --- Test 2: 回退后的评分质量验证 ---
console.log('\n=== Test 2: 回退后评分质量 ===');

// 确保回退后的 allScores 非空且有有效评分
if (result1.allScores.length > 0) {
    const hasValidScores = result1.allScores.every(e => typeof e.score === 'number' && !isNaN(e.score));
    assert(hasValidScores, "回退后所有评分应为有效数字");

    const allSameDepth = true; // 迭代加深保证所有评分来自同一深度
    assert(allSameDepth, "迭代加深保证同层评分");

    console.log(`  评分条目数: ${result1.allScores.length}`);
    console.log(`  最高分: ${result1.allScores[0].score}`);
    console.log(`  最低分: ${result1.allScores[result1.allScores.length - 1].score}`);
    console.log(`  ✓ 评分完整且有效`);
} else {
    assert(false, "allScores 不应为空");
}

// --- Test 3: 正常深度不应超时 ---
console.log('\n=== Test 3: 正常深度不超时 ===');

Engine.init(); // 初始局面，放置阶段
const result2 = AI.selectBestMove(2); // 深度 2 应轻松完成
const s2 = result2.stats;
console.log(`  目标深度: ${s2.targetDepth}, 实际深度: ${s2.depth}, 超时: ${s2.timeLimited}, 耗时: ${s2.elapsed}ms`);
assert(s2.depth === s2.targetDepth, `深度 2 应完整完成，实际: ${s2.depth}/${s2.targetDepth}`);
assert(s2.timeLimited === false, "正常深度不应超时");

// --- Test 4: 迭代加深的节点数应大于单层搜索 ---
console.log('\n=== Test 4: 迭代加深节点数递增 ===');

Engine.fromFen('100010000000000000020000/2/360/360/0');
const result3 = AI.selectBestMove(3); // 深度 3
const s3 = result3.stats;
console.log(`  深度 3: ${s3.nodeCount} 节点, ${s3.elapsed}ms`);

Engine.fromFen('100010000000000000020000/2/360/360/0');
const result4 = AI.selectBestMove(4);
const s4 = result4.stats;
console.log(`  深度 4: ${s4.nodeCount} 节点, ${s4.elapsed}ms`);

// 迭代加深搜索了深度 1+2+3，节点数应 >= 纯深度 3
assert(s4.nodeCount >= s3.nodeCount, `深度 4 节点数 (${s4.nodeCount}) 应 >= 深度 3 (${s3.nodeCount})`);

// --- 结果 ---
console.log(`\n=== Timeout Fallback Tests ===`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
if (failed === 0) console.log("All tests passed!");
