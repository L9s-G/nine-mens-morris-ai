// ========================================================
// Nine Men's Morris AI 控制器 (AI Controller)
// 职责：难度配置 + 走法选择（基于 Searcher 排序 + 温度随机）
//   - 依赖：Engine, Evaluator, Searcher (via Web Worker)
//   - 不含搜索逻辑（委托给 Worker 中的 Searcher）
// ========================================================

const AI = (() => {
    const E = Engine;

    // ==================== Web Worker 管理 ====================

    let worker = null;
    let workerReady = false;

    /** 初始化 Web Worker，设置消息/错误回调，管理 pending Promise 模式。 */
    function initWorker() {
        if (worker) return;

        worker = new Worker('searcher.worker.js');

        worker.onmessage = function (e) {
            const { success, result, error } = e.data;
            if (success) {
                workerReady = true;
                // 如果有 pending 的请求，处理它
                if (pendingResolve) {
                    const resolve = pendingResolve;
                    pendingResolve = null;
                    resolve(result);
                }
            } else {
                console.error('Worker error:', error);
                if (pendingReject) {
                    const reject = pendingReject;
                    pendingReject = null;
                    reject(new Error(error));
                }
            }
        };

        worker.onerror = function (e) {
            console.error('Worker onerror:', e);
            if (pendingReject) {
                const reject = pendingReject;
                pendingReject = null;
                reject(e.error || new Error('Worker error'));
            }
        };
    }

    let pendingResolve = null;
    let pendingReject = null;

    /**
     * 通过 Web Worker 执行搜索（异步）。
     * Worker 中运行 engine.js + evaluator.js + searcher.js，共享单一源码。
     * @param {number} player - 搜索方（TYPE_OPPONENT 或 TYPE_AI）
     * @param {number} depth - 搜索深度
     * @param {number} [timeLimit] - 时间墙（毫秒）
     * @returns {Promise<{ ranked: Array, stats: object }>}
     */
    function searchWithWorker(player, depth, timeLimit) {
        return new Promise((resolve, reject) => {
            if (!worker) {
                initWorker();
            }

            pendingResolve = resolve;
            pendingReject = reject;

            const fen = E.toFen();
            worker.postMessage({ fen, player, depth, timeLimit, debug: debugMode });
        });
    }

    // ==================== 难度配置 ====================

    /**
     * 每级难度的搜索参数。
     * depth: 可为数字（全阶段统一）或按阶段分别设置 { PLACEMENT, MOVING, FLYING }
     * temperature: 可为数字或按阶段分别设置；0=确定性（Demon），1=高随机（Eco）
     * topK: 加权随机选择的候选数截断
     */
    const PerformanceConfig = {
        Eco:    { depth: { PLACEMENT: 1, MOVING: 2, FLYING: 2 }, temperature: 1,   topK: 5, label: '菜鸟' },
        Normal: { depth: { PLACEMENT: 2, MOVING: 3, FLYING: 3 }, temperature: 0.8, topK: 4, label: '老手' },
        Master: { depth: { PLACEMENT: 3, MOVING: 4, FLYING: 5 }, temperature: { PLACEMENT: 0.25, MOVING: 0.02, FLYING: 0.00 }, topK: 2, label: '大师' },
        Demon:  { depth: { PLACEMENT: 5, MOVING: 8, FLYING: 8 }, temperature: 0, topK: 1, label: '恶魔' },
    };

    /**
     * 解析多态温度配置（数字或按阶段对象）。
     * @param {number|object} tempConfig - 温度值或 { PLACEMENT, MOVING, FLYING }
     * @param {string} phase - 当前阶段
     * @returns {number}
     */
    function resolveTemperature(tempConfig, phase) {
        if (typeof tempConfig === 'number') return tempConfig;
        return tempConfig[phase] ?? PerformanceConfig.Normal.temperature;
    }

    /**
     * 解析多态深度配置（数字或按阶段对象）。
     * @param {number|object} depthConfig - 深度值或 { PLACEMENT, MOVING, FLYING }
     * @param {string} phase - 当前阶段
     * @returns {number}
     */
    function resolveDepth(depthConfig, phase) {
        if (typeof depthConfig === 'number') return depthConfig;
        return depthConfig[phase] ?? PerformanceConfig.Normal.depth.MOVING;
    }

    let currentConfig = PerformanceConfig.Normal;

    /**
     * 设置 AI 难度模式。
     * @param {string} mode - 'Eco' | 'Normal' | 'Master' | 'Demon'
     */
    function setPerformanceMode(mode) {
        if (PerformanceConfig[mode]) currentConfig = PerformanceConfig[mode];
    }

    // ==================== Debug 模式 ====================

    const DEBUG_TIME_LIMIT = 20000; // Debug 模式 20 秒时间墙
    let debugMode = false;

    /** 开启/关闭 Debug 模式（更长时间墙 + 性能指标弹幕）。 */
    function setDebugMode(on) { debugMode = on; }

    // ==================== 温度随机选择 ====================

    /**
     * Top-k 截断 + 指数分布随机选择。
     * 分差大时高分几乎确定（temperature→0），分差接近时保留随机性。
     * @param {Array<{move: number, score: number}>} sorted - 按分数降序的走法列表
     * @param {number} temperature - 温度（0=确定性选 top-1，越大越随机）
     * @param {number} topK - 候选截断数
     * @returns {{ move: number, score: number }|null}
     */
    function pickWithWeightedRandom(sorted, temperature, topK) {
        if (sorted.length === 0) return null;
        if (sorted.length === 1 || temperature === 0) return sorted[0];

        const candidates = sorted.slice(0, Math.min(topK, sorted.length));

        // 将分数平移为正数，然后乘以指数衰减
        const minScore = Math.min(...candidates.map(c => c.score));
        const weights = candidates.map((c, i) =>
            (c.score - minScore + 1) * Math.exp(-i / temperature)
        );
        const sum = weights.reduce((a, b) => a + b, 0);

        let r = Math.random() * sum;
        for (let i = 0; i < candidates.length; i++) {
            r -= weights[i];
            if (r <= 0) return candidates[i];
        }
        return candidates[0];
    }

    // ==================== 主决策函数 ====================

    /**
     * 为指定玩家选择最佳走法（支持双人对战）
     * @param {number} player - TYPE_OPPONENT 或 TYPE_AI
     * @returns {Promise<{ move, score, allScores: Array, stats: object }>}
     */
    async function selectBestMoveForPlayer(player) {
        const phase = E.getPhase(player);
        const depth = resolveDepth(currentConfig.depth, phase);

        // 使用 Worker 执行搜索（debug 模式用更长的时间墙）
        const timeLimit = debugMode ? DEBUG_TIME_LIMIT : undefined;
        const result = await searchWithWorker(player, depth, timeLimit);

        if (!result) return null;

        let temp = resolveTemperature(currentConfig.temperature, phase);

        // PLACEMENT 前期提高随机性：手持棋子越多，温度越高
        // index = piecesOnHand: [0-3]=1x, 4=1.2x, 5=1.5x, 6=2x, 7-9=3x
        // 开局前几子位置对称性高，提高随机性增加对局多样性
        if (phase === E.PHASE_PLACEMENT) {
            const p = player === E.TYPE_OPPONENT
                ? E.getStateView().playerOpponent
                : E.getStateView().playerAI;
            const MULTIPLIERS = [1, 1, 1, 1, 1.2, 1.5, 2, 3, 3, 3];
            temp *= MULTIPLIERS[p.piecesOnHand] || 1;
        }

        const chosen = pickWithWeightedRandom(result.ranked, temp, currentConfig.topK);

        if (!chosen) {
            const moves = E.generateLegalMoves(player);
            return { move: moves[0], score: 0, allScores: [], stats: { ...result.stats, topK: currentConfig.topK, temperature: 0 } };
        }

        return {
            move: chosen.move,
            score: chosen.score,
            allScores: result.ranked,
            stats: { ...result.stats, config: currentConfig.label, topK: currentConfig.topK, temperature: temp },
        };
    }

    /**
     * AI 选择最佳走法（兼容旧接口）
     * @returns {Promise}
     */
    async function selectBestMove() {
        return selectBestMoveForPlayer(E.TYPE_AI);
    }

    /**
     * 静态评估当前局面（AI 视角）
     * 用于 AI 吃子选择等不需要搜索的场景
     *
     * @param {object|null} move - 刚执行的走法（用于吃子价值评估）
     */
    function evaluatePosition(move) {
        if (!move && move !== 0) return Evaluator.evaluate(0, null);
        // 从编码整数提取 player：bit 17
        const player = (move >> 17) & 1 ? Engine.TYPE_AI : Engine.TYPE_OPPONENT;
        return Evaluator.evaluate(0, { player, move });
    }

    // ==================== 初始化 ====================

    // 预加载 Worker
    initWorker();

    // ==================== 公开接口 ====================

    return {
        setPerformanceMode,
        setDebugMode,
        selectBestMove,
        selectBestMoveForPlayer,
        evaluatePosition,
    };
})();
