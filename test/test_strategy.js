// Strategy.js 功能测试
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const srcDir = path.resolve(__dirname, '..');

// 加载 Engine 和 Strategy
const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const strategyCode = fs.readFileSync(path.join(srcDir, 'strategy.js'), 'utf-8').replace('const Strategy = (() => {', 'Strategy = (() => {');

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

function getBonus(move, player) {
    const opp = player === Engine.TYPE_OPPONENT ? Engine.TYPE_AI : Engine.TYPE_OPPONENT;
    const oppMoves = Engine.generateLegalMoves(opp);
    let oppCapturesBefore = 0;
    for (let i = 0; i < oppMoves.length; i++) {
        if (oppMoves[i].remove !== null) oppCapturesBefore++;
    }
    return Strategy.computeBonus(move, player, oppCapturesBefore);
}

// --- Test 1: evaluateMove 返回结构 ---
Engine.init();
const moves = Engine.generateLegalMoves(Engine.TYPE_OPPONENT);
assert(moves.length > 0, "初始应有合法走法");

const bonus0 = getBonus(moves[0], Engine.TYPE_OPPONENT);
const ev = Strategy.evaluateMove(moves[0], Engine.TYPE_OPPONENT, 'EXPANSION', bonus0);
assert(typeof ev.score === 'number', "evaluateMove 应返回 score");
assert(Array.isArray(ev.tags), "evaluateMove 应返回 tags 数组");

// --- Test 2: evaluateMove 对所有走法评分 ---
const allEvaluated = moves.map(m => {
    const b = getBonus(m, Engine.TYPE_OPPONENT);
    return Strategy.evaluateMove(m, Engine.TYPE_OPPONENT, 'EXPANSION', b);
});
assert(allEvaluated.length === moves.length, "应为每个走法返回评分");
assert(allEvaluated.every(e => typeof e.score === 'number'), "所有评分应为数字");
assert(allEvaluated.every(e => Array.isArray(e.tags)), "所有标签应为数组");

// --- Test 3: 机动性分析 ---
const mobility = Strategy.calculateEffectiveMobility(Engine.TYPE_OPPONENT);
assert(mobility.total > 0, "初始应有合法走法");
assert(mobility.safe > 0, "初始应有安全走法");
assert(mobility.safe <= mobility.total, "安全走法不应超过总走法");

// --- Test 4: 阵型张力 ---
const tension = Strategy.analyzeFormationTension(Engine.TYPE_OPPONENT);
assert(typeof tension.playerThreats === 'number', "playerThreats 应为数字");
assert(typeof tension.oppThreats === 'number', "oppThreats 应为数字");
assert(typeof tension.tensionScore === 'number', "tensionScore 应为数字");

// --- Test 5: 形成磨坊的走法应有 MILL 标签 ---
Engine.init();
// 手动构造一个即将成行的局面
// 对手: 位置 0, 1 → 放到 2 可成行
Engine.makeMove({ player: Engine.TYPE_OPPONENT, type: 'place', from: -1, to: 0, remove: null });
Engine.makeMove({ player: Engine.TYPE_AI, type: 'place', from: -1, to: 5, remove: null });
Engine.makeMove({ player: Engine.TYPE_OPPONENT, type: 'place', from: -1, to: 1, remove: null });
Engine.makeMove({ player: Engine.TYPE_AI, type: 'place', from: -1, to: 6, remove: null });

const millMove = { player: Engine.TYPE_OPPONENT, type: 'place', from: -1, to: 2, remove: null };
const millBonus = getBonus(millMove, Engine.TYPE_OPPONENT);
const millResult = Engine.makeMove(millMove);
Engine.undoMove();
const millEv = Strategy.evaluateMove(millMove, Engine.TYPE_OPPONENT, 'EXPANSION', millBonus, millResult.formedMill);
assert(millEv.tags.includes('MILL'), "放到位置2应形成磨坊并有 MILL 标签");

// --- Test 6: 占据高连通性位置应有 HUB_CONTROL 标签 ---
Engine.init();
const hubMove = { player: Engine.TYPE_OPPONENT, type: 'place', from: -1, to: 4, remove: null }; // 中心位置
const hubBonus = getBonus(hubMove, Engine.TYPE_OPPONENT);
const hubEv = Strategy.evaluateMove(hubMove, Engine.TYPE_OPPONENT, 'EXPANSION', hubBonus);
assert(hubEv.tags.includes('HUB_CONTROL'), "中心位置应有 HUB_CONTROL 标签");

// --- 结果 ---
console.log(`\n=== Strategy.js Tests ===`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
if (failed === 0) console.log("All tests passed!");
