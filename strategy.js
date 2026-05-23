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
        const board = E.getBoard();

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

    // ==================== 走法评估 ====================

    /**
     * 评估单个走法，返回评分、标签、风险
     */
    function evaluateMove(move, player) {
        const opp = player === E.TYPE_OPPONENT ? E.TYPE_AI : E.TYPE_OPPONENT;
        let score = 0;
        const tags = [];

        // --- 走前：统计对方成行机会 ---
        const oppMovesBefore = E.generateLegalMoves(opp);
        let oppMillsBefore = 0;
        for (let i = 0; i < oppMovesBefore.length; i++) {
            if (oppMovesBefore[i].remove !== null) oppMillsBefore++;
        }

        // 占据高联通性位置（Hub）— 走前检测目标位置
        let emptyNeighbors = 0;
        if (move.type !== 'remove') {
            const neighbors = E.NEIGHBORS[move.to];
            const board = E.getBoard();
            for (let i = 0; i < neighbors.length; i++) {
                if (board[neighbors[i]] === null) emptyNeighbors++;
            }
            if (emptyNeighbors >= 2) {
                score += 10;
                tags.push('HUB_CONTROL');
            }
        }

        // --- 执行走法 ---
        const result = E.makeMove(move);

        // 形成磨坊（高优先级）
        if (result.formedMill) {
            score += 200;
            tags.push('MILL');
        }

        // 吃子（高优先级）
        if (move.remove !== null) {
            score += 150;
            tags.push('CAPTURE');
        }

        // --- 走后：检查对方反击能力 ---
        const oppMovesAfter = E.generateLegalMoves(opp);
        let oppMillsAfter = 0;
        for (let i = 0; i < oppMovesAfter.length; i++) {
            if (oppMovesAfter[i].remove !== null) oppMillsAfter++;
        }

        // 检查是否安全（对方不能立即成行）
        let isSafe = (oppMillsAfter === 0);

        // 差一步成行检测：走法执行后，检查是否创建了"2子+1空"的潜在磨坊
        if (move.type !== 'remove') {
            const boardAfter = E.getBoard();
            const pos = move.to;
            for (let i = 0; i < E.MILLS.length; i++) {
                const mill = E.MILLS[i];
                if (mill[0] !== pos && mill[1] !== pos && mill[2] !== pos) continue;

                let myCount = 0;
                let emptyCount = 0;
                for (let j = 0; j < 3; j++) {
                    if (boardAfter[mill[j]] === player) myCount++;
                    else if (boardAfter[mill[j]] === null) emptyCount++;
                }
                if (myCount === 2 && emptyCount === 1) {
                    score += 30;
                    tags.push('NEAR_MILL');
                    break;
                }
            }
        }

        // 压制对方机动性（复用走后结果，≤2 才有窒息感）
        if (oppMovesAfter.length <= 2) {
            score += 15;
            tags.push('SQUEEZE');
        }

        // 预防飞行模式
        const oppRaw = E.getRawState();
        const oppData = player === E.TYPE_OPPONENT ? oppRaw.playerAI : oppRaw.playerOpponent;
        if (oppData.piecesOnBoard <= 4 && oppData.piecesOnHand === 0) {
            tags.push('ANTI_FLYING');
        }

        E.undoMove();

        // --- 走后分析完毕，继续评分 ---

        // 阻止对方成行（高优先级）
        if (oppMillsBefore > oppMillsAfter) {
            score += 100;
            tags.push('BLOCK');
        }

        // 不安全走法（允许一定风险以换取进攻）
        if (!isSafe) {
            score -= 40;
            tags.push('RISKY');
        }

        return { score, tags };
    }

    // ==================== 战术报告生成 ====================

    // ==================== 公开接口 ====================
    return {
        evaluateMove,
        calculateEffectiveMobility,
        analyzeFormationTension
    };
})();
