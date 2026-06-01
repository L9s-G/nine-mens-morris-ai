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
//   新版：popcount(own & mm) 批量统计，位与 + ctz 位扫描，零数组访问
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
     * 位运算优化：
     *   popcount(own & mm) → 一次出该 mill 线上 AI 棋子数（旧版 3 次 board[] 读 + 计数）
     *   NEIGHBOR_MASKS[posE] & outsideMill → 一次位与判断可达性（旧版 neighbor 循环）
     *   candidateN & ownInMill → 一次位与判断 rolling fork（旧版逐 neighbor 调 isInCompletedMill）
     *
     * @returns {{ ai: MillStats, opp: MillStats }}
     */
    function analyzeMillsBoth() {
        const own = E.getOwn();
        const opp = E.getOpp();
        const empty = ~(own | opp) & BOARD_MASK;
        const aiPhase = E.getPhase(E.TYPE_AI);
        const oppPhase = E.getPhase(E.TYPE_OPPONENT);

        // ── 预计算：已完成 mill 的棋子位掩码 ──
        // ownInMill 的每个置位 bit 表示"该位置的棋子属于某个已完成 mill"。
        // 后续 rolling fork 检测：candidateN & ownInMill 一次位与判断邻居是否在已完成 mill 中。
        let ownInMill = 0, oppInMill = 0;
        for (let i = 0; i < 16; i++) {
            const mm = MILL_MASKS[i];
            if ((own & mm) === mm) ownInMill |= mm;   // AI 完全占据该 mill 线
            if ((opp & mm) === mm) oppInMill |= mm;   // 对手完全占据该 mill 线
        }

        const rAI = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        const rOpp = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        const countedAI = new Set();   // 去重：同一空位可能被多条 mill 线共享
        const countedOpp = new Set();

        // ── 遍历 16 条 mill 线 ──
        for (let i = 0; i < 16; i++) {
            const mm = MILL_MASKS[i];
            const ownCnt = popcount(own & mm);   // AI 在这条线有几子
            const oppCnt = popcount(opp & mm);   // 对手在这条线有几子
            const empBits = empty & mm;          // 这条线有几个空位（位掩码）

            // ── AI 2+1 模式：2 子 + 1 空位，无对手子干扰 ──
            if (ownCnt === 2 && oppCnt === 0 && empBits) {
                const posE = ctz(empBits);  // 唯一空位的位置
                if (!countedAI.has(posE)) {
                    // outsideMill: AI 棋子中不在当前 mill 线上的部分
                    // 用途：判断空位是否可达（线内的 2 子不能移动到空位，需要线外棋子走过来）
                    const outsideMill = own & ~mm;

                    // nearMill: 空位是否可达？
                    // PLACEMENT/FLYING: 任何空位都可达（可放/可飞）
                    // MOVING: 需要有线外 AI 棋子在空位的邻居中
                    const reachable = aiPhase !== E.PHASE_MOVING
                        || (NEIGHBOR_MASKS[posE] & outsideMill) !== 0;
                    if (reachable) {
                        countedAI.add(posE);
                        rAI.nearMills++;

                        // hardNearMill: 对手无法拦截？
                        // 对手在 MOVING 阶段时，检查 posE 的邻居中有没有对手棋子
                        if (oppPhase === E.PHASE_MOVING && (NEIGHBOR_MASKS[posE] & opp) === 0)
                            rAI.hardNearMills++;

                        // rollingFork: posE 有邻居在已完成 mill 中？
                        // 如果有，AI 落子到 posE 成 mill 后，该邻居可以移动到新空位，
                        // 自动形成下一个 2+1 威胁（连续吃子链条）。
                        // candidateN: posE 的线外 AI 邻居
                        // inMillN: 其中在已完成 mill 中的（双 mill 棋子）
                        const candidateN = NEIGHBOR_MASKS[posE] & outsideMill;
                        const inMillN = candidateN & ownInMill;
                        if (inMillN) {
                            rAI.rollingForks++;

                            // hardRollingFork: 对手完全无法阻止？
                            // 需要：posE 对手不可达 + posN（双 mill 邻居）对手也不可达
                            if (oppPhase === E.PHASE_MOVING
                                && (NEIGHBOR_MASKS[posE] & opp) === 0
                                && (NEIGHBOR_MASKS[ctz(inMillN)] & opp) === 0)
                                rAI.hardRollingForks++;
                        }
                    }
                }
            }

            // ── Opp 2+1 模式（与 AI 完全对称，own ↔ opp）──
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

        // ── placement/flying 阶段修正 ──
        // 在这两个阶段，每步只能落/飞一子，所以 N 个 nearMill 中最多实现 1 个，
        // 剩余 N-1 个对手可以在后续步中逐个拦截。
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
     * 评估玩家的实际机动性（可达空位数）。
     *
     * PLACEMENT/FLYING: 所有空位都可达 → popcount(empty) 一次出结果
     *   旧版：for(i=0;i<24;i++) if(board[i]===EMPTY) mob++  → 24 次循环
     *   新版：popcount(empty) → 1 次位运算
     *
     * MOVING: 只有有己方邻居的空位才可达 → 遍历空位，检查邻居
     *   旧版：24 次循环 + 每次 neighbor 循环
     *   新版：只遍历空位（~10-18 个），每次 1 次位与
     *
     * @param {number} player - TYPE_AI 或 TYPE_OPPONENT
     * @returns {number} 可达空位数
     */
    function countMobility(player) {
        const empty = ~(E.getOwn() | E.getOpp()) & BOARD_MASK;
        const phase = E.getPhase(player);

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
     *
     * 每个棋子的机动性 = 它的空邻居数（能到达的位置数）。
     * 潜在用途：mobility=0 的棋子是"死子"，机动性集中在少数棋子上 → 脆弱。
     *
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
        // ── 吃子价值（非线性，取决于对手剩余子数）──
        capture_ge4: 150,       // 对手剩余 ≥4 子，吃子有价值
        capture_fly: 200,       // 飞行转折期（对手 3-4 子）吃子策略

        // ── Mill 威胁（吃子胜利条件）──
        nearMill: 10,           // 2+1 可达
        hardNearMill: 20,       // 2+1 对手不可达
        rollingFork: 40,        // 滚动叉子（连续 mill 威胁）
        hardRollingFork: 80,    // 滚动叉子 + 对手不可达

        // ── 机动性 ──
        mobility: 150,          // 半衰递减：weight × 0.5^(mob-1)
    };

    // ==================== 局面评估 ====================

    /**
     * 局面评估函数（AI 视角）。
     * 正分 = AI 优势，负分 = 对手优势。
     *
     * 评分公式：score = Σ (特征值 × 权重 × 深度加权)
     * 深度加权 w = depth + 1：叶子=1，越深越大。
     * 效果：深层的胜利分数更高（偏好更快的胜利），深层的失败分数更低（延迟失败）。
     *
     * @param {number} depth - 搜索深度（0 = 叶子）
     * @param {object|null} ctx - 走法上下文 { player, move, formedMill }
     * @returns {number} 局面分数
     */
    function evaluate(depth, ctx) {
        const w = depth + 1;

        // ── 终局：深度加权，偏好更快的胜利，拖延失败 ──
        if (E.isGameOver()) {
            const winner = E.getWinner();
            if (winner === null) return 0;  // 平局：中性分
            return winner === E.TYPE_AI
                ? SCORE_WIN + w * 500
                : SCORE_LOSE - w * 500;
        }

        const state = E.getStateView();
        let score = 0;

        // ── 吃子价值：非线性，取决于对手剩余子数 ──
        // 对手 ≥4 子时吃子有价值（降低对手机动性）
        // 对手 3 子时吃子会触发飞行，反而利好对手
        // 对手 2 子时 SCORE_WIN 已覆盖
        if (ctx && ctx.move && ctx.move.remove !== null) {
            const mover = ctx.player;
            const opp = mover === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;
            const oppData = opp === E.TYPE_AI ? state.playerAI : state.playerOpponent;
            const oppPieces = oppData.piecesOnBoard + oppData.piecesOnHand;
            const sign = mover === E.TYPE_AI ? 1 : -1;

            if (oppPieces >= 4) score += sign * WEIGHTS.capture_ge4 * w;
        }

        // ── Mill 威胁：己方 - 对手（差值比较）──
        const { ai: aiMills, opp: oppMills } = analyzeMillsBoth();

        // (ai > opp) - (ai < opp) = sign(ai - opp)，即 +1/0/-1 三态
        score += WEIGHTS.nearMill * w * ((aiMills.nearMills > oppMills.nearMills) - (aiMills.nearMills < oppMills.nearMills));
        score += WEIGHTS.hardNearMill * w * ((aiMills.hardNearMills > oppMills.hardNearMills) - (aiMills.hardNearMills < oppMills.hardNearMills));
        score += WEIGHTS.rollingFork * w * ((aiMills.rollingForks > oppMills.rollingForks) - (aiMills.rollingForks < oppMills.rollingForks));
        score += WEIGHTS.hardRollingFork * w * ((aiMills.hardRollingForks > oppMills.hardRollingForks) - (aiMills.hardRollingForks < oppMills.hardRollingForks));

        // ── 飞行转折期吃子策略 ──
        // 对手 3 子 + AI 有 ≥2 个 nearMill → 连续吃子机会
        // 对手 4 子 + AI 有 ≥3 个 nearMill → 同理
        const oppTotal = state.playerOpponent.piecesOnBoard + state.playerOpponent.piecesOnHand;
        if (oppTotal === 3 && aiMills.nearMills >= 2) score += WEIGHTS.capture_fly * w;
        if (oppTotal === 4 && aiMills.nearMills >= 3) score += WEIGHTS.capture_fly * w;

        // ── 机动性：MOVING 阶段，半衰递减 ──
        // weight × 0.5^(mob-1)：mob=1 时满权重，mob=5 时 1/16，mob=10 时可忽略
        if (E.getPhase(E.TYPE_OPPONENT) === E.PHASE_MOVING) {
            score += Math.round(WEIGHTS.mobility * w * Math.pow(0.5, countMobility(E.TYPE_OPPONENT) - 1));
        }
        if (E.getPhase(E.TYPE_AI) === E.PHASE_MOVING) {
            score -= Math.round(WEIGHTS.mobility * w * Math.pow(0.5, countMobility(E.TYPE_AI) - 1));
        }

        return score;
    }

    // ==================== 公开接口 ====================

    /** 单玩家 mill 统计（从 analyzeMillsBoth 结果中提取）。 */
    function analyzeMills(player) {
        const both = analyzeMillsBoth();
        return player === E.TYPE_AI ? both.ai : both.opp;
    }

    return {
        SCORE_WIN, SCORE_LOSE,
        WEIGHTS,
        analyzeMills,        // (player) → { nearMills, hardNearMills, rollingForks, hardRollingForks }
        analyzeMillsBoth,    // () → { ai: MillStats, opp: MillStats }  单次遍历双方
        countMobility,       // (player) → 可达空位数
        getPieceMobility,    // (player) → [{ pos, mobility }]（备用）
        evaluate             // (depth, ctx) → 局面分数（AI 视角）
    };
})();
