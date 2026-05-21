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
        material:  150,  // 每多一子的分值（大幅提高以激励吃子）
        mobility:   2,   // 每个安全移动的分值
        threat:    10,   // 每个潜在磨坊的分值
        fork:      20,   // 每个叉子的分值
        mill:      40,   // 形成磨坊的分值
        losePiece: -200, // 失去一子的惩罚（大幅提高以激励防守）
        nearMill:  15,   // 差一步成行的额外奖励
        opponentNearMill: -20 // 对手差一步成行的惩罚
    };

    // ==================== 性能模式配置 ====================

    const MAX_THINK_TIME = 5000; // 最大思考时间 5 秒

    const PerformanceConfig = {
        Eco:    { depth: 1, trapCheck: false, temperature: 3.0, label: '节能模式' },
        Normal: { depth: 3, trapCheck: true,  temperature: 0.5, label: '平衡模式' },
        Master: { depth: 4, trapCheck: true,  temperature: 0.1, label: '大师模式' }
    };

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
     * 计算阶段因子（用于平滑权重过渡）
     * 返回 0~1：0 = 放置早期，1 = 放置末期/走子阶段
     */
    function getPhaseFactor() {
        const state = E.getState();
        const maxHand = Math.max(state.playerAI.piecesOnHand, state.playerHuman.piecesOnHand);
        // 手中棋子越少，因子越接近 1
        return 1 - (maxHand / 9);
    }

    /**
     * 对当前局面进行静态评估
     * 正值表示 AI 优势，负值表示 HUMAN 优势
     */
    function evaluatePosition() {
        const state = E.getState();
        const ai = state.playerAI;
        const human = state.playerHuman;

        // 终局判断
        if (state.gameOver) {
            if (state.winner === E.TYPE_AI) return 10000;
            if (state.winner === E.TYPE_HUMAN) return -10000;
        }

        // 平滑权重过渡：放置末期逐渐增加机动性权重
        const phaseFactor = getPhaseFactor();
        const materialW = WEIGHTS.material * (1 - phaseFactor * 0.3);  // 放置末期材料权重降低 30%
        const mobilityW = WEIGHTS.mobility * (1 + phaseFactor * 2);     // 放置末期机动性权重提升 3 倍

        // 材料差
        const materialDiff = (ai.piecesOnBoard + ai.piecesOnHand) - (human.piecesOnBoard + human.piecesOnHand);

        // 机动性差
        const aiMoves = E.generateLegalMoves(E.TYPE_AI).length;
        const humanMoves = E.generateLegalMoves(E.TYPE_HUMAN).length;
        const mobilityDiff = aiMoves - humanMoves;

        // 阵型张力
        const aiTension = S.analyzeFormationTension(E.TYPE_AI);
        const humanTension = S.analyzeFormationTension(E.TYPE_HUMAN);
        const threatDiff = aiTension.playerThreats - humanTension.playerThreats;
        const forkDiff = aiTension.playerForks - humanTension.playerForks;

        // 磨坊数
        const aiMills = E.countMills(E.TYPE_AI);
        const humanMills = E.countMills(E.TYPE_HUMAN);
        const millDiff = aiMills - humanMills;

        // 对手接近飞行模式的惩罚
        let flyThreat = 0;
        if (human.piecesOnBoard === 3 && human.piecesOnHand === 0) flyThreat += 50;
        if (ai.piecesOnBoard === 3 && ai.piecesOnHand === 0) flyThreat -= 50;

        // 绝望修正：大幅落后时寻找陷阱机会
        let desperationBonus = 0;
        if (materialDiff <= -3) {
            desperationBonus += 20; // 鼓励冒险
        }

        return (
            materialW * materialDiff +
            mobilityW * mobilityDiff +
            WEIGHTS.threat * threatDiff +
            WEIGHTS.fork * forkDiff +
            WEIGHTS.mill * millDiff +
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

        const state = E.getState();

        // 终止条件：游戏结束或深度为 0
        if (state.gameOver || depth === 0 || timeLimitReached) {
            return evaluatePosition();
        }

        const currentPlayer = isMaximizing ? E.TYPE_AI : E.TYPE_HUMAN;
        const moves = E.generateLegalMoves(currentPlayer);

        // 无合法走法 = 输
        if (moves.length === 0) {
            return isMaximizing ? -10000 : 10000;
        }

        // 走法排序：优先考虑有标签的走法（提高剪枝效率）
        const scored = moves.map(m => {
            let quickScore = 0;
            if (m.remove !== null) quickScore += 100;
            if (m.type === 'place') quickScore += 10;
            return { move: m, quickScore };
        });
        scored.sort((a, b) => b.quickScore - a.quickScore);

        if (isMaximizing) {
            let maxEval = -Infinity;
            for (let i = 0; i < scored.length; i++) {
                const result = E.makeMove(scored[i].move);
                const nextIsMax = result.formedMill ? isMaximizing : !isMaximizing;
                const eval_ = minimax(depth - 1, alpha, beta, nextIsMax);
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
                const eval_ = minimax(depth - 1, alpha, beta, nextIsMax);
                E.undoMove();
                minEval = Math.min(minEval, eval_);
                beta = Math.min(beta, eval_);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    // ==================== 策略状态机 ====================

    function determineMode(report) {
        const { context, metrics } = report;
        const { phase, materialDiff, isOpponentNearFlying } = context;
        const { mobilityGap } = metrics;

        if (materialDiff < -1 || isOpponentNearFlying || phase === 'FLYING') {
            return MODE_DECISIVE;
        }
        if (phase === 'MOVING' && mobilityGap > 2) {
            return MODE_SUPPRESSION;
        }
        return MODE_EXPANSION;
    }

    function applyModeBonus(score, tags, mode) {
        let bonus = 0;

        // 通用加成（所有模式下都生效）
        if (tags.includes('NEAR_MILL')) bonus += 40;  // 差一步成行
        if (tags.includes('MILL')) bonus += 200;       // 形成磨坊（极大鼓励）
        if (tags.includes('CAPTURE')) bonus += 150;    // 吃子（极大鼓励）

        switch (mode) {
            case MODE_EXPANSION:
                if (tags.includes('HUB_CONTROL')) bonus += 15;
                if (tags.includes('LAYOUT')) bonus += 10;
                break;
            case MODE_SUPPRESSION:
                if (tags.includes('SQUEEZE')) bonus += 20;
                if (tags.includes('ANTI_FLYING')) bonus += 15;
                if (tags.includes('BLOCK')) bonus += 10;
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
        const r1 = E.makeMove(move);
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
     * 加权随机选择（softmax 分布）
     * 高分走法概率高，低分走法概率低，呈正态/对数分布
     * @param {Array} sorted - 按分数降序排列的走法数组
     * @param {number} temperature - 温度参数（越小越确定，越大越随机）
     * @returns {object} 选中的走法条目
     */
    function pickWithWeightedRandom(sorted, temperature = 1.0) {
        if (sorted.length === 0) return null;
        if (sorted.length === 1) return sorted[0];

        // softmax 计算概率
        const maxScore = sorted[0].score;
        const expScores = sorted.map(m => Math.exp((m.score - maxScore) / temperature));
        const sumExp = expScores.reduce((a, b) => a + b, 0);

        // 加权随机选择
        let r = Math.random();
        for (let i = 0; i < sorted.length; i++) {
            r -= expScores[i] / sumExp;
            if (r <= 0) return sorted[i];
        }
        return sorted[sorted.length - 1]; // fallback
    }

    /**
     * 兼容旧接口：top 分相同随机选择
     */
    function pickWithTieBreak(sorted) {
        return pickWithWeightedRandom(sorted, 0.1); // 极低温度 = 近似确定性
    }

    /**
     * 为指定玩家选择最佳走法（支持双人对战）
     * @param {number} player - TYPE_HUMAN 或 TYPE_AI
     * @param {number} [depth] - 搜索深度（默认使用当前配置）
     * @returns {{ move: object, score: number, mode: string, report: object, stats: object }}
     */
    function selectBestMoveForPlayer(player, depth) {
        let d = depth || currentConfig.depth;
        const isAI = (player === E.TYPE_AI);

        nodeCount = 0;
        timeLimitReached = false;
        const startTime = Date.now();
        searchStartTime = startTime;

        const report = S.generateReport();
        const mode = determineMode(report);

        // 动态深度分配：根据策略模式调整搜索深度
        if (!depth) { // 仅在未指定深度时动态调整
            if (mode === MODE_SUPPRESSION) {
                d = Math.min(d + 1, 6); // 压制模式：分支因子小，+1 层
            } else if (mode === MODE_DECISIVE && report.context.phase === 'FLYING') {
                d = Math.max(d - 1, 2); // 飞行模式：分支因子爆炸，-1 层
            }
        }

        const moves = E.generateLegalMoves(player);

        if (moves.length === 0) return null;

        const moveScores = [];

        for (let i = 0; i < moves.length; i++) {
            // 时间限制检查（在主循环中）
            if (Date.now() - startTime > MAX_THINK_TIME) {
                timeLimitReached = true;
                break;
            }

            const move = moves[i];

            const result = E.makeMove(move);
            // 根据玩家视角决定 minimax 方向
            // AI 视角：AI 是 maximizing；HUMAN 视角：HUMAN 是 maximizing
            const nextIsMax = result.formedMill ? isAI : !isAI;
            // 从当前玩家视角评估（正分=对当前玩家有利）
            const rawScore = isAI
                ? -minimax(d - 1, -Infinity, Infinity, nextIsMax)
                : minimax(d - 1, -Infinity, Infinity, nextIsMax);
            E.undoMove();

            const reportEntry = report.suggestedMoves.find(
                r => r.move.from === move.from && r.move.to === move.to && r.move.remove === move.remove
            );
            const tags = reportEntry ? reportEntry.tags : [];
            const risk = reportEntry ? reportEntry.risk : 'low';

            const finalScore = applyModeBonus(rawScore, tags, mode);

            moveScores.push({ move, score: finalScore, rawScore, tags, risk });
        }

        // 如果没有评估任何走法（时间限制），返回第一个合法走法
        if (moveScores.length === 0) {
            return {
                move: moves[0],
                score: 0,
                mode,
                report,
                allScores: [],
                stats: {
                    depth: d,
                    nodeCount,
                    elapsed: Date.now() - startTime,
                    nodesPerMs: 0,
                    config: currentConfig.label,
                    timeLimited: true
                }
            };
        }

        // 按分数降序排列
        moveScores.sort((a, b) => b.score - a.score);

        // 加权随机选择（温度参数控制随机性）
        const chosen = pickWithWeightedRandom(moveScores, currentConfig.temperature);

        const elapsed = Date.now() - startTime;

        return {
            move: chosen.move,
            score: chosen.score,
            mode,
            report,
            allScores: moveScores,
            stats: {
                depth: d,
                nodeCount,
                elapsed,
                nodesPerMs: nodeCount > 0 ? Math.round(nodeCount / elapsed) : 0,
                config: currentConfig.label,
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
