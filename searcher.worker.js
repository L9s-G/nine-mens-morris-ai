// ========================================================
// Nine Men's Morris 搜索引擎 Web Worker
// 职责：在独立线程中执行 AI 搜索，避免阻塞主线程
// 通过 importScripts 复用 engine.js / evaluator.js / searcher.js，保持单一源
// ========================================================

importScripts('engine.js', 'evaluator.js', 'searcher.js');

self.onmessage = function (e) {
    const { fen, player, depth, timeLimit, debug } = e.data;

    try {
        Engine.fromFen(fen);
        const result = Searcher.search(player, depth, timeLimit, debug);
        self.postMessage({ success: true, result });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
