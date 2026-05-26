// ========================================================
// Nine Men's Morris 战术分析层 (Strategy)
// 版本：v1.0
// 特性：
//   - 有效机动性计算（过滤自杀位）
//   - 阵型张力评估（双重威胁/磨坊活性）
//   - 标准化战术报告生成
//   - 走法评分与标签系统
// ========================================================

const Strategy = (() => {
    const E = Engine;

    // ==================== 机动性分析 ====================

    /**
     * 计算玩家的原始机动性（可移动到的空位数）
     * 比 generateLegalMoves 更轻量：不生成走法对象，不吃子展开
     */
    function countMobility(player) {
        const state = E.getStateView();
        const p = player === E.TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
        const isFlying = p.piecesOnHand === 0 && p.piecesOnBoard === 3;
        const isPlacement = p.piecesOnHand > 0;
        const board = state.board;

        if (isPlacement) {
            let count = 0;
            for (let i = 0; i < E.BOARD_SIZE; i++) {
                if (board[i] === null) count++;
            }
            return count;
        }

        let count = 0;
        for (let i = 0; i < E.BOARD_SIZE; i++) {
            if (board[i] !== player) continue;
            if (isFlying) {
                for (let j = 0; j < E.BOARD_SIZE; j++) {
                    if (board[j] === null) count++;
                }
            } else {
                const neighbors = E.NEIGHBORS[i];
                for (let j = 0; j < neighbors.length; j++) {
                    if (board[neighbors[j]] === null) count++;
                }
            }
        }
        return count;
    }

    /**
     * 计算玩家在棋盘上的完整磨坊数
     */
    function countMills(player) {
        const board = E.getStateView().board;
        let count = 0;
        for (let i = 0; i < E.MILLS.length; i++) {
            const mill = E.MILLS[i];
            if (board[mill[0]] === player && board[mill[1]] === player && board[mill[2]] === player) count++;
        }
        return count;
    }

    /**
     * 计算有效机动性
     * 过滤掉"走后会被对方立即成行"的自杀位
     * @returns {{ total: number, safe: number }}
     */
    function calculateEffectiveMobility(player) {
        const opp = player === E.TYPE_OPPONENT ? E.TYPE_AI : E.TYPE_OPPONENT;
        const moves = E.generateLegalMoves(player);
        let safe = 0;

        for (let i = 0; i < moves.length; i++) {
            E.makeMove(moves[i]);

            // 检查对方是否能立即成行吃子
            const oppMoves = E.generateLegalMoves(opp);
            let canFormMill = false;
            for (let j = 0; j < oppMoves.length; j++) {
                if (oppMoves[j].remove !== null) {
                    canFormMill = true;
                    break;
                }
            }

            E.undoMove();

            if (!canFormMill) safe++;
        }

        return { total: moves.length, safe };
    }

    // ==================== 阵型张力分析 ====================

    /**
     * 分析阵型张力
     * 识别潜在磨坊（2子+1空）和双重威胁（叉子）
     */
    function analyzeFormationTension(player) {
        const opp = player === E.TYPE_OPPONENT ? E.TYPE_AI : E.TYPE_OPPONENT;
        const board = E.getStateView().board;

        let playerThreats = 0;
        let oppThreats = 0;

        // 记录每个空位被多少条潜在磨坊线共享（用于叉子检测）
        const playerForkMap = new Array(24).fill(0);
        const oppForkMap = new Array(24).fill(0);

        // 遍历所有磨坊线
        for (let i = 0; i < E.MILLS.length; i++) {
            const [a, b, c] = E.MILLS[i];
            const vals = [board[a], board[b], board[c]];

            let pCount = 0, oCount = 0, emptyPos = -1;
            for (let j = 0; j < 3; j++) {
                if (vals[j] === player) pCount++;
                else if (vals[j] === opp) oCount++;
                else emptyPos = [a, b, c][j];
            }

            // 玩家 2子+1空 = 潜在磨坊
            if (pCount === 2 && oCount === 0 && emptyPos !== -1) {
                playerThreats++;
                playerForkMap[emptyPos]++;
            }
            // 对手 2子+1空 = 潜在磨坊
            if (oCount === 2 && pCount === 0 && emptyPos !== -1) {
                oppThreats++;
                oppForkMap[emptyPos]++;
            }
        }

        // 叉子：空位被 >=2 条同色潜在磨坊共享
        let playerForks = 0, oppForks = 0;
        for (let i = 0; i < 24; i++) {
            if (playerForkMap[i] >= 2) playerForks++;
            if (oppForkMap[i] >= 2) oppForks++;
        }

        return {
            playerThreats,
            oppThreats,
            playerForks,
            oppForks,
            tensionScore: (playerThreats + playerForks * 3) - (oppThreats + oppForks * 3)
        };
    }

    // ==================== 局面评估 ====================

    /**
     * 静态局面评估（从指定玩家视角）
     * 综合兵力差、机动性差、近磨威胁、叉子、磨坊数、飞行威胁、劣势补偿
     * @param {number} player - 视角玩家（TYPE_AI 或 TYPE_OPPONENT）
     * @returns {number} 局面分数（正 = 优势，负 = 劣势）
     */
    function computeBoardScore(player) {
        const state = E.getStateView();
        const playerData = player === E.TYPE_AI ? state.playerAI : state.playerOpponent;
        const oppData = player === E.TYPE_AI ? state.playerOpponent : state.playerAI;
        const opp = player === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;

        const phaseFactor = 1 - (Math.max(playerData.piecesOnHand, oppData.piecesOnHand) / 9);
        const forceW = WEIGHTS.force * (1 - phaseFactor * 0.3);
        const mobilityW = WEIGHTS.mobility * (1 + phaseFactor * 2);

        const forceDiff = (playerData.piecesOnBoard + playerData.piecesOnHand) - (oppData.piecesOnBoard + oppData.piecesOnHand);
        const mobilityDiff = countMobility(player) - countMobility(opp);

        const playerTension = analyzeFormationTension(player);
        const oppTension = analyzeFormationTension(opp);
        const threatDiff = playerTension.playerThreats - oppTension.playerThreats;
        const nearMillBonus = WEIGHTS.nearMill * playerTension.playerThreats + WEIGHTS.opponentNearMill * oppTension.playerThreats;

        const playerMills = countMills(player);
        const oppMills = countMills(opp);
        const millDiff = playerMills - oppMills;

        const playerFlying = playerData.piecesOnBoard <= 3 && playerData.piecesOnHand === 0;
        const oppFlying = oppData.piecesOnBoard <= 3 && oppData.piecesOnHand === 0;
        let playerForkW = WEIGHTS.fork, oppForkW = WEIGHTS.fork;
        if (playerFlying && oppFlying) { playerForkW = 0; oppForkW = 0; }
        else if (oppFlying) { playerForkW = 60; oppForkW = 0; }
        else if (playerFlying) { playerForkW = 0; oppForkW = 60; }

        let flyThreat = 0;
        if (oppFlying) flyThreat += WEIGHTS.flyThreat;
        if (playerFlying) flyThreat -= WEIGHTS.flyThreat;

        let desperationBonus = 0;
        if (forceDiff <= -3) desperationBonus += WEIGHTS.desperation;

        return (
            forceW * forceDiff +
            mobilityW * mobilityDiff +
            WEIGHTS.threat * threatDiff +
            playerForkW * playerTension.playerForks - oppForkW * oppTension.playerForks +
            WEIGHTS.mill * millDiff +
            nearMillBonus +
            flyThreat +
            desperationBonus
        );
    }

    /**
     * 计算走法奖励值（用于 minimax 叶子和根层排序）
     * 返回 bonus 对象，供 ctx 传递和 evaluateMove 复用
     * @param {object} move - 走法
     * @param {number} player - 走棋方
     * @param {number} oppCapturesBefore - 走前对手可吃子走法数
     * @returns {{ nearMill, squeeze, hubControl, block, risky }}
     */
    function computeBonus(move, player, oppCapturesBefore) {
        const opp = player === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;
        const board = E.getStateView().board;

        let nearMill = false;
        if (move.type !== 'remove') {
            const posMills = E.POSITION_MILLS[move.to];
            for (let i = 0; i < posMills.length; i++) {
                const mill = E.MILLS[posMills[i]];
                let mine = 0, empty = 0;
                for (let j = 0; j < 3; j++) {
                    if (board[mill[j]] === player) mine++;
                    else if (board[mill[j]] === null) empty++;
                }
                if (mine === 2 && empty === 1) { nearMill = true; break; }
            }
        }

        const oppMoves = E.generateLegalMoves(opp);
        let oppCapturesNow = 0;
        for (let i = 0; i < oppMoves.length; i++) {
            if (oppMoves[i].remove !== null) oppCapturesNow++;
        }
        const squeeze = oppMoves.length <= 2;

        let hubControl = false;
        if (move.type !== 'remove') {
            const neighbors = E.NEIGHBORS[move.to];
            let emptyN = 0;
            for (let i = 0; i < neighbors.length; i++) {
                if (board[neighbors[i]] === null) emptyN++;
            }
            if (emptyN >= 2) hubControl = true;
        }

        return {
            nearMill, squeeze, hubControl,
            block: oppCapturesBefore > oppCapturesNow,
            risky: oppCapturesNow > oppCapturesBefore
        };
    }

    /**
     * 走法奖励分（从 ctx.bonus 读取，避免重复 makeMove）
     * @param {number} sign - 方向修正（AI 视角 = 1，对手视角 = -1）
     * @param {object} ctx - 走法上下文 { player, move, result, bonus }
     * @returns {number} 走法奖励分 × sign
     */
    function computeMoveBonus(sign, ctx) {
        if (!ctx || !ctx.move) return 0;

        let bonus = 0;

        if (ctx.formedMill) bonus += WEIGHTS.millFormed;
        if (ctx.move.remove !== null) bonus += WEIGHTS.capture;

        const b = ctx.bonus;
        if (b) {
            if (b.block) bonus += WEIGHTS.block;
            if (b.risky) bonus += WEIGHTS.risky;
            if (b.nearMill) bonus += WEIGHTS.nearMillMove;
            if (b.squeeze) bonus += WEIGHTS.squeeze;
            if (b.hubControl) bonus += WEIGHTS.hubControl;
        }

        return bonus * sign;
    }

    /**
     * 叶子节点评估 = 静态局面分 + 走法奖励分
     * AI minimax 搜索的终止评估函数
     * @param {object|null} ctx - 走法上下文 { player, move, result, bonus }，初始调用可传 null
     * @returns {number} 从 AI 视角的评估分（±10000 为终局）
     */
    function evaluatePosition(ctx) {
        const state = E.getStateView();
        if (state.gameOver) {
            if (state.winner === E.TYPE_AI) return 10000;
            if (state.winner === E.TYPE_OPPONENT) return -10000;
        }
        return computeBoardScore(E.TYPE_AI) + computeMoveBonus(1, ctx);
    }

    // ==================== 走法评估 ====================

    /**
     * 评估单个走法，返回评分、标签
     * @param {object} move - 走法
     * @param {number} player - 玩家
     * @param {string} mode - 策略模式（EXPANSION / SUPPRESSION / DECISIVE）
     * @param {object} bonus - 预计算的 bonus 对象（由 computeBonus 提供）
     * @param {boolean} formedMill - makeMove 返回的 formedMill 标志
     */
    function evaluateMove(move, player, mode, bonus, formedMill) {
        const tags = [];

        // MILL：直接使用 makeMove 的结果，无需模拟落子
        if (formedMill) tags.push('MILL');

        // CAPTURE
        if (move.remove !== null) tags.push('CAPTURE');

        // 从 bonus 读取战术标签
        if (bonus.hubControl) tags.push('HUB_CONTROL');
        if (bonus.nearMill) tags.push('NEAR_MILL');
        if (bonus.squeeze) tags.push('SQUEEZE');
        if (bonus.block) tags.push('BLOCK');
        if (bonus.risky) tags.push('RISKY');

        // ANTI_FLYING：需要棋盘状态，bonus 不含此信息
        if (!tags.includes('ANTI_FLYING')) {
            const state = E.getStateView();
            const oppData = player === E.TYPE_OPPONENT ? state.playerAI : state.playerOpponent;
            if (oppData.piecesOnBoard <= 4 && oppData.piecesOnHand === 0) {
                tags.push('ANTI_FLYING');
            }
        }

        // --- 策略模式加成 ---
        let score = 0;
        if (tags.includes('NEAR_MILL')) score += WEIGHTS.modeNearMill;
        if (tags.includes('MILL')) score += WEIGHTS.modeMill;
        if (tags.includes('CAPTURE')) score += WEIGHTS.modeCapture;
        if (tags.includes('BLOCK')) score += WEIGHTS.modeBlock;

        if (mode === 'EXPANSION') {
            if (tags.includes('HUB_CONTROL')) score += WEIGHTS.modeHubControl;
        } else if (mode === 'SUPPRESSION') {
            if (tags.includes('SQUEEZE')) score += WEIGHTS.modeSqueeze;
            if (tags.includes('ANTI_FLYING')) score += WEIGHTS.modeAntiFlying;
        } else if (mode === 'DECISIVE') {
            if (tags.includes('ATTACK')) score += WEIGHTS.modeAttack;
        }

        return { score, tags };
    }

    // ==================== 战术报告生成 ====================

    // ==================== 评估权重（所有评分数值的唯一来源） ====================
    const WEIGHTS = {
        // ── 静态局面 ──
        force:            1,    // 每多一子
        mobility:         3,    // 每个安全移动
        threat:          10,    // 每个潜在磨坊线
        fork:            50,    // 每个叉子
        mill:            40,    // 棋盘上每多一个完整磨坊
        nearMill:        20,    // 己方差一步成行
        opponentNearMill:-30,   // 对手差一步成行
        flyThreat:       50,    // 飞行模式威胁
        desperation:     20,    // 兵力落后 ≥3 的补偿
        // ── 走法奖励（computeMoveBonus）──
        millFormed:     200,    // 走法形成磨坊
        capture:        150,    // 吃子
        block:          100,    // 成功封锁对手成行
        nearMillMove:    30,    // 走法差一步成行
        squeeze:         15,    // 压制对手机动性 ≤2
        hubControl:      10,    // 占据高联通位置
        risky:          -40,    // 走后给对手成行机会
        // ── 模式加成（evaluateMove）──
        modeNearMill:    20,
        modeMill:        50,
        modeCapture:    100,
        modeBlock:      100,
        modeHubControl:  15,    // EXPANSION
        modeSqueeze:     20,    // SUPPRESSION
        modeAntiFlying:  15,    // SUPPRESSION
        modeAttack:      15,    // DECISIVE
    };

    // ==================== 公开接口 ====================
    return {
        WEIGHTS,
        countMobility,
        countMills,
        computeBoardScore,
        computeBonus,
        computeMoveBonus,
        evaluatePosition,
        evaluateMove,
        calculateEffectiveMobility,
        analyzeFormationTension
    };
})();
