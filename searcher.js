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
    function search(player, maxDepth, timeLimitMs) {
        timeLimit = timeLimitMs || DEFAULT_TIME_LIMIT;
        nodeCount = 0;
        timedOut = false;
        startTime = Date.now();

        const isAI = (player === E.TYPE_AI);
        const moves = E.generateLegalMoves(player);

        if (moves.length === 0) return null;

        let completedDepth = 0;
        let bestScores = []; // 每层迭代的结果，排序后复用于下一层走法顺序

        for (let d = 1; d <= maxDepth; d++) {
            if (Date.now() - startTime > timeLimit) break;
            timedOut = false;

            const results = [];
            for (let i = 0; i < moves.length; i++) {
                if (timedOut) break;

                const move = bestScores.length > 0 ? bestScores[i].move : moves[i];
                const ownBefore = E.getOwn(), oppBefore = E.getOpp();
                const formedMill = E.makeMove(move);
                const ownAfter = E.getOwn(), oppAfter = E.getOpp();
                const ctx = { player, move, formedMill };
                const nextIsMax = formedMill ? isAI : !isAI;
                const nextDepth = formedMill ? d : d - 1;
                let score = minimax(nextDepth, -Infinity, Infinity, nextIsMax, ctx);
                if (!isAI) score = -score;
                E.undoMove();
                const ownUndo = E.getOwn(), oppUndo = E.getOpp();

                // 验证 undo 完整性
                if (ownBefore !== ownUndo || oppBefore !== oppUndo) {
                    console.error('[SEARCH BUG] undo mismatch! move=' + move +
                        ' own:' + ownBefore + '→' + ownAfter + '→' + ownUndo +
                        ' opp:' + oppBefore + '→' + oppAfter + '→' + oppUndo);
                }

                // 验证 move 编码与实际效果一致
                const decFrom = move & 0x1F;
                const decTo = (move >> 5) & 0x1F;
                const decRemove = (move >> 10) & 0x1F;
                const decType = (move >> 15) & 3;
                if (decType === 1) { // move type
                    const expectedOwn = ((ownBefore ^ ((1 << decFrom) | (1 << decTo))) >>> 0);
                    const expectedOpp = decRemove !== 31 ? ((oppBefore & ~(1 << decRemove)) >>> 0) : oppBefore;
                    if (ownAfter !== expectedOwn || oppAfter !== expectedOpp) {
                        console.error('[SEARCH BUG] move effect mismatch! move=' + move +
                            ' decoded: ' + decFrom + '→' + decTo + ' x' + decRemove +
                            ' own:' + ownBefore + '→' + ownAfter + '(exp:' + expectedOwn + ')' +
                            ' opp:' + oppBefore + '→' + oppAfter + '(exp:' + expectedOpp + ')');
                    }
                }

                if (timedOut) break;
                results.push({ move, score });
            }

            // 本层完整完成 → 排序（同分打乱），供下一层用
            if (!timedOut && results.length === moves.length) {
                completedDepth = d;
                results.sort((a, b) => b.score - a.score);
                // 同分段内 Fisher-Yates 打乱
                for (let j = 0; j < results.length; ) {
                    let k = j + 1;
                    while (k < results.length && results[k].score === results[j].score) k++;
                    for (let m = k - 1; m > j; m--) {
                        const n = j + Math.floor(Math.random() * (m - j + 1));
                        const tmp = results[m]; results[m] = results[n]; results[n] = tmp;
                    }
                    j = k;
                }
                bestScores = results;
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
