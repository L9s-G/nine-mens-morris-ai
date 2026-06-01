// ========================================================
// Nine Men's Morris 核心引擎 (Engine)
// 职责：游戏规则 + 棋盘状态维护
//   - 棋盘拓扑（NEIGHBORS / MILLS / POSITION_MILLS）
//   - 走法生成（含成磨展开吃子）
//   - 走法执行 / 撤销（makeMove / undoMove）
//   - 状态查询（阶段、终局、FEN 序列化）
// 不含：策略评估、AI 搜索、权重计算
// ========================================================

const Engine = (() => {
    // ==================== 常量定义 ====================
    const EMPTY = 0;           // 空位
    const TYPE_OPPONENT = 1;   // 白棋
    const TYPE_AI = 2;         // 黑棋
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
        [0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23], // 横线
        [0, 9, 21], [3, 10, 18], [6, 11, 15], [8, 12, 17], [5, 13, 20], [2, 14, 23], [1, 4, 7], [16, 19, 22]  // 竖线
    ];

    // 每个位置所属的 Mill 索引（每个位置恰好属于 1 横 1 竖两条线）
    // 使用：POSITION_MILLS[pos] → [millIdx1, millIdx2]
    //       MILLS[millIdx] → 该线上的 3 个位置（pos 及其 2 个邻居）
    const POSITION_MILLS = Array.from({ length: 24 }, () => []);
    for (let i = 0; i < MILLS.length; i++) {
        for (let j = 0; j < 3; j++) POSITION_MILLS[MILLS[i][j]].push(i);
    }

    // ==================== 位置哈希（三次重复检测） ====================
    // 游戏规则：30 步内同一局面出现 3 次判和
    // 环形缓冲区 32 槽（2 的幂 → 取模用位与），滑动窗口覆盖 30 步规则
    const POS_WINDOW = 32;
    const POS_MASK = POS_WINDOW - 1;

    // 预计算 3^i（i=0..23），用于增量哈希
    const pow3 = new Array(BOARD_SIZE);
    pow3[0] = 1;
    for (let i = 1; i < BOARD_SIZE; i++) pow3[i] = pow3[i - 1] * 3;

    /** 从 board + currentPlayer 计算初始哈希（截断为 32 位，与 Uint32Array 一致） */
    function computeHash(board, currentPlayer) {
        let h = currentPlayer;
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (board[i]) h += board[i] * pow3[i];
        }
        return u32(h);
    }

    /** 推入位置哈希到环形缓冲区 */
    function pushHash(hash) {
        state.posBuf[state.writeIdx & POS_MASK] = hash;
        state.writeIdx++;
    }

    /** 弹出最后入窗口的位置哈希 */
    function popHash() {
        state.writeIdx--;
        state.posBuf[state.writeIdx & POS_MASK] = 0;
    }

    /** 检查三次重复：遍历窗口，当前哈希出现 ≥3 次 → 判和 */
    function checkRepetition(hash) {
        const buf = state.posBuf;
        let count = 0;
        for (let i = 0; i < POS_WINDOW; i++) {
            if (buf[i] === hash && ++count >= 3) {
                state.gameOver = true;
                state.winner = null;
                return;
            }
        }
    }

    /** 查询当前局面在窗口中的重复次数（只读，供弹幕等交互使用） */
    function getRepetitionCount() {
        const hash = state.posHash;
        const buf = state.posBuf;
        let count = 0;
        for (let i = 0; i < POS_WINDOW; i++) {
            if (buf[i] === hash) count++;
        }
        return count;
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
            board: new Array(BOARD_SIZE).fill(EMPTY),   // EMPTY | TYPE_OPPONENT | TYPE_AI

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
            winner: null,

            // ── 位置哈希（三次重复检测）──
            posHash: 0,
            posBuf: new Uint32Array(POS_WINDOW),  // 环形缓冲区（连续内存）
            writeIdx: 0,                     // 写指针（绝对位置，取模定位）
        };
    }

    // ==================== 工具函数 ====================

    /** 截断为 32 位无符号整数（哈希增量更新后保持 Uint32Array 一致性） */
    function u32(n) { return n >>> 0; }

    const PHASE_PLACEMENT = 'PLACEMENT';
    const PHASE_MOVING = 'MOVING';
    const PHASE_FLYING = 'FLYING';

    /** 获取玩家当前所处阶段 */
    function getPhase(player) {
        const p = getPlayer(player);
        if (p.piecesOnHand > 0) return PHASE_PLACEMENT;
        if (p.piecesOnBoard === 3) return PHASE_FLYING;
        return PHASE_MOVING;
    }

    /** 根据玩家类型返回对应的玩家的棋子数 */
    function getPlayer(playerType) {
        return playerType === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
    }

    /**
     * pos 是否已在完成的磨坊中（棋盘已落子，检查 3 子是否同色）
     */
    function isInMill(board, pos) {
        const player = board[pos];
        if (player === EMPTY) return false;
        const posMills = POSITION_MILLS[pos];
        for (let i = 0; i < posMills.length; i++) {
            const mill = MILLS[posMills[i]];
            if (board[mill[0]] === player && board[mill[1]] === player && board[mill[2]] === player) {
                return true;
            }
        }
        return false;
    }

    /**
     * 在空位 to 落子是否会形成磨坊
     * 前提：board[to] === EMPTY
     * 逻辑：to 所在的每条磨坊线，另外两子是否都是 player
     */
    function wouldFormMill(board, to, player) {
        const posMills = POSITION_MILLS[to];
        for (let i = 0; i < posMills.length; i++) {
            const mill = MILLS[posMills[i]];
            let count = 0;
            for (let j = 0; j < 3; j++) {
                if (mill[j] !== to && board[mill[j]] === player) count++;
            }
            if (count === 2) return true;
        }
        return false;
    }

    // ==================== 核心接口 ====================

    /** 初始化游戏（支持配置先手等） */
    function init(config = {}) {
        state = createInitialState(config);
        state.posHash = computeHash(state.board, state.currentPlayer);
        pushHash(state.posHash);
    }

    /** 获取当前状态的深拷贝 */
    function getState() {
        return JSON.parse(JSON.stringify(state));
    }

    /** 获取状态视图（只读，禁止修改；返回内部引用，避免深拷贝开销） */
    function getStateView() {
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

    // ==================== MILL-FEN（棋盘快照） ====================

    /** 将当前局面打包为 JSON 字符串 */
    function toFen() {
        let board = 0;
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (state.board[i]) board += state.board[i] * pow3[i];
        }
        const o = state.playerOpponent;
        const a = state.playerAI;
        const meta = (o.piecesOnHand << 16)
            | (o.piecesLost << 12)
            | (a.piecesOnHand << 8)
            | (a.piecesLost << 4)
            | state.currentPlayer | (state.millMove ? 2 : 0);
        return `{"board":${board},"meta":"0x${meta.toString(16).padStart(5, '0')}"}`;
    }

    /** 从快照恢复局面（输入非法则抛异常，由调用方处理） */
    function fromFen(fen) {
        if (typeof fen !== 'string') throw new Error("Invalid FEN: expected string");
        const obj = JSON.parse(fen);
        const boardNum = obj.board;
        const metaStr = obj.meta;
        if (typeof boardNum !== 'number' || typeof metaStr !== 'string') throw new Error("Invalid FEN: missing board/meta");
        if (boardNum < 0) throw new Error("Invalid FEN: negative board");
        const m = parseInt(metaStr, 16);
        if (Number.isNaN(m) || m < 0) throw new Error("Invalid FEN: bad meta");

        const board = new Array(BOARD_SIZE);
        let val = boardNum;
        let onBoardOpp = 0, onBoardAI = 0;
        for (let i = 0; i < BOARD_SIZE; i++) {
            const v = val % 3;
            if (v === TYPE_OPPONENT) onBoardOpp++;
            else if (v === TYPE_AI) onBoardAI++;
            board[i] = v;  // 0=EMPTY, 1=TYPE_OPPONENT, 2=TYPE_AI
            val = (val - v) / 3;
        }

        const last = m & 0xf;
        if (last > 4) throw new Error("Invalid FEN: bad last");
        const aLost = (m >> 4) & 0xf;
        const aHand = (m >> 8) & 0xf;
        const oLost = (m >> 12) & 0xf;
        const oHand = (m >> 16) & 0xf;
        if (oHand + onBoardOpp + oLost !== 9) throw new Error("Invalid FEN: opponent piece mismatch");
        if (aHand + onBoardAI + aLost !== 9) throw new Error("Invalid FEN: ai piece mismatch");
        const opponent = { piecesOnHand: oHand, piecesOnBoard: onBoardOpp, piecesLost: oLost };
        const ai = { piecesOnHand: aHand, piecesOnBoard: onBoardAI, piecesLost: aLost };
        const currentPlayer = last <= 2 ? last : last - 2;
        if (currentPlayer !== TYPE_OPPONENT && currentPlayer !== TYPE_AI) throw new Error("Invalid FEN: bad player");
        const millMove = last > 2;

        const hash = computeHash(board, currentPlayer);
        state = {
            board,
            currentPlayer,
            playerOpponent: opponent,
            playerAI: ai,
            millMove,
            moveHistory: [],
            gameOver: false,
            winner: null,
            posHash: hash,
            posBuf: new Uint32Array(POS_WINDOW),
            writeIdx: 0
        };
        pushHash(hash);
    }

    // ==================== 走法生成 ====================

    /**
     * 生成玩家所有合法走法
     *
     * 返回 Move[]，每个 Move 结构：
     *   {
     *     player: number,   // 执行者 (TYPE_OPPONENT=1 | TYPE_AI=2)
     *     type: string,     // 动作类型: 'place' | 'move' | 'fly' | 'remove'
     *     from: number,     // 起点 (place/remove 时为 -1)
     *     to: number,       // 终点 (remove 时为 -1)
     *     remove: number|null  // 被吃棋子位置 (null 表示无吃子)
     *   }
     *
     * 三种情况：
     *   1. 不成磨：type=动作类型, remove=null
     *      例: { type:'place', from:-1, to:5, remove:null }
     *
     *   2. 成磨需吃子：type=动作类型（非 remove）, remove=被吃位置
     *      一个动作会为所有可吃目标展开，形成多条独立 Move
     *      例: { type:'place', from:-1, to:5, remove:12 }
     *          { type:'place', from:-1, to:5, remove:18 }
     *
     *   3. 纯吃子（millMove 阶段）：type='remove', from=-1, to=-1
     *      当上一步成磨后，进入吃子阶段，只返回吃子 Move
     *      例: { type:'remove', from:-1, to:-1, remove:7 }
     *
     * 吃子约束：优先吃不在磨坊中的棋子；若对手全部在磨坊中，可吃任意一子
     */
    function generateLegalMoves(player) {
        const moves = [];
        const opp = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const phase = getPhase(player);

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
                if (!isInMill(state.board, pos)) {
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
        if (phase === PHASE_PLACEMENT) {
            for (let to = 0; to < BOARD_SIZE; to++) {
                if (state.board[to] === EMPTY) {
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
                if (phase === PHASE_FLYING) {
                    for (let i = 0; i < BOARD_SIZE; i++) {
                        if (state.board[i] === EMPTY) targets.push(i);
                    }
                } else {
                    const neighbors = NEIGHBORS[from];
                    for (let ni = 0; ni < neighbors.length; ni++) {
                        if (state.board[neighbors[ni]] === EMPTY) targets.push(neighbors[ni]);
                    }
                }

                for (let ti = 0; ti < targets.length; ti++) {
                    const to = targets[ti];
                    moves.push({
                        player,
                        type: phase === PHASE_FLYING ? 'fly' : 'move',
                        from,
                        to,
                        remove: null
                    });
                }
            }
        }

        // 3. 处理吃子逻辑
        // removable 在走法生成阶段不依赖具体走法（board 未变动），
        // 且己方落子不可能改变对手棋子的 mill 状态，故可预计算复用。
        const finalMoves = [];
        const board = state.board;
        let removable = null; // 延迟初始化：仅当成磨走法存在时才计算

        for (let mi = 0; mi < moves.length; mi++) {
            const move = moves[mi];

            if (wouldFormMill(board, move.to, player)) {
                // 首次成磨时计算可吃子列表，后续复用
                if (removable === null) {
                    removable = [];
                    for (let i = 0; i < BOARD_SIZE; i++) {
                        if (board[i] === opp && !isInMill(board, i)) {
                            removable.push(i);
                        }
                    }
                    if (removable.length === 0) {
                        for (let i = 0; i < BOARD_SIZE; i++) {
                            if (board[i] === opp) removable.push(i);
                        }
                    }
                }

                for (let ri = 0; ri < removable.length; ri++) {
                    finalMoves.push({ player, type: move.type, from: move.from, to: move.to, remove: removable[ri] });
                }
            } else {
                finalMoves.push(move);
            }
        }

        // 吃子走法优先（加速 alpha-beta 剪枝）
        finalMoves.sort((a, b) => (b.remove !== null ? 1 : 0) - (a.remove !== null ? 1 : 0));
        return finalMoves;
    }

    // ==================== 执行走法 ====================

    /**
     * 执行一步棋（支持 UI 和 AI 搜索）
     * @returns {boolean} true=形成磨坊，调用者需继续执行吃子而非切换回合
     */
    function makeMove(move) {
        if (!move) return null;

        const { player, from, to, remove, type } = move;
        const opp = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(opp);

        // 记录历史（removedFrom 记录被吃棋子归属，供 undoMove 使用）
        const historyEntry = { player, type, from, to, remove, removedFrom: type === 'remove' ? opp : null, formedMill: false };

        // ── 吃子走法 ──
        if (type === 'remove') {
            if (remove !== null) {
                state.board[remove] = EMPTY;
                state.posHash = u32(state.posHash - opp * pow3[remove]);
                oppP.piecesOnBoard--;
                oppP.piecesLost++;
            }

            state.currentPlayer = opp;
            state.posHash = u32(state.posHash + opp - player);
            state.millMove = false;
            state.moveHistory.push(historyEntry);

            pushHash(state.posHash);
            if (!state.gameOver) checkGameOver();
            return false;
        }

        // ── 普通走法（place / move / fly）──
        const formedMill = (() => {
            if (type === 'place') {
                state.board[to] = player;
                state.posHash = u32(state.posHash + player * pow3[to]);
                p.piecesOnHand--;
                p.piecesOnBoard++;
            } else {
                state.board[from] = EMPTY;
                state.board[to] = player;
                state.posHash = u32(state.posHash + player * (pow3[to] - pow3[from]));
            }
            return isInMill(state.board, to);
        })();

        if (formedMill) {
            state.millMove = true;
        } else {
            state.currentPlayer = opp;
            state.posHash = u32(state.posHash + opp - player);
        }

        historyEntry.formedMill = formedMill;
        state.moveHistory.push(historyEntry);

        // 推入位置窗口 + 检查重复 + 检查终局
        pushHash(state.posHash);
        checkRepetition(state.posHash);
        if (!state.millMove && !state.gameOver) checkGameOver();

        return formedMill;
    }

    function checkGameOver() {
        const current = getPlayer(state.currentPlayer);
        const opponent = state.currentPlayer === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;

        // 场上棋子少于3个且手上无棋子，对手获胜
        if (current.piecesOnBoard < 3 && current.piecesOnHand === 0) {
            state.gameOver = true;
            state.winner = opponent;
            return;
        }

        // PLACEMENT（有手牌）：有空位就能放，不会闷死
        // FLYING（3子飞行）：有空位就能飞，不会闷死
        // 只有 MOVE 阶段可能被堵死：所有己方棋子的邻居全被占
        if (getPhase(state.currentPlayer) === PHASE_MOVING) {
            const board = state.board;
            const player = state.currentPlayer;
            let canMove = false;
            for (let i = 0; i < BOARD_SIZE && !canMove; i++) {
                if (board[i] !== player) continue;
                const neighbors = NEIGHBORS[i];
                for (let j = 0; j < neighbors.length; j++) {
                    if (board[neighbors[j]] === EMPTY) { canMove = true; break; }
                }
            }
            if (!canMove) {
                state.gameOver = true;
                state.winner = opponent;
            }
        }
    }

    // ==================== 撤销走法 ====================

    /** 撤销最后一步棋（makeMove 的镜像，供 AI 深度搜索使用） */
    function undoMove() {
        if (state.moveHistory.length === 0) return;

        const entry = state.moveHistory.pop();
        const { player, type, from, to, remove, removedFrom, formedMill } = entry;
        const opp = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(opp);

        // ── 吃子走法的撤销 ──
        if (type === 'remove') {
            popHash();

            if (remove !== null) {
                state.board[remove] = removedFrom || opp;
                state.posHash = u32(state.posHash + opp * pow3[remove]);
                oppP.piecesOnBoard++;
                oppP.piecesLost--;
            }

            state.currentPlayer = player;
            state.posHash = u32(state.posHash + player - opp);
            state.millMove = true;
        } else {
            // ── 普通走法的撤销（place / move / fly）──
            popHash();

            if (type === 'place') {
                state.board[to] = EMPTY;
                state.posHash = u32(state.posHash - player * pow3[to]);
                p.piecesOnHand++;
                p.piecesOnBoard--;
            } else {
                state.board[from] = player;
                state.board[to] = EMPTY;
                state.posHash = u32(state.posHash - player * (pow3[to] - pow3[from]));
            }

            if (!formedMill) {
                state.currentPlayer = player;
                state.posHash = u32(state.posHash + player - opp);
            }
            state.millMove = false;
        }

        // 重置游戏结束状态（AI 搜索不会越过终局）
        state.gameOver = false;
        state.winner = null;
    }

    // ==================== 公开接口 ====================
    return {
        // ── 玩家常量 ──
        EMPTY,              // 0 (空位)
        TYPE_OPPONENT,      // 1 (白棋)
        TYPE_AI,            // 2 (黑棋)
        BOARD_SIZE,         // 24 个位置

        // ── 棋盘拓扑 ──
        NEIGHBORS,          // 每个位置的邻居索引
        MILLS,              // 16 条磨坊线
        POSITION_MILLS,     // 每个位置所属的磨坊线索引

        // ── 游戏阶段 ──
        PHASE_PLACEMENT,    // 'PLACEMENT' — 手上有棋子
        PHASE_MOVING,       // 'MOVING'    — 手中无子，场上 >3 子
        PHASE_FLYING,       // 'FLYING'    — 手中无子，场上 3 子

        // ── 游戏生命周期 ──
        init,               // (config?) 初始化游戏，重置所有状态

        // ── 状态查询 ──
        getState,           // () → state 深拷贝
        getStateView,       // () → state 视图（只读，返回内部引用）
        getBoard,           // () → board 浅拷贝
        isGameOver,         // () → boolean
        getWinner,          // () → TYPE_OPPONENT | TYPE_AI | null
        getPhase,           // (player) → 'PLACEMENT' | 'MOVING' | 'FLYING'
        getRepetitionCount, // () → 当前局面在窗口中的重复次数（只读）

        // ── 序列化 ──
        toFen,              // () → MILL-FEN 字符串
        fromFen,            // (fen) → 恢复局面

        // ── 走法核心 ──
        generateLegalMoves, // (player) → Move[]（含：成磨展开吃子）
        makeMove,           // (move) → boolean: true=成磨，调用者需触发吃子而非切换回合
        undoMove,           // () 撤销最后一步（成磨+吃子需调两次）
        isInMill,           // (board, pos) → boolean（pos 棋子是否在完成的磨坊中）
        wouldFormMill,      // (board, to, player) → boolean（落子是否会形成磨坊）
    };
})();