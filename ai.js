// ========================================================
// Nine Men's Morris AI 控制器 (AI Controller)
// 版本：v2.0 - 性能模式版
// 特性：
//   - Minimax + Alpha-Beta 搜索
//   - 动态策略状态机（扩张/压制/决战）
//   - 隐藏陷阱检测（深度差评估）
//   - 可调搜索深度 + 性能模式配置
//   - 搜索节点计数器
// ========================================================

const AI = (() => {
    const E = Engine;
    const S = Strategy;

    // ==================== 常量 ====================

    // 策略模式
    const MODE_EXPANSION  = 'EXPANSION';
    const MODE_SUPPRESSION = 'SUPPRESSION';
    const MODE_DECISIVE   = 'DECISIVE';

    // 评估权重
    const WEIGHTS = {
        force:     150,  // 每多一子的分值
        mobility:   2,   // 每个安全移动的分值
        threat:    15,   // 每个潜在磨坊的分值
        fork:      30,   // 每个叉子的分值
        mill:      40,   // 形成磨坊的分值
        nearMill:  20,   // 差一步成行的额外奖励
        opponentNearMill: -30 // 对手差一步成行的惩罚
    };

    // ==================== 性能模式配置 ====================

    const MAX_THINK_TIME = 5000; // 最大思考时间 5 秒

    const PerformanceConfig = {
        Eco:    { depth: 1, trapCheck: false, temperature: 0.8, topK: 2, label: '菜鸟' },
        Normal: { depth: 3, trapCheck: true,  temperature: 0.3, topK: 3, label: '老手' },
        Master: { depth: 4, trapCheck: true,  temperature: { PLACEMENT: 0.25, MOVING: 0.02, FLYING: 0.00 }, topK: 2, label: '大师' }
    };

    /**
     * 根据阶段解析温度值（支持标量或阶段映射对象）
     */
    function resolveTemperature(tempConfig, phase) {
        if (typeof tempConfig === 'number') return tempConfig;
        return tempConfig[phase] ?? PerformanceConfig.Normal.temperature;
    }

    // 当前配置（默认平衡模式）
    let currentConfig = PerformanceConfig.Normal;

    // 搜索计数器
    let nodeCount = 0;
    let searchStartTime = 0;
    let timeLimitReached = false;

    /**
     * 设置性能模式
     * @param {'Eco'|'Normal'|'Master'} mode
     */
    function setPerformanceMode(mode) {
        if (PerformanceConfig[mode]) {
            currentConfig = PerformanceConfig[mode];
        }
    }

    /**
     * 获取当前性能配置
     */
    function getPerformanceConfig() {
        return { ...currentConfig };
    }

    // ==================== 静态评估 ====================

    /**
     * 对当前局面进行静态评估
     * 正值表示 AI 优势，负值表示对手优势
     */
    function evaluatePosition() {
        const state = E.getRawState();
        const ai = state.playerAI;
        const opponent = state.playerOpponent;

        // 终局判断
        if (state.gameOver) {
            if (state.winner === E.TYPE_AI) return 10000;
            if (state.winner === E.TYPE_OPPONENT) return -10000;
        }

        // 平滑权重过渡：放置末期逐渐增加机动性权重
        const phaseFactor = 1 - (Math.max(ai.piecesOnHand, opponent.piecesOnHand) / 9);
        const forceW = WEIGHTS.force * (1 - phaseFactor * 0.3);  // 放置末期兵力权重降低 30%
        const mobilityW = WEIGHTS.mobility * (1 + phaseFactor * 2);     // 放置末期机动性权重提升 3 倍

        // 兵力差
        const forceDiff = (ai.piecesOnBoard + ai.piecesOnHand) - (opponent.piecesOnBoard + opponent.piecesOnHand);

        // 机动性差（仅计算可移动到的空位数，不吃子展开）
        const mobilityDiff = E.countMobility(E.TYPE_AI) - E.countMobility(E.TYPE_OPPONENT);

        // 阵型张力
        const aiTension = S.analyzeFormationTension(E.TYPE_AI);
        const opponentTension = S.analyzeFormationTension(E.TYPE_OPPONENT);
        const threatDiff = aiTension.playerThreats - opponentTension.playerThreats;

        // near mill 直接奖惩（与 threatDiff 叠加，强化防守意识）
        const nearMillBonus = WEIGHTS.nearMill * aiTension.playerThreats + WEIGHTS.opponentNearMill * opponentTension.playerThreats;

        // 磨坊数
        const aiMills = E.countMills(E.TYPE_AI);
        const opponentMills = E.countMills(E.TYPE_OPPONENT);
        const millDiff = aiMills - opponentMills;

        // 非对称飞行阶段叉子权重
        const aiFlying = ai.piecesOnBoard <= 3 && ai.piecesOnHand === 0;
        const oppFlying = opponent.piecesOnBoard <= 3 && opponent.piecesOnHand === 0;
        let aiForkW = WEIGHTS.fork;
        let oppForkW = WEIGHTS.fork;
        if (aiFlying && oppFlying) {
            // 双方都在飞：叉子无意义
            aiForkW = 0; oppForkW = 0;
        } else if (oppFlying) {
            // 对手在飞、我方多子：fork 是我方决胜武器
            aiForkW = 60; oppForkW = 0;
        } else if (aiFlying) {
            // 我方在飞、对手多子：fork 是对手决胜武器
            aiForkW = 0; oppForkW = 60;
        }

        // 对手接近飞行模式的惩罚
        let flyThreat = 0;
        if (oppFlying) flyThreat += 50;
        if (aiFlying) flyThreat -= 50;

        // 绝望修正：大幅落后时寻找陷阱机会
        let desperationBonus = 0;
        if (forceDiff <= -3) {
            desperationBonus += 20; // 鼓励冒险
        }

        return (
            forceW * forceDiff +
            mobilityW * mobilityDiff +
            WEIGHTS.threat * threatDiff +
            aiForkW * aiTension.playerForks - oppForkW * opponentTension.playerForks +
            WEIGHTS.mill * millDiff +
            nearMillBonus +
            flyThreat +
            desperationBonus
        );
    }

    // ==================== Minimax + Alpha-Beta ====================

    /**
     * Minimax 搜索（带 Alpha-Beta 剪枝）
     * @param {number} depth - 剩余搜索深度
     * @param {number} alpha - Alpha 值
     * @param {number} beta - Beta 值
     * @param {boolean} isMaximizing - 是否为最大化层（AI 回合）
     * @returns {number} 评估分数
     */
    function minimax(depth, alpha, beta, isMaximizing) {
        nodeCount++; // 计数

        // 时间限制检查
        if (nodeCount % 1000 === 0 && Date.now() - searchStartTime > MAX_THINK_TIME) {
            timeLimitReached = true;
            return evaluatePosition();
        }

        // 终止条件：游戏结束或深度耗尽
        if (E.isGameOver() || depth <= 0 || timeLimitReached) {
            return evaluatePosition();
        }

        const currentPlayer = isMaximizing ? E.TYPE_AI : E.TYPE_OPPONENT;
        const moves = E.generateLegalMoves(currentPlayer);

        // 无合法走法 = 输
        if (moves.length === 0) {
            return isMaximizing ? -10000 : 10000;
        }

        // 走法排序：吃子 > 成行 > 占位，提升 alpha-beta 剪枝效率
        const board = E.getRawState().board;
        const scored = moves.map(m => {
            let quickScore = 0;
            if (m.remove !== null) quickScore += 1000;  // 吃子最高优先
            // 轻量成行检测：模拟落子后检查是否成磨坊
            if (m.to >= 0) {
                const saved = board[m.to];
                const savedFrom = m.from >= 0 ? board[m.from] : null;
                board[m.to] = m.player;
                if (m.from >= 0) board[m.from] = null;
                if (E.isInMill(board, m.to, m.player)) quickScore += 500;
                board[m.to] = saved;
                if (m.from >= 0) board[m.from] = savedFrom;
            }
            if (m.type === 'place') quickScore += 10;
            return { move: m, quickScore };
        });
        scored.sort((a, b) => b.quickScore - a.quickScore);

        if (isMaximizing) {
            let maxEval = -Infinity;
            for (let i = 0; i < scored.length; i++) {
                const result = E.makeMove(scored[i].move);
                const nextIsMax = result.formedMill ? isMaximizing : !isMaximizing;
                // 成行+吃子是同一个逻辑回合，成行时不扣深度
                const nextDepth = result.formedMill ? depth : depth - 1;
                const eval_ = minimax(nextDepth, alpha, beta, nextIsMax);
                E.undoMove();
                maxEval = Math.max(maxEval, eval_);
                alpha = Math.max(alpha, eval_);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (let i = 0; i < scored.length; i++) {
                const result = E.makeMove(scored[i].move);
                const nextIsMax = result.formedMill ? isMaximizing : !isMaximizing;
                // 成行+吃子是同一个逻辑回合，成行时不扣深度
                const nextDepth = result.formedMill ? depth : depth - 1;
                const eval_ = minimax(nextDepth, alpha, beta, nextIsMax);
                E.undoMove();
                minEval = Math.min(minEval, eval_);
                beta = Math.min(beta, eval_);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    // ==================== 策略状态机 ====================

    /**
     * 直接从 Engine 状态计算玩家上下文（替代 generateReport）
     */
    function getPlayerContext(player) {
        const state = E.getRawState();
        const playerData = player === E.TYPE_AI ? state.playerAI : state.playerOpponent;
        const oppData = player === E.TYPE_AI ? state.playerOpponent : state.playerAI;
        const opp = player === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;

        let phase = 'PLACEMENT';
        if (playerData.piecesOnHand === 0) {
            phase = playerData.piecesOnBoard === 3 ? 'FLYING' : 'MOVING';
        }

        const forceDiff = playerData.piecesOnBoard - oppData.piecesOnBoard;
        const isOpponentNearFlying = oppData.piecesOnBoard === 3 && oppData.piecesOnHand === 0;
        const playerMobility = S.calculateEffectiveMobility(player);
        const oppMobility = S.calculateEffectiveMobility(opp);
        const mobilityGap = playerMobility.safe - oppMobility.safe;

        return { phase, forceDiff, isOpponentNearFlying, mobilityGap };
    }

    /**
     * 根据上下文决定策略模式
     */
    function determineMode(context) {
        const { phase, forceDiff, isOpponentNearFlying, mobilityGap } = context;

        if (forceDiff < -1 || isOpponentNearFlying || phase === 'FLYING') {
            return MODE_DECISIVE;
        }
        if (phase === 'MOVING' && mobilityGap > 4) {
            return MODE_SUPPRESSION;
        }
        return MODE_EXPANSION;
    }

    function applyModeBonus(score, tags, mode) {
        let bonus = 0;

        // 通用加成（所有模式下都生效）
        if (tags.includes('NEAR_MILL')) bonus += WEIGHTS.nearMill;  // 差一步成行
        if (tags.includes('MILL')) bonus += 200;       // 形成磨坊（极大鼓励）
        if (tags.includes('CAPTURE')) bonus += 150;    // 吃子（极大鼓励）
        if (tags.includes('BLOCK')) bonus += 100;      // 阻止对方成行（高优先级）

        switch (mode) {
            case MODE_EXPANSION:
                if (tags.includes('HUB_CONTROL')) bonus += 15;
                if (tags.includes('LAYOUT')) bonus += 10;
                break;
            case MODE_SUPPRESSION:
                if (tags.includes('SQUEEZE')) bonus += 20;
                if (tags.includes('ANTI_FLYING')) bonus += 15;
                break;
            case MODE_DECISIVE:
                if (tags.includes('ATTACK')) bonus += 15;
                break;
        }

        return score + bonus;
    }

    // ==================== 陷阱检测 ====================

    /**
     * 评估单步棋在不同深度的分数差（TrapScore）
     * 使用 D=0（静态评估）作为浅层，大幅减少开销
     *
     * @param {object} move - 走法
     * @param {number} player - 执行走法的玩家
     * @param {number} deepDepth - 深层搜索深度（默认使用当前配置）
     * @returns {{ score_shallow: number, score_deep: number, trapScore: number }}
     */
    function evaluateDepthGap(move, player, deepDepth) {
        const isMax = (player === E.TYPE_AI);
        const dDeep = deepDepth || currentConfig.depth;

        // 浅层评估 (D=0 = 静态评估，几乎零开销)
        E.makeMove(move);
        const score_shallow = evaluatePosition();
        E.undoMove();

        // 深层评估
        const r2 = E.makeMove(move);
        const nextIsMax = r2.formedMill ? isMax : !isMax;
        const score_deep = -minimax(dDeep - 1, -Infinity, Infinity, nextIsMax);
        E.undoMove();

        return {
            score_shallow,
            score_deep,
            trapScore: score_deep - score_shallow
        };
    }

    // ==================== 主决策函数 ====================

    /**
     * 基于排名的指数分布随机选择（Top-k 截断）
     * @param {Array} sorted - 已按分数降序排列的走法数组
     * @param {number} temperature - 温度参数，控制指数衰减速度
     * @param {number} topK - 参与随机的最大候选数（默认 3）
     */
    function pickWithWeightedRandom(sorted, temperature = PerformanceConfig.Normal.temperature, topK = PerformanceConfig.Normal.topK) {
        if (sorted.length === 0) return null;
        if (sorted.length === 1 || temperature === 0) return sorted[0];

        // 1. Top-k 截断
        const candidates = sorted.slice(0, Math.min(topK, sorted.length));

        // 2. 基于排名的指数分布权重：rank i 的权重 = exp(-i / temperature)
        const expWeights = candidates.map((_, i) => Math.exp(-i / temperature));
        const sumWeights = expWeights.reduce((a, b) => a + b, 0);

        // 3. 轮盘赌选择
        let r = Math.random();
        for (let i = 0; i < candidates.length; i++) {
            r -= expWeights[i] / sumWeights;
            if (r <= 0) return candidates[i];
        }
        return candidates[0]; // fallback
    }

    /**
     * 为指定玩家选择最佳走法（支持双人对战）
     * @param {number} player - TYPE_OPPONENT 或 TYPE_AI
     * @param {number} [depth] - 搜索深度（默认使用当前配置）
     * @returns {{ move: object, score: number, mode: string, allScores: Array, stats: object }}
     */
    function selectBestMoveForPlayer(player, depth) {
        const config = { ...currentConfig };
        let d = depth || config.depth;
        const isAI = (player === E.TYPE_AI);

        nodeCount = 0;
        timeLimitReached = false;
        const startTime = Date.now();
        searchStartTime = startTime;

        const context = getPlayerContext(player);
        const mode = determineMode(context);

        // 动态深度分配：根据策略模式调整搜索深度
        if (!depth) { // 仅在未指定深度时动态调整
            const rawState = E.getRawState();
            const playerData = isAI ? rawState.playerAI : rawState.playerOpponent;
            const hand = playerData.piecesOnHand;

            // 放置阶段：分支因子高，限制深度，后期平滑过渡到预设值
            if (context.phase === 'PLACEMENT' && d > 2) {
                const d_min = 2;
                if (hand >= 6) {
                    d = d_min;
                } else if (hand >= 2) {
                    d = Math.round(d_min + (d - d_min) * ((6 - hand) / 4));
                }
            }

            if (mode === MODE_SUPPRESSION) {
                d = Math.min(d + 1, 6); // 压制模式：分支因子小，+1 层
            } else if (mode === MODE_DECISIVE && context.phase === 'FLYING') {
                d = Math.max(d - 1, 2); // 飞行模式：分支因子爆炸，-1 层
            }
        }

        const moves = E.generateLegalMoves(player);

        if (moves.length === 0) return null;

        // 迭代加深：从深度 1 搜索到目标深度，超时安全降级到上一层完整结果
        let bestScores = [];
        let completedDepth = 0;

        for (let iterDepth = 1; iterDepth <= d; iterDepth++) {
            // 每层迭代前检查时间
            if (Date.now() - startTime > MAX_THINK_TIME) {
                timeLimitReached = true;
                break;
            }
            timeLimitReached = false;

            // 用上一层的评分排序，让更好的走法先被搜索（提升剪枝率）
            let orderedMoves = moves;
            if (bestScores.length > 0) {
                const scoreMap = new Map();
                for (const entry of bestScores) {
                    const key = `${entry.move.from},${entry.move.to},${entry.move.remove}`;
                    scoreMap.set(key, entry.score);
                }
                orderedMoves = [...moves].sort((a, b) => {
                    const ka = `${a.from},${a.to},${a.remove}`;
                    const kb = `${b.from},${b.to},${b.remove}`;
                    return (scoreMap.get(kb) || -Infinity) - (scoreMap.get(ka) || -Infinity);
                });
            }

            const iterScores = [];
            for (let i = 0; i < orderedMoves.length; i++) {
                if (Date.now() - startTime > MAX_THINK_TIME) {
                    timeLimitReached = true;
                    break;
                }

                const move = orderedMoves[i];
                const result = E.makeMove(move);
                const nextIsMax = result.formedMill ? isAI : !isAI;
                const nextDepth = result.formedMill ? iterDepth : iterDepth - 1;
                const rawScore = isAI ? minimax(nextDepth, -Infinity, Infinity, nextIsMax) : -minimax(nextDepth, -Infinity, Infinity, nextIsMax);
                E.undoMove();

                if (timeLimitReached) break;

                // 用 evaluateMove 为走法生成标签（替代 report.suggestedMoves 查找）
                // TODO: applyModeBonus 与 evaluatePosition 存在重复加分，后续评估是否移除
                const ev = S.evaluateMove(move, player);

                // 根据上下文追加语义标签（原先由 generateReport 添加）
                if (context.phase === 'PLACEMENT' && ev.tags.includes('HUB_CONTROL')) {
                    ev.tags.push('LAYOUT');
                }
                const finalScore = applyModeBonus(rawScore, ev.tags, mode);

                iterScores.push({ move, score: finalScore, rawScore, tags: ev.tags });
            }

            // 本层完整评估了所有走法 → 保存结果，继续下一层
            if (!timeLimitReached && iterScores.length === moves.length) {
                bestScores = iterScores;
                completedDepth = iterDepth;
            } else {
                // 本层超时或不完整 → 丢弃，使用上一层结果
                break;
            }
        }

        const moveScores = bestScores;

        // 如果没有评估任何走法（连深度 1 都没完成），返回第一个合法走法
        if (moveScores.length === 0) {
            return {
                move: moves[0],
                score: 0,
                mode,
                allScores: [],
                stats: {
                    depth: completedDepth,
                    nodeCount,
                    elapsed: Date.now() - startTime,
                    nodesPerMs: 0,
                    config: config.label,
                    timeLimited: true
                }
            };
        }

        // 按分数降序排列（同分随机打散，避免稳定排序导致的排名歧视）
        moveScores.sort((a, b) => {
            if (Math.abs(b.score - a.score) < 0.0001) return Math.random() - 0.5;
            return b.score - a.score;
        });

        // 基于排名的指数分布随机选择
        const effectiveTemp = resolveTemperature(config.temperature, context.phase);
        const chosen = pickWithWeightedRandom(moveScores, effectiveTemp, config.topK);

        // 兜底防线：确保主决策接口不返回 null
        if (!chosen) {
            const elapsed = Date.now() - startTime;
            return {
                move: moves[0] || null,
                score: 0,
                mode,
                allScores: moveScores,
                stats: { depth: completedDepth, nodeCount, elapsed, nodesPerMs: 0, config: config.label, timeLimited: true }
            };
        }

        const elapsed = Date.now() - startTime;

        return {
            move: chosen.move,
            score: chosen.score,
            mode,
            allScores: moveScores,
            stats: {
                depth: completedDepth,
                targetDepth: d,
                nodeCount,
                elapsed,
                nodesPerMs: nodeCount > 0 ? Math.round(nodeCount / elapsed) : 0,
                config: config.label,
                timeLimited: timeLimitReached
            }
        };
    }

    /**
     * AI 选择最佳走法（兼容旧接口）
     * @param {number} [depth] - 搜索深度
     */
    function selectBestMove(depth) {
        return selectBestMoveForPlayer(E.TYPE_AI, depth);
    }

    // ==================== 陷阱检测（独立函数） ====================

    /**
     * 对指定走法列表进行陷阱检测
     * @param {Array} moveScores - selectBestMove 返回的 allScores 数组
     * @param {number} player - 执行走法的玩家
     * @param {number} [threshold=50] - trapScore 阈值
     * @param {number} [deepDepth] - 深层搜索深度（默认使用当前配置）
     * @returns {Array} 带有 HIDDEN_TRAP 标签的 moveScores
     */
    function detectTraps(moveScores, player, threshold = 50, deepDepth) {
        const results = [];

        for (let i = 0; i < moveScores.length; i++) {
            const entry = { ...moveScores[i] };
            const gap = evaluateDepthGap(entry.move, player, deepDepth);

            entry.trapScore = gap.trapScore;
            entry.score_shallow = gap.score_shallow;
            entry.score_deep = gap.score_deep;

            if (gap.trapScore > threshold && gap.score_shallow < 0) {
                if (!entry.tags.includes('HIDDEN_TRAP')) {
                    entry.tags.push('HIDDEN_TRAP');
                }
            }

            results.push(entry);
        }

        return results;
    }

    // ==================== 公开接口 ====================
    return {
        MODE_EXPANSION,
        MODE_SUPPRESSION,
        MODE_DECISIVE,

        // 性能配置
        PerformanceConfig,
        setPerformanceMode,
        getPerformanceConfig,

        // 核心函数
        selectBestMove,
        selectBestMoveForPlayer,
        getPlayerContext,
        determineMode,
        evaluatePosition,
        evaluateDepthGap,
        detectTraps,

        // 计数器
        getNodeCount: () => nodeCount,

        // 测试用
        _minimax: minimax
    };
})();
