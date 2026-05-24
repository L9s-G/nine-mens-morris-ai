// ========================================================
// Nine Men's Morris 核心引擎 (Engine)
// 版本：v1.0 - 干净架构版
// 特性：
//   - 支持人类/AI 先手
//   - 完整走法生成器
//   - MILL-FEN 序列化
//   - 清晰的 Move 对象结构
//   - 详细注释，适合后续开发 AI
// ========================================================

const Engine = (() => {
    // ==================== 常量定义 ====================
    const TYPE_OPPONENT = 1;   // 白棋
    const TYPE_AI    = 2;   // 黑棋
    const BOARD_SIZE = 24;

    // 每个点的邻居关系（移动时使用）
    const NEIGHBORS = [
        [1, 9],           // 0
        [0, 2, 4],        // 1
        [1, 14],          // 2
        [4, 10],          // 3
        [1, 3, 5, 7],     // 4
        [4, 13],          // 5
        [7, 11],          // 6
        [4, 6, 8],        // 7
        [7, 12],          // 8
        [0, 10, 21],      // 9
        [3, 9, 11, 18],   // 10
        [6, 10, 15],      // 11
        [8, 13, 17],      // 12
        [5, 12, 14, 20],  // 13
        [2, 13, 23],      // 14
        [11, 16],         // 15
        [15, 17, 19],     // 16
        [12, 16],         // 17
        [10, 19],         // 18
        [16, 18, 20, 22], // 19
        [13, 19],         // 20
        [9, 22],          // 21
        [19, 21, 23],     // 22
        [14, 22]          // 23
    ];

    // 所有可能的 Mill（共 16 条）
    const MILLS = [
        [0,1,2], [3,4,5], [6,7,8], [9,10,11], [12,13,14], [15,16,17], [18,19,20], [21,22,23], // 横线
        [0,9,21], [3,10,18], [6,11,15], [8,12,17], [5,13,20], [2,14,23], [1,4,7], [16,19,22]  // 竖线
    ];

    // 每个位置所属的 Mill 索引
    const POSITION_MILLS = Array.from({ length: 24 }, () => []);
    for (let i = 0; i < MILLS.length; i++) {
        for (let j = 0; j < 3; j++) POSITION_MILLS[MILLS[i][j]].push(i);
    }

    // ==================== 内部状态 ====================
    let state = null;

    function createInitialState(config = {}) {
        const {
            firstPlayer = TYPE_OPPONENT,
            opponentHand = 9,
            aiHand = 9
        } = config;

        return {
            board: new Array(BOARD_SIZE).fill(null),   // null | TYPE_OPPONENT | TYPE_AI
            
            currentPlayer: firstPlayer,                // 当前玩家
            millMove: false,                           // 是否处于吃子阶段（刚形成 Mill）
            
            playerOpponent: {
                piecesOnHand: opponentHand,
                piecesOnBoard: 0,
                piecesLost: 0
            },
            playerAI: {
                piecesOnHand: aiHand,
                piecesOnBoard: 0,
                piecesLost: 0
            },
            
            moveHistory: [],      // 走棋历史
            gameOver: false,
            winner: null
        };
    }

    // ==================== 工具函数 ====================
    
    /** 根据玩家类型返回对应的玩家的棋子数 */
    function getPlayer(playerType) {
        return playerType === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
    }

    function isInMill(board, pos, player) {
        const posMills = POSITION_MILLS[pos];
        for (let i = 0; i < posMills.length; i++) {
            const mill = MILLS[posMills[i]];
            if (board[mill[0]] === player && board[mill[1]] === player && board[mill[2]] === player) {
                return true;
            }
        }
        return false;
    }

    function countMills(player) {
        let count = 0;
        const board = state.board;
        for (let i = 0; i < MILLS.length; i++) {
            const mill = MILLS[i];
            if (board[mill[0]] === player && board[mill[1]] === player && board[mill[2]] === player) count++;
        }
        return count;
    }

    // ==================== 核心接口 ====================

    /** 初始化游戏（支持配置先手等） */
    function init(config = {}) {
        state = createInitialState(config);
        return getState();
    }

    /** 重置游戏（保留上次先手设置） */
    function reset() {
        const currentFirst = state ? state.currentPlayer : TYPE_OPPONENT;
        return init({ firstPlayer: currentFirst });
    }

    /** 获取当前状态的深拷贝 */
    function getState() {
        return JSON.parse(JSON.stringify(state));
    }

    /** 获取状态引用（仅供读取，禁止修改） */
    function getRawState() {
        return state;
    }

    /** 获取棋盘浅拷贝（仅供读取，避免 getState 的全量深拷贝开销） */
    function getBoard() {
        return state.board.slice();
    }

    /** 轻量查询：游戏是否结束（无深拷贝） */
    function isGameOver() {
        return state.gameOver;
    }

    /** 轻量查询：获胜方（无深拷贝） */
    function getWinner() {
        return state.winner;
    }

    /**
     * 计算玩家的有效机动性（可移动到的空位数）
     * 比 generateLegalMoves 更轻量：不生成走法对象，不吃子展开
     */
    function countMobility(player) {
        const p = getPlayer(player);
        const isFlying = p.piecesOnHand === 0 && p.piecesOnBoard === 3;
        const isPlacement = p.piecesOnHand > 0;
        const board = state.board;

        // 放置阶段：空位数即机动性
        if (isPlacement) {
            let count = 0;
            for (let i = 0; i < BOARD_SIZE; i++) {
                if (board[i] === null) count++;
            }
            return count;
        }

        // 走子/飞行阶段：每个棋子可到达的空位数
        let count = 0;
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (board[i] !== player) continue;
            if (isFlying) {
                for (let j = 0; j < BOARD_SIZE; j++) {
                    if (board[j] === null) count++;
                }
            } else {
                const neighbors = NEIGHBORS[i];
                for (let j = 0; j < neighbors.length; j++) {
                    if (board[neighbors[j]] === null) count++;
                }
            }
        }
        return count;
    }

    // ==================== MILL-FEN（棋盘快照） ====================

    /** 将当前局面转为字符串（用于调试、存档、置换表） */
    function toFen() {
        let boardStr = '';
        for (let i = 0; i < BOARD_SIZE; i++) {
            boardStr += state.board[i] === null ? '0' : state.board[i];
        }
        const white = `${state.playerOpponent.piecesOnHand}${state.playerOpponent.piecesOnBoard}${state.playerOpponent.piecesLost}`;
        const black = `${state.playerAI.piecesOnHand}${state.playerAI.piecesOnBoard}${state.playerAI.piecesLost}`;
        
        return `${boardStr}/${state.currentPlayer}/${white}/${black}/${state.millMove ? 1 : 0}`;
    }

    /** 从 FEN 字符串恢复局面（带防御性校验） */
    function fromFen(fen) {
        if (typeof fen !== 'string') throw new Error("Invalid MILL-FEN: expected string");

        const parts = fen.split('/');
        if (parts.length !== 5) throw new Error("Invalid MILL-FEN: expected 5 parts");

        // 棋盘：24 位，每位 0/1/2
        const boardChars = parts[0];
        if (boardChars.length !== BOARD_SIZE) throw new Error("Invalid MILL-FEN: board length must be " + BOARD_SIZE);
        const board = new Array(BOARD_SIZE);
        for (let i = 0; i < BOARD_SIZE; i++) {
            const ch = boardChars[i];
            if (ch !== '0' && ch !== '1' && ch !== '2') throw new Error("Invalid MILL-FEN: invalid board char at " + i);
            board[i] = ch === '0' ? null : Number(ch);
        }

        // 当前玩家：1 或 2
        const currentPlayer = Number(parts[1]);
        if (currentPlayer !== TYPE_OPPONENT && currentPlayer !== TYPE_AI) throw new Error("Invalid MILL-FEN: currentPlayer must be 1 or 2");

        // 棋子数：每位 0-9，总和应为 9（白/黑各 9 子）
        function parsePlayer(str, label) {
            if (str.length !== 3) throw new Error("Invalid MILL-FEN: " + label + " must be 3 digits");
            const vals = [];
            for (let i = 0; i < 3; i++) {
                const n = Number(str[i]);
                if (!Number.isInteger(n) || n < 0 || n > 9) throw new Error("Invalid MILL-FEN: " + label + " digit " + i + " must be 0-9");
                vals.push(n);
            }
            if (vals[0] + vals[1] + vals[2] !== 9) throw new Error("Invalid MILL-FEN: " + label + " pieces must sum to 9");
            return { piecesOnHand: vals[0], piecesOnBoard: vals[1], piecesLost: vals[2] };
        }

        const opponent = parsePlayer(parts[2], 'opponent');
        const ai = parsePlayer(parts[3], 'ai');

        // millMove 标志
        if (parts[4] !== '0' && parts[4] !== '1') throw new Error("Invalid MILL-FEN: millMove must be 0 or 1");

        state = {
            board,
            currentPlayer,
            playerOpponent: opponent,
            playerAI: ai,
            millMove: parts[4] === '1',
            moveHistory: [],
            gameOver: false,
            winner: null
        };
        return getState();
    }

    // ==================== 走法生成 ====================

    /** 生成当前玩家所有合法走法 */
    function generateLegalMoves(player) {
        const moves = [];
        const opp = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const isPlacement = p.piecesOnHand > 0;
        const isFlying = !isPlacement && p.piecesOnBoard === 3;

        // 如果处于吃子阶段（millMove=true），只能执行吃子走法
        if (state.millMove) {
            // 找到所有对手的棋子
            const oppPositions = [];
            for (let i = 0; i < BOARD_SIZE; i++) {
                if (state.board[i] === opp) oppPositions.push(i);
            }

            // 找到可以吃掉的棋子（不在磨坊中的棋子）
            let removable = [];
            for (let oi = 0; oi < oppPositions.length; oi++) {
                const pos = oppPositions[oi];
                if (!isInMill(state.board, pos, opp)) {
                    removable.push(pos);
                }
            }

            // 如果对手所有棋子都在磨坊中，则可以吃任意一子
            if (removable.length === 0) {
                removable = oppPositions;
            }

            // 为每个可吃子位置生成一个吃子走法
            for (let ri = 0; ri < removable.length; ri++) {
                moves.push({
                    player,
                    type: 'remove',
                    from: -1,
                    to: -1,
                    remove: removable[ri]
                });
            }

            return moves;
        }

        // 1. 放置阶段
        if (isPlacement) {
            for (let to = 0; to < BOARD_SIZE; to++) {
                if (state.board[to] === null) {
                    moves.push({ player, type: 'place', from: -1, to, remove: null });
                }
            }
        } 
        // 2. 移动或飞行阶段
        else {
            const myPositions = [];
            for (let i = 0; i < BOARD_SIZE; i++) {
                if (state.board[i] === player) myPositions.push(i);
            }

            for (let fi = 0; fi < myPositions.length; fi++) {
                const from = myPositions[fi];
                let targets = [];
                if (isFlying) {
                    for (let i = 0; i < BOARD_SIZE; i++) {
                        if (state.board[i] === null) targets.push(i);
                    }
                } else {
                    const neighbors = NEIGHBORS[from];
                    for (let ni = 0; ni < neighbors.length; ni++) {
                        if (state.board[neighbors[ni]] === null) targets.push(neighbors[ni]);
                    }
                }

                for (let ti = 0; ti < targets.length; ti++) {
                    const to = targets[ti];
                    moves.push({
                        player,
                        type: isFlying ? 'fly' : 'move',
                        from,
                        to,
                        remove: null
                    });
                }
            }
        }

        // 3. 处理吃子逻辑
        const finalMoves = [];
        const board = state.board;
        for (let mi = 0; mi < moves.length; mi++) {
            const move = moves[mi];
            // 原地修改棋盘
            const fromSaved = move.from !== -1 ? board[move.from] : null;
            if (move.from !== -1) board[move.from] = null;
            board[move.to] = player;

            if (isInMill(board, move.to, player)) {
                // 需要吃子
                let removable = [];
                for (let i = 0; i < BOARD_SIZE; i++) {
                    if (board[i] === opp && !isInMill(board, i, opp)) {
                        removable.push(i);
                    }
                }
                // 如果对方全部在 Mill 中，则可以吃任意一子
                if (removable.length === 0) {
                    for (let i = 0; i < BOARD_SIZE; i++) {
                        if (board[i] === opp) removable.push(i);
                    }
                }

                for (let ri = 0; ri < removable.length; ri++) {
                    finalMoves.push({ player: move.player, type: move.type, from: move.from, to: move.to, remove: removable[ri] });
                }
            } else {
                finalMoves.push(move);
            }

            // 还原棋盘
            board[move.to] = null;
            if (move.from !== -1) board[move.from] = fromSaved;
        }

        return finalMoves;
    }

    // ==================== 执行走法 ====================

    /** 执行一步棋（支持 UI 和 AI 搜索） */
    function makeMove(move) {
        if (!move) return null;

        const { player, from, to, remove, type } = move;
        const opp = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(opp);

        // 记录历史（removedFrom 记录被吃棋子归属，供 undoMove 使用）
        const historyEntry = { player, type, from, to, remove, removedFrom: type === 'remove' ? opp : null };

        // 处理吃子走法
        if (type === 'remove') {
            // 执行吃子
            if (remove !== null) {
                state.board[remove] = null;
                oppP.piecesOnBoard--;
                oppP.piecesLost++;
            }
            
            // 重置吃子状态
            state.millMove = false;
            
            // 切换回合
            state.currentPlayer = opp;
            
            // 记录历史
            state.moveHistory.push(historyEntry);
            
            // 检查游戏结束
            checkGameOver();
            
            return { formedMill: false, move: historyEntry };
        }

        // 处理普通走法（place、move、fly）
        if (type === 'place') {
            // 放置：从手放到棋盘
            state.board[to] = player;
            p.piecesOnHand--;
            p.piecesOnBoard++;
        } else {
            // 移动/飞行：棋盘上位置变化，棋子数不变
            state.board[from] = null;
            state.board[to] = player;
        }

        // 检查是否形成 Mill
        const formedMill = isInMill(state.board, to, player);

        // 如果形成 Mill，设置吃子状态
        if (formedMill) {
            state.millMove = true;
        } else {
            // 没有形成 Mill，切换回合
            state.currentPlayer = opp;
        }

        // 记录历史
        state.moveHistory.push(historyEntry);

        // 检查游戏结束（只在非吃子阶段检查）
        if (!state.millMove) {
            checkGameOver();
        }

        return { formedMill, move: historyEntry };
    }

    function checkGameOver() {
        const current = getPlayer(state.currentPlayer);
        const opponent = state.currentPlayer === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;

        // 当前玩家场上棋子少于3个且手上无棋子，对手获胜
        if (current.piecesOnBoard < 3 && current.piecesOnHand === 0) {
            state.gameOver = true;
            state.winner = opponent;
        } else if (generateLegalMoves(state.currentPlayer).length === 0) {
            // 当前玩家无法移动，对手获胜
            state.gameOver = true;
            state.winner = opponent;
        }
    }

    // ==================== 撤销走法 ====================

    /** 撤销最后一步棋（makeMove 的镜像，供 AI 深度搜索使用） */
    function undoMove() {
        if (state.moveHistory.length === 0) return null;

        const entry = state.moveHistory.pop();
        const { player, type, from, to, remove, removedFrom } = entry;
        const opp = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(opp);

        // 处理吃子走法的撤销
        if (type === 'remove') {
            // 还原被吃棋子
            if (remove !== null) {
                state.board[remove] = removedFrom || opp;
                oppP.piecesOnBoard++;
                oppP.piecesLost--;
            }

            // 恢复吃子状态（撤销前 millMove 为 true）
            state.millMove = true;

            // 恢复当前玩家（撤销前是形成磨坊的玩家）
            state.currentPlayer = player;
        } else {
            // 处理普通走法的撤销（place、move、fly）

            // 还原棋盘
            state.board[to] = null;
            if (from !== -1) {
                state.board[from] = player;
            }

            // 还原棋子计数
            if (type === 'place') {
                p.piecesOnHand++;
                p.piecesOnBoard--;
            }

            // 恢复状态（非 remove 走法前 millMove 为 false）
            state.millMove = false;
            state.currentPlayer = player;
        }

        // 重置游戏结束状态（AI 搜索不会越过终局）
        state.gameOver = false;
        state.winner = null;

        return entry;
    }

    // ==================== 公开接口 ====================
    return {
        TYPE_OPPONENT,
        TYPE_AI,
        BOARD_SIZE,
        NEIGHBORS,
        MILLS,
        POSITION_MILLS,

        init,
        reset,
        getState,
        getRawState,
        getBoard,
        isGameOver,
        getWinner,
        toFen,
        fromFen,

        generateLegalMoves,
        countMobility,
        makeMove,
        undoMove,
        countMills,
        isInMill,
        
        // 调试辅助
        debug: {
            logFen: () => console.log("Current FEN:", toFen())
        }
    };
})();