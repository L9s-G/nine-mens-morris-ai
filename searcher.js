// ========================================================
// Nine Men's Morris 搜索引擎 (Searcher)
// 职责：Minimax + Alpha-Beta 剪枝 + 迭代加深 + 时间墙
//   - 标准 minimax 实现，评估委托给 Evaluator
//   - 走法排序来自上一层评估分数（无内联 heuristic）
// ========================================================

const Searcher = (() => {
    const E = Engine;
    const EV = Evaluator;

    const DEFAULT_TIME_LIMIT = 5000;

    let nodeCount = 0;
    let startTime = 0;
    let timeLimit = DEFAULT_TIME_LIMIT;
    let timedOut = false;

    // ==================== Debug 工具 ====================

    function debugPrintDepth(depth, maxDepth, results) {
        console.log(`\n[Depth ${depth}/${maxDepth}]`);
        const lines = [];
        for (let r = 0; r < results.length; r++) {
            const dec = E.decodeMove(results[r].move);
            const fromStr = dec.from === 31 ? `→${dec.to}` : `${dec.from}→${dec.to}`;
            const removeStr = dec.remove !== null ? `x${dec.remove}` : '';
            lines.push(`[${fromStr}${removeStr}:${results[r].score}]`);
        }
        console.log(lines.join(' | '));
    }

    // ==================== Minimax + Alpha-Beta ====================

    /**
     * 标准 Minimax + Alpha-Beta 剪枝
     *
     * @param {number} depth - 剩余深度
     * @param {number} alpha
     * @param {number} beta
     * @param {boolean} isMax - 是否为最大化层（AI 回合）
     * @param {object|null} ctx - 上一层走法上下文 { player, move, formedMill }
     *   formedMill=true 时同一玩家继续（吃子阶段），不消耗深度
     * @returns {number} 评估分数（AI 视角）
     */
    function minimax(depth, alpha, beta, isMax, ctx) {
        nodeCount++;

        // 时间墙：每 1024 节点检查一次
        if ((nodeCount & 1023) === 0 && Date.now() - startTime > timeLimit) {
            timedOut = true;
        }

        // 终止：超时 / 游戏结束 / 深度耗尽
        if (timedOut || E.isGameOver() || depth <= 0) {
            return EV.evaluate(depth, ctx);
        }

        const player = isMax ? E.TYPE_AI : E.TYPE_OPPONENT;
        const moves = E.generateLegalMoves(player);

        if (moves.length === 0) {
            return isMax ? EV.SCORE_LOSE : EV.SCORE_WIN;
        }

        if (isMax) {
            let best = -Infinity;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                const formedMill = E.makeMove(move);
                const nextCtx = { player, move, formedMill };
                // 成磨：同一玩家继续，深度不变；否则切换玩家，深度 -1
                const val = formedMill
                    ? minimax(depth, alpha, beta, true, nextCtx)
                    : minimax(depth - 1, alpha, beta, false, nextCtx);
                E.undoMove();
                if (val > best) best = val;
                if (val > alpha) alpha = val;
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                const formedMill = E.makeMove(move);
                const nextCtx = { player, move, formedMill };
                const val = formedMill
                    ? minimax(depth, alpha, beta, false, nextCtx)
                    : minimax(depth - 1, alpha, beta, true, nextCtx);
                E.undoMove();
                if (val < best) best = val;
                if (val < beta) beta = val;
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    // ==================== 主搜索：迭代加深 + 时间墙 ====================

    /**
     * 为指定玩家搜索最佳走法
     *
     * @param {number} player - TYPE_OPPONENT 或 TYPE_AI
     * @param {number} maxDepth - 最大搜索深度
     * @param {number} [timeLimitMs] - 时间墙（默认 5000ms）
     * @returns {{ ranked: Array<{move, score}>, stats: object }}
     */
    function search(player, maxDepth, timeLimitMs, debug) {
        timeLimit = timeLimitMs || DEFAULT_TIME_LIMIT;
        nodeCount = 0;
        timedOut = false;
        startTime = Date.now();

        const isAI = (player === E.TYPE_AI);
        const moves = E.generateLegalMoves(player);

        if (moves.length === 0) return null;

        let completedDepth = 0;
        // bestScores: 上一层迭代的走法-分数对，按分数降序排列。
        // 下一层复用此顺序作为走法排列，实现迭代加深的走法排序优化。
        let bestScores = [];

        for (let d = 1; d <= maxDepth; d++) {
            if (Date.now() - startTime > timeLimit) break;
            timedOut = false;

            const results = [];
            for (let i = 0; i < moves.length; i++) {
                if (timedOut) break;

                // 走法排序：首轮用 generateLegalMoves 原序，后续用上一轮的分数排序
                const move = bestScores.length > 0 ? bestScores[i].move : moves[i];
                const formedMill = E.makeMove(move);
                const ctx = { player, move, formedMill };
                const nextIsMax = formedMill ? isAI : !isAI;
                const nextDepth = formedMill ? d : d - 1;
                let score = minimax(nextDepth, -Infinity, Infinity, nextIsMax, ctx);
                if (!isAI) score = -score;
                E.undoMove();

                if (timedOut) break;
                results.push({ move, score });
            }

            // 本层完整完成 → 排序，供下一层走法排序用
            if (!timedOut && results.length === moves.length) {
                completedDepth = d;
                results.sort((a, b) => b.score - a.score);
                // 同分段内 Fisher-Yates 打乱：对称局面中多个走法分数相同，
                // 打乱避免 AI 每次走同一个位置，增加对局多样性
                for (let j = 0; j < results.length;) {
                    let k = j + 1;
                    while (k < results.length && results[k].score === results[j].score) k++;
                    for (let m = k - 1; m > j; m--) {
                        const n = j + Math.floor(Math.random() * (m - j + 1));
                        const tmp = results[m]; results[m] = results[n]; results[n] = tmp;
                    }
                    j = k;
                }
                if (debug) debugPrintDepth(d, maxDepth, results);

                bestScores = results;

                // 已找到必胜走法，无需继续加深
                if (bestScores.length > 0 && bestScores[0].score >= EV.SCORE_WIN) break;
            } else {
                break;
            }
        }

        const elapsed = Date.now() - startTime;

        return {
            ranked: bestScores,  // [{ move, score }] 按分数降序
            stats: {
                depth: completedDepth,
                targetDepth: maxDepth,
                nodeCount,
                elapsed,
                nodesPerMs: elapsed > 0 ? Math.round(nodeCount / elapsed) : 0,
                timedOut
            }
        };
    }

    // ==================== 公开接口 ====================

    return {
        search,
    };
})();
