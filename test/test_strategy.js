// Strategy.js 功能测试
const fs = require('fs');
const vm = require('vm');

// 加载 Engine 和 Strategy
const engineCode = fs.readFileSync('./engine.js', 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const strategyCode = fs.readFileSync('./strategy.js', 'utf-8').replace('const Strategy = (() => {', 'Strategy = (() => {');

const sandbox = { console, Engine: null, Strategy: null };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(strategyCode, sandbox);

const Engine = sandbox.Engine;
const Strategy = sandbox.Strategy;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) { passed++; }
    else { failed++; console.log(`[FAIL] ${msg}`); }
}

// --- Test 1: 初始状态的战术报告 ---
Engine.init();
const report = Strategy.generateReport();

assert(report.context !== undefined, "报告应包含 context");
assert(report.metrics !== undefined, "报告应包含 metrics");
assert(report.suggestedMoves !== undefined, "报告应包含 suggestedMoves");
assert(report.context.phase === 'PLACEMENT', "初始阶段应为 PLACEMENT");
assert(report.context.materialDiff === 0, "初始材料差应为 0");
assert(report.context.isOpponentNearFlying === false, "初始对方不应接近飞行");
assert(report.metrics.mobilityGap !== undefined, "应有 mobilityGap");
assert(report.metrics.tensionScore !== undefined, "应有 tensionScore");
assert(report.suggestedMoves.length > 0, "应有建议走法");
assert(report.suggestedMoves.length <= 5, "建议走法不超过5个");

// --- Test 2: 建议走法结构 ---
const firstMove = report.suggestedMoves[0];
assert(firstMove.move !== undefined, "建议走法应包含 move");
assert(typeof firstMove.score === 'number', "score 应为数字");
assert(Array.isArray(firstMove.tags), "tags 应为数组");
assert(typeof firstMove.risk === 'string', "risk 应为字符串");
assert(typeof firstMove.description === 'string', "description 应为字符串");

// --- Test 3: 走法评分应降序 ---
let sorted = true;
for (let i = 1; i < report.suggestedMoves.length; i++) {
    if (report.suggestedMoves[i].score > report.suggestedMoves[i - 1].score) {
        sorted = false;
        break;
    }
}
assert(sorted, "建议走法应按评分降序排列");

// --- Test 4: 机动性分析 ---
const mobility = Strategy.calculateEffectiveMobility(Engine.TYPE_HUMAN);
assert(mobility.total > 0, "初始应有合法走法");
assert(mobility.safe > 0, "初始应有安全走法");
assert(mobility.safe <= mobility.total, "安全走法不应超过总走法");

// --- Test 5: 阵型张力 ---
const tension = Strategy.analyzeFormationTension(Engine.TYPE_HUMAN);
assert(typeof tension.playerThreats === 'number', "playerThreats 应为数字");
assert(typeof tension.oppThreats === 'number', "oppThreats 应为数字");
assert(typeof tension.tensionScore === 'number', "tensionScore 应为数字");

// --- Test 6: 走一步后再分析 ---
Engine.init();
// 放一个棋子到位置 4（中心枢纽）
Engine.makeMove({ player: Engine.TYPE_HUMAN, type: 'place', from: -1, to: 4, remove: null });
const report2 = Strategy.generateReport();
assert(report2.context.phase === 'PLACEMENT', "走一步后仍为 PLACEMENT");
assert(report2.suggestedMoves.length > 0, "走一步后应有建议走法");

// --- Test 7: 形成磨坊的走法应有 MILL 标签 ---
Engine.init();
// 手动构造一个即将成行的局面
// HUMAN: 位置 0, 1 → 放到 2 可成行
Engine.makeMove({ player: Engine.TYPE_HUMAN, type: 'place', from: -1, to: 0, remove: null });
Engine.makeMove({ player: Engine.TYPE_AI, type: 'place', from: -1, to: 5, remove: null });
Engine.makeMove({ player: Engine.TYPE_HUMAN, type: 'place', from: -1, to: 1, remove: null });
Engine.makeMove({ player: Engine.TYPE_AI, type: 'place', from: -1, to: 6, remove: null });

const report3 = Strategy.generateReport();
const millMove = report3.suggestedMoves.find(m => m.move.to === 2 && m.tags.includes('MILL'));
assert(millMove !== undefined, "放到位置2应形成磨坊并有 MILL 标签");

// --- 结果 ---
console.log(`\n=== Strategy.js Tests ===`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
if (failed === 0) console.log("All tests passed!");
