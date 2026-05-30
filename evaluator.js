// ========================================================
// Nine Men's Morris 局面评估器 (Evaluator)
// 职责：叶子节点静态评分
//   - 接收搜索深度参数，深度影响战术/策略权重比例
//   - 纯函数：输入棋盘状态 + 深度，输出分数
// ========================================================

const Evaluator = (() => {
    const E = Engine;

    // ==================== Mill 统计 ====================

    /**
     * 检查 pos 是否在已完成的 mill 中
     * 已完成 mill = 该 mill 线上 3 个位置都是 player 的棋子
     */
    function isInCompletedMill(board, pos, player) {
        const posMills = E.POSITION_MILLS[pos];
        for (let i = 0; i < posMills.length; i++) {
            const mill = E.MILLS[posMills[i]];
            if (board[mill[0]] === player && board[mill[1]] === player && board[mill[2]] === player) {
                return true;
            }
        }
        return false;
    }

    /**
     * 一次性扫描所有磨坊线，返回 mill 相关统计
     *
     * 遍历 16 条磨坊线，对每条 2+1 状态判断：
     *   - nearMill：2+1 可达（己方棋子可到达空位）
     *   - hardNearMill：nearMill 且对手不可达（无法 block）
     *   - rollingFork：2+1 的空位邻居在已完成 mill 中
     *   - hardRollingFork：rolling fork 且 posE、posN 都对手不可达（对手飞行前可连续吃子）
     *
     * @param {number} player - 玩家
     * @returns {{ nearMills: number, hardNearMills: number, rollingForks: number, hardRollingForks: number }}
     */
    function analyzeMills(player) {
        const both = analyzeMillsBoth();
        return player === E.TYPE_AI ? both.ai : both.opp;
    }

    /**
     * 单次遍历 16 条 mill 线，同时产出双方 mill 统计
     * 己方/对手的棋子不可能同时占据同一条 mill 线的三个位置，
     * 故同一条线不会同时为双方产生 2+1 模式，单次遍历无歧义。
     *
     * @returns {{ ai: MillStats, opp: MillStats }}
     */
    function analyzeMillsBoth() {
        const board = E.getStateView().board;
        const aiPhase = E.getPhase(E.TYPE_AI);
        const oppPhase = E.getPhase(E.TYPE_OPPONENT);

        const rAI = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        const rOpp = { nearMills: 0, hardNearMills: 0, rollingForks: 0, hardRollingForks: 0 };
        const countedAI = new Set();
        const countedOpp = new Set();

        for (let i = 0; i < E.MILLS.length; i++) {
            const [a, b, c] = E.MILLS[i];
            const va = board[a], vb = board[b], vc = board[c];

            // 单次遍历统计三方数量
            let cntOpp = 0, cntAI = 0, emptyCnt = 0;
            if (va === E.TYPE_OPPONENT) cntOpp++; else if (va === E.TYPE_AI) cntAI++; else emptyCnt++;
            if (vb === E.TYPE_OPPONENT) cntOpp++; else if (vb === E.TYPE_AI) cntAI++; else emptyCnt++;
            if (vc === E.TYPE_OPPONENT) cntOpp++; else if (vc === E.TYPE_AI) cntAI++; else emptyCnt++;

            // 对两个玩家分别检测 2+1 模式（同一条线不会同时为双方产生 2+1）
            for (let p = 0; p < 2; p++) {
                const player = p === 0 ? E.TYPE_OPPONENT : E.TYPE_AI;
                const mine = p === 0 ? cntOpp : cntAI;
                if (mine !== 2 || emptyCnt !== 1) continue;

                const opp = p === 0 ? E.TYPE_AI : E.TYPE_OPPONENT;
                const phase = p === 0 ? oppPhase : aiPhase;
                const oppPh = p === 0 ? aiPhase : oppPhase;
                const r = p === 0 ? rOpp : rAI;
                const counted = p === 0 ? countedOpp : countedAI;

                // 找到空位 posE
                let posE = va === E.EMPTY ? a : vb === E.EMPTY ? b : c;
                if (counted.has(posE)) continue;

                const neighbors = E.NEIGHBORS[posE];

                // ── nearMill：空位是否可达 ──
                let reachable = false;
                if (phase !== E.PHASE_MOVING) {
                    reachable = true;
                } else {
                    for (let n = 0; n < neighbors.length; n++) {
                        const nb = neighbors[n];
                        if (nb === a || nb === b || nb === c) continue;
                        if (board[nb] === player) { reachable = true; break; }
                    }
                }
                if (!reachable) continue;
                counted.add(posE);
                r.nearMills++;

                // ── hardNearMill：对手不可达 ──
                if (oppPh === E.PHASE_MOVING) {
                    let oppCanBlock = false;
                    for (let n = 0; n < neighbors.length; n++) {
                        if (board[neighbors[n]] === opp) { oppCanBlock = true; break; }
                    }
                    if (!oppCanBlock) r.hardNearMills++;
                }

                // ── rollingFork ──
                let posN = -1;
                for (let n = 0; n < neighbors.length; n++) {
                    const nb = neighbors[n];
                    if (nb === a || nb === b || nb === c) continue;
                    if (board[nb] === player && isInCompletedMill(board, nb, player)) {
                        posN = nb; break;
                    }
                }
                if (posN === -1) continue;
                r.rollingForks++;

                // ── hardRollingFork ──
                if (oppPh !== E.PHASE_MOVING) continue;
                let hard = true;
                for (let n = 0; n < neighbors.length; n++) {
                    if (board[neighbors[n]] === opp) { hard = false; break; }
                }
                if (hard) {
                    const posNNeighbors = E.NEIGHBORS[posN];
                    for (let n = 0; n < posNNeighbors.length; n++) {
                        if (board[posNNeighbors[n]] === opp) { hard = false; break; }
                    }
                }
                if (hard) r.hardRollingForks++;
            }
        }

        // placement/flying 阶段：对手每步只能落/飞一子，N-1 个无法同时 block
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
     * 评估玩家的实际机动性（可达空位数）
     *
     * PLACEMENT：棋盘上所有空位（可放任意空位）
     * FLYING：棋盘上所有空位（可飞任意空位）
     * MOVE：空位中至少有一个邻居是己方棋子的（可达空位）
     *
     * @param {number} player - 玩家
     * @returns {number} 可达空位数
     */
    function countMobility(player) {
        const board = E.getStateView().board;
        const phase = E.getPhase(player);
        let mobility = 0;

        for (let i = 0; i < E.BOARD_SIZE; i++) {
            if (board[i] !== E.EMPTY) continue;
            if (phase !== E.PHASE_MOVING) {
                mobility++;
                continue;
            }
            const neighbors = E.NEIGHBORS[i];
            for (let j = 0; j < neighbors.length; j++) {
                if (board[neighbors[j]] === player) { mobility++; break; }
            }
        }

        return mobility;
    }

    // ==================== 单子机动性（备用） ====================

    /**
     * 计算每个棋子的机动性分布
     *
     * 每个棋子的机动性 = 它的空邻居数（它能到达的位置数）
     * 返回一个数组，每个元素是 { pos, mobility }
     *
     * 潜在用途（待验证）：
     *   - mobility=0 的棋子是"死子"，无价值
     *   - 机动性集中在少数棋子上 → 脆弱（堵住这两三个就废了）
     *   - 机动性均匀分布 → 更有韧性
     *
     * @param {number} player - 玩家
     * @returns {Array<{pos: number, mobility: number}>} 棋子位置及其机动性
     */
    function getPieceMobility(player) {
        const board = E.getStateView().board;
        const result = [];

        for (let i = 0; i < E.BOARD_SIZE; i++) {
            if (board[i] !== player) continue;
            let m = 0;
            const neighbors = E.NEIGHBORS[i];
            for (let j = 0; j < neighbors.length; j++) {
                if (board[neighbors[j]] === E.EMPTY) m++;
            }
            result.push({ pos: i, mobility: m });
        }

        return result;
    }

    // ==================== 评估权重 ====================

    const SCORE_WIN = 10000;
    const SCORE_LOSE = -10000;

    const WEIGHTS = {
        // ── 吃子价值（非线性，取决于对手剩余子数）──
        capture_ge4: 150,    // 对手剩余 >=4 子，对手机动性越小AI奖励越高，吃子有价值
        capture_fly: 200,    // 飞行转折期吃子策略
        // 对手剩余 2 子：SCORE_WIN 覆盖

        // ── Mill 威胁（吃子胜利条件）──
        nearMill: 10,    // 2+1 可达
        hardNearMill: 20,    // 2+1 对手不可达
        rollingFork: 40,    // 滚动叉子
        hardRollingFork: 80,    // 滚动叉子、对手不可达
        mobility: 150,    // 机动性：半衰递减 0.5^(mob-1)
    };

    // ==================== 局面评估 ====================

    /**
     * 局面评估函数（AI 视角）
     * 正分 = AI 优势，负分 = 对手优势
     *
     * @param {number} depth - 搜索深度（0 = 叶子）
     * @param {object|null} ctx - 走法上下文 { player, move, formedMill }
     * @returns {number} 局面分数
     */
    function evaluate(depth, ctx) {
        const w = depth + 1;  // 深度加权：叶子=1，越深越大

        // ── 终局：深度加权，偏好更快的胜利，拖延失败 ──
        if (E.isGameOver()) {
            const winner = E.getWinner();
            if (winner === null) return 0;  // 平局：中性分（不偏好也不回避）
            return winner === E.TYPE_AI
                ? SCORE_WIN + w * 500
                : SCORE_LOSE - w * 500;
        }

        const state = E.getStateView();
        let score = 0;

        // ── 吃子价值：非线性，取决于对手剩余子数 ──
        if (ctx && ctx.move && ctx.move.remove !== null) {
            const mover = ctx.player;
            const opp = mover === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;
            const oppData = opp === E.TYPE_AI ? state.playerAI : state.playerOpponent;
            const oppPieces = oppData.piecesOnBoard + oppData.piecesOnHand;
            const sign = mover === E.TYPE_AI ? 1 : -1;

            if (oppPieces >= 4) score += sign * WEIGHTS.capture_ge4 * w;
            // oppPieces === 3: 触发 FLYING，无价值
            // oppPieces === 2: SCORE_WIN 已覆盖
        }

        // ── Mill 威胁：己方 - 对手（单次遍历）──
        const { ai: aiMills, opp: oppMills } = analyzeMillsBoth();

        score += WEIGHTS.nearMill * w * ((aiMills.nearMills > oppMills.nearMills) - (aiMills.nearMills < oppMills.nearMills));
        score += WEIGHTS.hardNearMill * w * ((aiMills.hardNearMills > oppMills.hardNearMills) - (aiMills.hardNearMills < oppMills.hardNearMills));
        score += WEIGHTS.rollingFork * w * ((aiMills.rollingForks > oppMills.rollingForks) - (aiMills.rollingForks < oppMills.rollingForks));
        score += WEIGHTS.hardRollingFork * w * ((aiMills.hardRollingForks > oppMills.hardRollingForks) - (aiMills.hardRollingForks < oppMills.hardRollingForks));

        // ── 飞行转折期吃子策略 ──
        const oppTotal = state.playerOpponent.piecesOnBoard + state.playerOpponent.piecesOnHand;
        if (oppTotal === 3 && aiMills.nearMills >= 2) {
            score += WEIGHTS.capture_fly * w;
        }
        if (oppTotal === 4 && aiMills.nearMills >= 3) {
            score += WEIGHTS.capture_fly * w;
        }

        // ── 机动性：MOVING 阶段，半衰递减 weight * 0.5^(mob-1) ──
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
        analyzeMills,        // (player) → { nearMills, hardNearMills, rollingForks, hardRollingForks }
        analyzeMillsBoth,    // () → { ai: MillStats, opp: MillStats }  单次遍历双方
        countMobility,       // (player) → 可达空位数
        getPieceMobility,    // (player) → [{ pos, mobility }]（备用）
        evaluate             // (depth, ctx) → 局面分数（AI 视角）
    };
})();
