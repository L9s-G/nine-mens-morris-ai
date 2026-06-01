// ========================================================
// Nine Men's Morris 局面评估器 (Evaluator) — Bitboard 版
// 职责：叶子节点静态评分
//   - 使用 Engine 的位掩码 API 直接操作
//   - 纯函数：输入棋盘状态 + 深度，输出分数
// ========================================================

const Evaluator = (() => {
    const E = Engine;

    // 缓存常用引用
    const MILL_MASKS = E.MILL_MASKS;
    const NEIGHBOR_MASKS = E.NEIGHBOR_MASKS;
    const POSITION_MILLS = E.POSITION_MILLS;
    const MILLS = E.MILLS;
    const ctz = E.ctz;
    const popcount = E.popcount;
    const BOARD_MASK = 0xFFFFFF;

    // ==================== Mill 统计 ====================

    /**
     * 检查 playerBits 在 pos 是否在已完成的 mill 中
     */
    function isInCompletedMillBits(playerBits, pos) {
        const pms = POSITION_MILLS[pos];
        for (let i = 0; i < pms.length; i++) {
            if ((playerBits & MILL_MASKS[pms[i]]) === MILL_MASKS[pms[i]]) return true;
        }
        return false;
    }

    /**
     * 单次遍历 16 条 mill 线，同时产出双方 mill 统计（bitboard 版）
     *
     * @returns {{ ai: MillStats, opp: MillStats }}
     */
    function analyzeMillsBoth() {
        const own = E.getOwn();
        const opp = E.getOpp();
        const empty = ~(own | opp) & BOARD_MASK;
        const aiPhase = E.getPhase(E.TYPE_AI);
        const oppPhase = E.getPhase(E.TYPE_OPPONENT);

        // 预计算：已完成 mill 的棋子位掩码
        let ownInMill = 0, oppInMill = 0;
        for (let i = 0; i < 16; i++) {
            const mm = MILL_MASKS[i];
            if ((own & mm) === mm) ownInMill |= mm;
            if ((opp & mm) === mm) oppInMill |= mm;
        }

        const rAI = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        const rOpp = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        const countedAI = new Set();
        const countedOpp = new Set();

        for (let i = 0; i < 16; i++) {
            const mm = MILL_MASKS[i];
            const ownCnt = popcount(own & mm);
            const oppCnt = popcount(opp & mm);
            const empBits = empty & mm;

            // AI 2+1
            if (ownCnt === 2 && oppCnt === 0 && empBits) {
                const posE = ctz(empBits);
                if (!countedAI.has(posE)) {
                    const outsideMill = own & ~mm;
                    const reachable = aiPhase !== E.PHASE_MOVING
                        || (NEIGHBOR_MASKS[posE] & outsideMill) !== 0;
                    if (reachable) {
                        countedAI.add(posE);
                        rAI.nearMills++;
                        if (oppPhase === E.PHASE_MOVING && (NEIGHBOR_MASKS[posE] & opp) === 0)
                            rAI.hardNearMills++;
                        const candidateN = NEIGHBOR_MASKS[posE] & outsideMill;
                        const inMillN = candidateN & ownInMill;
                        if (inMillN) {
                            rAI.rollingForks++;
                            if (oppPhase === E.PHASE_MOVING
                                && (NEIGHBOR_MASKS[posE] & opp) === 0
                                && (NEIGHBOR_MASKS[ctz(inMillN)] & opp) === 0)
                                rAI.hardRollingForks++;
                        }
                    }
                }
            }

            // Opp 2+1（对称）
            if (oppCnt === 2 && ownCnt === 0 && empBits) {
                const posE = ctz(empBits);
                if (!countedOpp.has(posE)) {
                    const outsideMill = opp & ~mm;
                    const reachable = oppPhase !== E.PHASE_MOVING
                        || (NEIGHBOR_MASKS[posE] & outsideMill) !== 0;
                    if (reachable) {
                        countedOpp.add(posE);
                        rOpp.nearMills++;
                        if (aiPhase === E.PHASE_MOVING && (NEIGHBOR_MASKS[posE] & own) === 0)
                            rOpp.hardNearMills++;
                        const candidateN = NEIGHBOR_MASKS[posE] & outsideMill;
                        const inMillN = candidateN & oppInMill;
                        if (inMillN) {
                            rOpp.rollingForks++;
                            if (aiPhase === E.PHASE_MOVING
                                && (NEIGHBOR_MASKS[posE] & own) === 0
                                && (NEIGHBOR_MASKS[ctz(inMillN)] & own) === 0)
                                rOpp.hardRollingForks++;
                        }
                    }
                }
            }
        }

        // placement/flying 阶段修正
        if (oppPhase !== E.PHASE_MOVING) {
            rOpp.hardNearMills = Math.max(0, rOpp.nearMills - 1);
            rOpp.hardRollingForks = Math.max(0, rOpp.rollingForks - 1);
        }
        if (aiPhase !== E.PHASE_MOVING) {
            rAI.hardNearMills = Math.max(0, rAI.nearMills - 1);
            rAI.hardRollingForks = Math.max(0, rAI.rollingForks - 1);
        }

        return { ai: rAI, opp: rOpp };
    }

    // ==================== 机动性 ====================

    /**
     * 评估玩家的实际机动性（可达空位数）— bitboard 版
     */
    function countMobility(player) {
        const empty = ~(E.getOwn() | E.getOpp()) & BOARD_MASK;
        const phase = E.getPhase(player);

        if (phase !== E.PHASE_MOVING) return popcount(empty);

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
     * 计算每个棋子的机动性分布 — bitboard 版
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

    // ==================== 局面评估 ====================

    /**
     * 局面评估函数（AI 视角）
     * 正分 = AI 优势，负分 = 对手优势
     */
    function evaluate(depth, ctx) {
        const w = depth + 1;

        if (E.isGameOver()) {
            const winner = E.getWinner();
            if (winner === null) return 0;
            return winner === E.TYPE_AI
                ? SCORE_WIN + w * 500
                : SCORE_LOSE - w * 500;
        }

        const state = E.getStateView();
        let score = 0;

        // 吃子价值
        if (ctx && ctx.move && ctx.move.remove !== null) {
            const mover = ctx.player;
            const opp = mover === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;
            const oppData = opp === E.TYPE_AI ? state.playerAI : state.playerOpponent;
            const oppPieces = oppData.piecesOnBoard + oppData.piecesOnHand;
            const sign = mover === E.TYPE_AI ? 1 : -1;

            if (oppPieces >= 4) score += sign * WEIGHTS.capture_ge4 * w;
        }

        // Mill 威胁
        const { ai: aiMills, opp: oppMills } = analyzeMillsBoth();

        score += WEIGHTS.nearMill * w * ((aiMills.nearMills > oppMills.nearMills) - (aiMills.nearMills < oppMills.nearMills));
        score += WEIGHTS.hardNearMill * w * ((aiMills.hardNearMills > oppMills.hardNearMills) - (aiMills.hardNearMills < oppMills.hardNearMills));
        score += WEIGHTS.rollingFork * w * ((aiMills.rollingForks > oppMills.rollingForks) - (aiMills.rollingForks < oppMills.rollingForks));
        score += WEIGHTS.hardRollingFork * w * ((aiMills.hardRollingForks > oppMills.hardRollingForks) - (aiMills.hardRollingForks < oppMills.hardRollingForks));

        // 飞行转折期
        const oppTotal = state.playerOpponent.piecesOnBoard + state.playerOpponent.piecesOnHand;
        if (oppTotal === 3 && aiMills.nearMills >= 2) score += WEIGHTS.capture_fly * w;
        if (oppTotal === 4 && aiMills.nearMills >= 3) score += WEIGHTS.capture_fly * w;

        // 机动性
        if (E.getPhase(E.TYPE_OPPONENT) === E.PHASE_MOVING) {
            score += Math.round(WEIGHTS.mobility * w * Math.pow(0.5, countMobility(E.TYPE_OPPONENT) - 1));
        }
        if (E.getPhase(E.TYPE_AI) === E.PHASE_MOVING) {
            score -= Math.round(WEIGHTS.mobility * w * Math.pow(0.5, countMobility(E.TYPE_AI) - 1));
        }

        return score;
    }

    // ==================== 公开接口 ====================

    return {
        SCORE_WIN, SCORE_LOSE,
        WEIGHTS,
        analyzeMills: (player) => {
            const both = analyzeMillsBoth();
            return player === E.TYPE_AI ? both.ai : both.opp;
        },
        analyzeMillsBoth,
        countMobility,
        getPieceMobility,
        evaluate
    };
})();
