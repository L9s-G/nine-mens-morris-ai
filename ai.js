// ========================================================
// Nine Men's Morris AI 控制器 (AI Controller)
// 职责：难度配置 + 走法选择（基于 Searcher 排序 + 温度随机）
//   - 依赖：Engine, Evaluator, Searcher
//   - 不含搜索逻辑（委托给 Searcher）
// ========================================================

const AI = (() => {
    const E = Engine;

    // ==================== 难度配置 ====================

    const PerformanceConfig = {
        Eco:    { depth: { PLACEMENT: 1, MOVING: 2, FLYING: 2 }, temperature: 1,   topK: 5, label: '菜鸟' },
        Normal: { depth: { PLACEMENT: 2, MOVING: 3, FLYING: 3 }, temperature: 0.8, topK: 4, label: '老手' },
        Master: { depth: { PLACEMENT: 3, MOVING: 4, FLYING: 4 }, temperature: { PLACEMENT: 0.25, MOVING: 0.02, FLYING: 0.00 }, topK: 2, label: '大师' },
    };

    function resolveTemperature(tempConfig, phase) {
        if (typeof tempConfig === 'number') return tempConfig;
        return tempConfig[phase] ?? PerformanceConfig.Normal.temperature;
    }

    function resolveDepth(depthConfig, phase) {
        if (typeof depthConfig === 'number') return depthConfig;
        return depthConfig[phase] ?? PerformanceConfig.Normal.depth.MOVING;
    }

    let currentConfig = PerformanceConfig.Normal;

    function setPerformanceMode(mode) {
        if (PerformanceConfig[mode]) currentConfig = PerformanceConfig[mode];
    }

    // ==================== 温度随机选择 ====================

    /**
     * Top-k 截断 + 指数分布随机选择
     */
    function pickWithWeightedRandom(sorted, temperature, topK) {
        if (sorted.length === 0) return null;
        if (sorted.length === 1 || temperature === 0) return sorted[0];

        const candidates = sorted.slice(0, Math.min(topK, sorted.length));
        const weights = candidates.map((_, i) => Math.exp(-i / temperature));
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
     * @returns {{ move, score, allScores: Array, stats: object }}
     */
    function selectBestMoveForPlayer(player) {
        const phase = E.getPhase(player);
        const depth = resolveDepth(currentConfig.depth, phase);
        const result = Searcher.search(player, depth);
        if (!result) return null;

        let temp = resolveTemperature(currentConfig.temperature, phase);

        // PLACEMENT 前期提高随机性：前 2 子 3x，3-6 子渐降，7-9 子原值
        if (phase === E.PHASE_PLACEMENT) {
            const p = player === E.TYPE_OPPONENT
                ? E.getStateView().playerOpponent
                : E.getStateView().playerAI;
            const MULTIPLIERS = [1, 1, 1, 1, 1.2, 1.5, 2, 3, 3, 3]; // index = piecesOnHand
            temp *= MULTIPLIERS[p.piecesOnHand] || 1;
        }

        const chosen = pickWithWeightedRandom(result.ranked, temp, currentConfig.topK);

        if (!chosen) {
            const moves = E.generateLegalMoves(player);
            return { move: moves[0], score: 0, allScores: [], stats: result.stats };
        }

        return {
            move: chosen.move,
            score: chosen.score,
            allScores: result.ranked,
            stats: { ...result.stats, config: currentConfig.label, topK: currentConfig.topK },
        };
    }

    /**
     * AI 选择最佳走法（兼容旧接口）
     */
    function selectBestMove() {
        return selectBestMoveForPlayer(E.TYPE_AI);
    }

    /**
     * 静态评估当前局面（AI 视角）
     * 用于 AI 吃子选择等不需要搜索的场景
     *
     * @param {object|null} move - 刚执行的走法（用于吃子价值评估）
     */
    function evaluatePosition(move) {
        const ctx = move ? { player: move.player, move } : null;
        return Evaluator.evaluate(0, ctx);
    }

    // ==================== 公开接口 ====================

    return {
        setPerformanceMode,
        selectBestMove,
        selectBestMoveForPlayer,
        evaluatePosition,
    };
})();
