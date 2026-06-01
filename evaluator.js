// ========================================================
// Nine Men's Morris 局面评估器 (Evaluator) — Bitboard 版
//
// 职责：叶子节点静态评分（AI 视角，正分 = AI 优势）
//   - 使用 Engine 的位掩码 API 直接操作，无 board[] 数组访问
//   - 纯函数：输入棋盘状态 + 深度，输出分数
//   - 深度加权：所有启发式特征乘以 (depth+1)，偏好更快的胜利
//
// 设计演进：
//   旧版：board[mill[0]] === player 逐位置比较，~100 次数组读取 + Set 分配
//   新版：popcount(own & mm) 批量统计，位与 + ctz 位扫描，零数组访问，零 GC 分配
// ========================================================

const Evaluator = (() => {
    const E = Engine;

    // 缓存常用引用（避免重复属性查找）
    const MILL_MASKS = E.MILL_MASKS;
    const NEIGHBOR_MASKS = E.NEIGHBOR_MASKS;
    const POSITION_MILLS = E.POSITION_MILLS;
    const ctz = E.ctz;
    const popcount = E.popcount;
    const BOARD_MASK = 0xFFFFFF;

    // ==================== Mill 统计 ====================

    /**
     * 检查 playerBits 在 pos 是否在已完成的 mill 中。
     * 与 Engine.isInMillBits 相同逻辑，但 evaluator 内部复用避免跨模块调用。
     */
    function isInCompletedMillBits(playerBits, pos) {
        const pms = POSITION_MILLS[pos];
        for (let i = 0; i < pms.length; i++) {
            if ((playerBits & MILL_MASKS[pms[i]]) === MILL_MASKS[pms[i]]) return true;
        }
        return false;
    }

    /**
     * 单次遍历 16 条 mill 线，同时产出双方 mill 威胁统计。
     *
     * 检测 4 级威胁（从弱到强）：
     *   nearMill:       2+1 模式（2 子 + 1 空位），空位可达
     *   hardNearMill:   nearMill + 对手无法拦截（空位无对手邻居）
     *   rollingFork:    nearMill + 空位有邻居在已完成 mill 中（可连续成 mill）
     *   hardRollingFork: rollingFork + 对手无法拦截 posE 和 posN
     *
     * @param {string} aiPhase - AI 当前阶段
     * @param {string} oppPhase - 对手当前阶段
     * @returns {{ ai: MillStats, opp: MillStats, empty: number }}
     */
    function analyzeMillsBoth(aiPhase, oppPhase) {
        // 允许外部直接调用（不传参数）时自行计算
        if (aiPhase === undefined) aiPhase = E.getPhase(E.TYPE_AI);
        if (oppPhase === undefined) oppPhase = E.getPhase(E.TYPE_OPPONENT);

        const own = E.getOwn();
        const opp = E.getOpp();
        const empty = ~(own | opp) & BOARD_MASK;

        // ── 预计算：已完成 mill 的棋子位掩码 ──
        let ownInMill = 0, oppInMill = 0;
        for (let i = 0; i < 16; i++) {
            const mm = MILL_MASKS[i];
            if ((own & mm) === mm) ownInMill |= mm;
            if ((opp & mm) === mm) oppInMill |= mm;
        }

        const rAI = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        const rOpp = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        // 用位掩码替代 Set 去重（24 位置 → 24 位整数，零 GC 分配）
        let countedAI = 0, countedOpp = 0;

        for (let i = 0; i < 16; i++) {
            const mm = MILL_MASKS[i];
            const ownCnt = popcount(own & mm);
            const oppCnt = popcount(opp & mm);
            const empBits = empty & mm;

            // ── AI 2+1 模式 ──
            if (ownCnt === 2 && oppCnt === 0 && empBits) {
                const posE = ctz(empBits);
                if (!(countedAI & (1 << posE))) {
                    const outsideMill = own & ~mm;
                    // candidateN: posE 的线外 AI 邻居（同时用于可达性和 rolling fork）
                    const candidateN = NEIGHBOR_MASKS[posE] & outsideMill;

                    const reachable = aiPhase !== E.PHASE_MOVING || candidateN !== 0;
                    if (reachable) {
                        countedAI |= (1 << posE);
                        rAI.nearMills++;

                        const neighborOpp = NEIGHBOR_MASKS[posE] & opp;
                        if (oppPhase === E.PHASE_MOVING && neighborOpp === 0)
                            rAI.hardNearMills++;

                        const inMillN = candidateN & ownInMill;
                        if (inMillN) {
                            rAI.rollingForks++;
                            if (oppPhase === E.PHASE_MOVING
                                && neighborOpp === 0
                                && (NEIGHBOR_MASKS[ctz(inMillN)] & opp) === 0)
                                rAI.hardRollingForks++;
                        }
                    }
                }
            }

            // ── Opp 2+1 模式（对称）──
            if (oppCnt === 2 && ownCnt === 0 && empBits) {
                const posE = ctz(empBits);
                if (!(countedOpp & (1 << posE))) {
                    const outsideMill = opp & ~mm;
                    const candidateN = NEIGHBOR_MASKS[posE] & outsideMill;

                    const reachable = oppPhase !== E.PHASE_MOVING || candidateN !== 0;
                    if (reachable) {
                        countedOpp |= (1 << posE);
                        rOpp.nearMills++;

                        const neighborOwn = NEIGHBOR_MASKS[posE] & own;
                        if (aiPhase === E.PHASE_MOVING && neighborOwn === 0)
                            rOpp.hardNearMills++;

                        const inMillN = candidateN & oppInMill;
                        if (inMillN) {
                            rOpp.rollingForks++;
                            if (aiPhase === E.PHASE_MOVING
                                && neighborOwn === 0
                                && (NEIGHBOR_MASKS[ctz(inMillN)] & own) === 0)
                                rOpp.hardRollingForks++;
                        }
                    }
                }
            }
        }

        // ── placement/flying 阶段修正 ──
        if (oppPhase !== E.PHASE_MOVING) {
            rOpp.hardNearMills = Math.max(0, rOpp.nearMills - 1);
            rOpp.hardRollingForks = Math.max(0, rOpp.rollingForks - 1);
        }
        if (aiPhase !== E.PHASE_MOVING) {
            rAI.hardNearMills = Math.max(0, rAI.nearMills - 1);
            rAI.hardRollingForks = Math.max(0, rAI.rollingForks - 1);
        }

        return { ai: rAI, opp: rOpp, empty };
    }

    // ==================== 机动性 ====================

    /**
     * 评估玩家的实际机动性（可达空位数）。
     *
     * @param {number} player - TYPE_AI 或 TYPE_OPPONENT
     * @param {string} phase - 该玩家当前阶段（由调用方缓存传入，避免重复计算）
     * @param {number} empty - 空位掩码（由 analyzeMillsBoth 返回，避免重复计算）
     * @returns {number} 可达空位数
     */
    function countMobility(player, phase, empty) {
        // 允许外部直接调用（不传 phase/empty）时自行计算
        if (empty === undefined) empty = ~(E.getOwn() | E.getOpp()) & BOARD_MASK;
        if (phase === undefined) phase = E.getPhase(player);

        // PLACEMENT/FLYING: 所有空位都可达
        if (phase !== E.PHASE_MOVING) return popcount(empty);

        // MOVING: 遍历空位，检查是否有己方邻居
        const playerBits = E.getPlayerBits(player);
        let mob = 0, bits = empty;
        while (bits) {
            const pos = ctz(bits);
            if (NEIGHBOR_MASKS[pos] & playerBits) mob++;
            bits &= bits - 1;
        }
        return mob;
    }

    /**
     * 计算每个棋子的机动性分布（备用函数）。
     * @param {number} player - TYPE_AI 或 TYPE_OPPONENT
     * @returns {Array<{pos: number, mobility: number}>}
     */
    function getPieceMobility(player) {
        const playerBits = E.getPlayerBits(player);
        const empty = ~(E.getOwn() | E.getOpp()) & BOARD_MASK;
        const result = [];

        let bits = playerBits;
        while (bits) {
            const pos = ctz(bits);
            const m = popcount(NEIGHBOR_MASKS[pos] & empty);
            result.push({ pos, mobility: m });
            bits &= bits - 1;
        }
        return result;
    }

    // ==================== 评估权重 ====================

    const SCORE_WIN = 10000;
    const SCORE_LOSE = -10000;

    const WEIGHTS = {
        capture_ge4: 150,
        capture_fly: 200,
        nearMill: 10,
        hardNearMill: 20,
        rollingFork: 40,
        hardRollingFork: 80,
        mobility: 150,
    };

    // 机动性半衰表：HALF_DECAY[n] = 0.5^(n-1)，n=0..16
    // 避免每次 evaluate 调用 Math.pow
    const HALF_DECAY = new Float64Array(17);
    for (let i = 0; i <= 16; i++) HALF_DECAY[i] = Math.pow(0.5, i - 1);

    // ==================== 局面评估 ====================

    /**
     * 局面评估函数（AI 视角）。
     * 正分 = AI 优势，负分 = 对手优势。
     *
     * @param {number} depth - 搜索深度（0 = 叶子）
     * @param {object|null} ctx - 走法上下文 { player, move, formedMill }
     * @returns {number} 局面分数
     */
    function evaluate(depth, ctx) {
        const w = depth + 1;

        // ── 终局 ──
        if (E.isGameOver()) {
            const winner = E.getWinner();
            if (winner === null) return 0;
            return winner === E.TYPE_AI
                ? SCORE_WIN + w * 500
                : SCORE_LOSE - w * 500;
        }

        // ── 缓存阶段（避免重复调用 getPhase）──
        const aiPhase = E.getPhase(E.TYPE_AI);
        const oppPhase = E.getPhase(E.TYPE_OPPONENT);

        const state = E.getStateView();
        let score = 0;

        // ── 吃子价值 ──
        if (ctx && ctx.move && ctx.move.remove !== null) {
            const mover = ctx.player;
            const opp = mover === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;
            const oppData = opp === E.TYPE_AI ? state.playerAI : state.playerOpponent;
            const oppPieces = oppData.piecesOnBoard + oppData.piecesOnHand;
            const sign = mover === E.TYPE_AI ? 1 : -1;

            if (oppPieces >= 4) score += sign * WEIGHTS.capture_ge4 * w;
        }

        // ── Mill 威胁（传入缓存的阶段，返回 empty 供后续复用）──
        const { ai: aiMills, opp: oppMills, empty } = analyzeMillsBoth(aiPhase, oppPhase);

        score += WEIGHTS.nearMill * w * ((aiMills.nearMills > oppMills.nearMills) - (aiMills.nearMills < oppMills.nearMills));
        score += WEIGHTS.hardNearMill * w * ((aiMills.hardNearMills > oppMills.hardNearMills) - (aiMills.hardNearMills < oppMills.hardNearMills));
        score += WEIGHTS.rollingFork * w * ((aiMills.rollingForks > oppMills.rollingForks) - (aiMills.rollingForks < oppMills.rollingForks));
        score += WEIGHTS.hardRollingFork * w * ((aiMills.hardRollingForks > oppMills.hardRollingForks) - (aiMills.hardRollingForks < oppMills.hardRollingForks));

        // ── 飞行转折期 ──
        const oppTotal = state.playerOpponent.piecesOnBoard + state.playerOpponent.piecesOnHand;
        if (oppTotal === 3 && aiMills.nearMills >= 2) score += WEIGHTS.capture_fly * w;
        if (oppTotal === 4 && aiMills.nearMills >= 3) score += WEIGHTS.capture_fly * w;

        // ── 机动性（复用 empty 和 phase，查表替代 Math.pow）──
        if (oppPhase === E.PHASE_MOVING) {
            const mob = countMobility(E.TYPE_OPPONENT, oppPhase, empty);
            score += Math.round(WEIGHTS.mobility * w * HALF_DECAY[mob]);
        }
        if (aiPhase === E.PHASE_MOVING) {
            const mob = countMobility(E.TYPE_AI, aiPhase, empty);
            score -= Math.round(WEIGHTS.mobility * w * HALF_DECAY[mob]);
        }

        return score;
    }

    // ==================== 公开接口 ====================

    /** 单玩家 mill 统计（从 analyzeMillsBoth 结果中提取）。 */
    function analyzeMills(player) {
        const aiPhase = E.getPhase(E.TYPE_AI);
        const oppPhase = E.getPhase(E.TYPE_OPPONENT);
        const both = analyzeMillsBoth(aiPhase, oppPhase);
        return player === E.TYPE_AI ? both.ai : both.opp;
    }

    return {
        SCORE_WIN, SCORE_LOSE,
        WEIGHTS,
        analyzeMills,
        analyzeMillsBoth,
        countMobility,
        getPieceMobility,
        evaluate
    };
})();
