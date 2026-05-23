// Narrator.js + 集成测试
const fs = require('fs');
const vm = require('vm');

// 加载所有模块
const engineCode = fs.readFileSync('./engine.js', 'utf-8').replace('const Engine = (() => {', 'Engine = (() => {');
const strategyCode = fs.readFileSync('./strategy.js', 'utf-8').replace('const Strategy = (() => {', 'Strategy = (() => {');
const aiCode = fs.readFileSync('./ai.js', 'utf-8').replace('const AI = (() => {', 'AI = (() => {');
const narratorCode = fs.readFileSync('./narrator.js', 'utf-8').replace('const Narrator = (() => {', 'Narrator = (() => {');

const sandbox = { console, Engine: null, Strategy: null, AI: null, Narrator: null };
vm.createContext(sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(strategyCode, sandbox);
vm.runInContext(aiCode, sandbox);
vm.runInContext(narratorCode, sandbox);

const Engine = sandbox.Engine;
const Strategy = sandbox.Strategy;
const AI = sandbox.AI;
const Narrator = sandbox.Narrator;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) { passed++; }
    else { failed++; console.log(`[FAIL] ${msg}`); }
}

// --- Test 1: 情绪判断 ---
assert(Narrator.getEmotion(3) === 'arrogant', 'forceDiff >= 3 应为 arrogant');
assert(Narrator.getEmotion(1) === 'confident', 'forceDiff = 1 应为 confident');
assert(Narrator.getEmotion(0) === 'neutral', 'forceDiff = 0 应为 neutral');
assert(Narrator.getEmotion(-1) === 'cautious', 'forceDiff = -1 应为 cautious');
assert(Narrator.getEmotion(-3) === 'desperate', 'forceDiff <= -2 应为 desperate');

// --- Test 2: 离线台词生成 ---
const mockMove = { score: 50, tags: ['MILL'], risk: 'low', description: '形成磨坊' };
const line = Narrator.getOfflineLine(mockMove, 'EXPANSION', 0);
assert(typeof line === 'string', '离线台词应为字符串');
assert(line.length > 0, '离线台词不应为空');

// --- Test 3: HIDDEN_TRAP 话术 ---
const trapMove = { score: 80, tags: ['HIDDEN_TRAP'], risk: 'high', description: '陷阱走法' };
const trapLine = Narrator.getOfflineLine(trapMove, 'DECISIVE', 0);
const trapKeywords = ['敢', '失误', '破绽', '送', '走错', '大意', '坟墓'];
const hasTrapKeyword = trapKeywords.some(kw => trapLine.includes(kw));
assert(hasTrapKeyword, `HIDDEN_TRAP 话术应包含诱导性词汇，实际: "${trapLine}"`);

// --- Test 4: 情绪修饰 ---
const arrogantLine = Narrator.getOfflineLine(mockMove, 'EXPANSION', 3);
const desperateLine = Narrator.getOfflineLine(mockMove, 'EXPANSION', -3);
assert(typeof arrogantLine === 'string', '优势情绪台词应为字符串');
assert(typeof desperateLine === 'string', '劣势情绪台词应为字符串');

// --- Test 5: 在线 Prompt 生成 ---
Engine.init();
const report = Strategy.generateReport();
const prompt = Narrator.createPrompt(report, mockMove, AI.MODE_EXPANSION);
assert(prompt.role === 'system', 'Prompt 应有 system role');
assert(prompt.content.includes('宗师'), 'Prompt 应包含角色描述');
assert(prompt.content.includes('EXPANSION'), 'Prompt 应包含策略模式');

// --- Test 6: 统一接口 ---
const offlineResult = Narrator.getLine(report, mockMove, 'EXPANSION', false);
assert(typeof offlineResult === 'string', '离线模式应返回字符串');

const onlineResult = Narrator.getLine(report, mockMove, 'EXPANSION', true);
assert(typeof onlineResult === 'object', '在线模式应返回对象');
assert(onlineResult.role === 'system', '在线模式应返回 Prompt 对象');

// --- Test 7: 完整集成流程（模拟 AI 回合）---
Engine.init({ firstPlayer: Engine.TYPE_AI });

// 1. AI 选择最佳走法
const aiResult = AI.selectBestMove(2);
assert(aiResult !== null, 'AI 应返回结果');

// 2. 获取台词（离线）
const aiLine = Narrator.getLine(aiResult.report, aiResult.allScores[0], aiResult.mode, false);
assert(typeof aiLine === 'string' && aiLine.length > 0, 'AI 台词应为非空字符串');
console.log(`  AI 台词: "${aiLine}"`);

// 3. 执行走法
Engine.makeMove(aiResult.move);
const state = Engine.getState();
assert(state.playerAI.piecesOnBoard === 1 || state.playerAI.piecesOnHand === 8,
    'AI 应已放置一个棋子');

// --- Test 8: detectTraps 接口 ---
assert(typeof AI.detectTraps === 'function', 'detectTraps 应为函数');

// --- 结果 ---
console.log(`\n=== Narrator.js + Integration Tests ===`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
if (failed === 0) console.log("All tests passed!");
