// ========================================================
// Nine Men's Morris 核心引擎 (Engine) — Bitboard 版
//
// 棋盘表示：两个 24 位无符号整数（own / opp），每个 bit 对应棋盘一个交点。
//   own: AI 棋子位掩码（bit i = 1 → AI 在位置 i）
//   opp: 对手棋子位掩码
//   empty = ~(own | opp) & 0xFFFFFF
//
// 设计演进：
//   v1: 24 元素数组 board[i] ∈ {0,1,2}
//   v2: 三进制编码 hash = Σ board[i] × 3^i（pow3[] 增量更新）
//   v3（当前）: 双二进制位掩码 + 双 Float64Array 环形缓冲区（零 hash 计算）
//
// 职责：游戏规则 + 棋盘状态维护
//   - 走法生成（含成磨展开吃子）
//   - 走法执行 / 撤销（makeMove / undoMove）
//   - 状态查询（阶段、终局、FEN 序列化）
//   - 三次重复检测（双 Float64Array 环形缓冲区）
// 不含：策略评估、AI 搜索、权重计算
// ========================================================

const Engine = (() => {
    // ==================== 常量定义 ====================

    const EMPTY = 0;               // 空位（仅用于兼容常量导出，内部不使用）
    const TYPE_OPPONENT = 1;       // 白棋（玩家）
    const TYPE_AI = 2;             // 黑棋（AI）
    const BOARD_SIZE = 24;         // 棋盘交点数（3 层正方形 × 8 交点）
    const BOARD_MASK = 0xFFFFFF;   // 24 位掩码（用于屏蔽高位垃圾）

    // ==================== 预计算表 ====================
    // 所有表在引擎初始化时一次性计算，运行时只读。
    // 用空间换时间：避免每次检测都做循环或位扫描。

    /**
     * 16 条磨坊线的位掩码。
     * 每条线 3 个位置，对应 24 位掩码中的 3 个 bit 置 1。
     * 前 8 条为横线（每层正方形 2 条 × 3 层 + 中间横条 2 条），
     * 后 8 条为竖线（连接三层正方形的垂直线）。
     *
     * 棋盘位置编号（三层嵌套正方形）：
     *
     *        0 ----- 1 ----- 2          外层
     *        | 3 --- 4 --- 5 |          中层
     *        | | 6 - 7 - 8 | |          内层
     *        9 -10 -11  12 -13 -14      横条
     *        | |15 -16 -17 | |          内层
     *        | 18 --19 --20 |           中层
     *        21 ----22 ----23           外层
     */
    const MILL_MASKS = [
        0b000000000000000000000111, // 0: [0,1,2]     外层上横
        0b000000000000000000111000, // 1: [3,4,5]     中层上横
        0b000000000000000111000000, // 2: [6,7,8]     内层上横
        0b000000000000111000000000, // 3: [9,10,11]   横条左半
        0b000000000111000000000000, // 4: [12,13,14]  横条右半
        0b000000111000000000000000, // 5: [15,16,17]  内层下横
        0b000111000000000000000000, // 6: [18,19,20]  中层下横
        0b111000000000000000000000, // 7: [21,22,23]  外层下横
        (1<<0)|(1<<9)|(1<<21),     // 8: [0,9,21]    左外竖
        (1<<3)|(1<<10)|(1<<18),    // 9: [3,10,18]   左中竖
        (1<<6)|(1<<11)|(1<<15),    // 10:[6,11,15]   左内竖
        (1<<8)|(1<<12)|(1<<17),    // 11:[8,12,17]   右内竖
        (1<<5)|(1<<13)|(1<<20),    // 12:[5,13,20]   右中竖
        (1<<2)|(1<<14)|(1<<23),    // 13:[2,14,23]   右外竖
        (1<<1)|(1<<4)|(1<<7),      // 14:[1,4,7]     上中竖
        (1<<16)|(1<<19)|(1<<22),   // 15:[16,19,22]  下中竖
    ];

    /**
     * 从 MILL_MASKS 反推位置索引。
     * 例：decodeMillPos(0) → [0, 1,2]（MILL_MASKS[0] 的 3 个置位 bit）
     * 仅在初始化时调用 16 次，用于构建 POSITION_MILLS。
     */
    function decodeMillPos(millIdx) {
        const mask = MILL_MASKS[millIdx];
        const pos = [];
        for (let i = 0; i < 24; i++) { if (mask & (1 << i)) pos.push(i); }
        return pos;
    }

    /**
     * 每个位置属于哪两条 mill 线（反向索引）。
     * POSITION_MILLS[pos] = [millIdx1, millIdx2]
     *
     * 每个位置恰好属于 1 条横线 + 1 条竖线（棋盘拓扑性质）。
     * 用于 isInMillBits 和 wouldFormMillBits：只需检查 2 条线，而非遍历全部 16 条。
     */
    const POSITION_MILLS = Array.from({ length: 24 }, () => []);
    for (let i = 0; i < 16; i++) {
        const pos = decodeMillPos(i);
        for (let j = 0; j < 3; j++) POSITION_MILLS[pos[j]].push(i);
    }

    /**
     * 每位置 mill 线去掉自身后的两子掩码。
     * MILL_WITHOUT[pos][k] = millMask & ~(1 << pos)
     *
     * 用于 wouldFormMillBits：检查"如果在 to 落子，另外 2 子是否都是我的"。
     * 直接用 (playerBits & MILL_WITHOUT[to][k]) === MILL_WITHOUT[to][k] 判断，
     * 避免循环遍历 mill 线内的 3 个位置。
     */
    const MILL_WITHOUT = Array.from({ length: 24 }, () => []);
    for (let pos = 0; pos < 24; pos++) {
        const pms = POSITION_MILLS[pos];
        for (let k = 0; k < pms.length; k++) {
            MILL_WITHOUT[pos][k] = MILL_MASKS[pms[k]] & ~(1 << pos);
        }
    }

    /**
     * 24 个位置的邻居位掩码。
     * NEIGHBOR_MASKS[pos] 的每个置位 bit 对应 pos 的一个相邻位置。
     *
     * 邻居数：角位 2 个，边中 3 个，十字中心 4 个（位置 4,10,13,19）。
     * 用于：移动合法性检测、机动性计算、mill 可达性判断。
     *
     * 与旧版 NEIGHBORS 数组的区别：
     *   旧版：NEIGHBORS[pos] = [1, 9]（数组，需循环遍历）
     *   新版：NEIGHBOR_MASKS[pos] = (1<<1)|(1<<9)（位掩码，一次位与出结果）
     */
    const NEIGHBOR_MASKS = [
        (1<<1)|(1<<9),                         // 0: 角位，邻居 1,9
        (1<<0)|(1<<2)|(1<<4),                  // 1: 边中，邻居 0,2,4
        (1<<1)|(1<<14),                        // 2: 角位
        (1<<4)|(1<<10),                        // 3: 中层角位
        (1<<1)|(1<<3)|(1<<5)|(1<<7),           // 4: 十字中心，4 个邻居
        (1<<4)|(1<<13),                        // 5: 中层角位
        (1<<7)|(1<<11),                        // 6: 内层角位
        (1<<4)|(1<<6)|(1<<8),                  // 7: 内层边中
        (1<<7)|(1<<12),                        // 8: 内层角位
        (1<<0)|(1<<10)|(1<<21),                // 9: 左横条
        (1<<3)|(1<<9)|(1<<11)|(1<<18),         // 10: 左十字中心
        (1<<6)|(1<<10)|(1<<15),                // 11: 左内竖中点
        (1<<8)|(1<<13)|(1<<17),                // 12: 右内竖中点
        (1<<5)|(1<<12)|(1<<14)|(1<<20),        // 13: 右十字中心
        (1<<2)|(1<<13)|(1<<23),                // 14: 右横条
        (1<<11)|(1<<16),                       // 15: 内层角位
        (1<<15)|(1<<17)|(1<<19),               // 16: 内层边中
        (1<<12)|(1<<16),                       // 17: 内层角位
        (1<<10)|(1<<19),                       // 18: 中层角位
        (1<<16)|(1<<18)|(1<<20)|(1<<22),       // 19: 下十字中心
        (1<<13)|(1<<19),                       // 20: 中层角位
        (1<<9)|(1<<22),                        // 21: 角位
        (1<<19)|(1<<21)|(1<<23),               // 22: 边中
        (1<<14)|(1<<22),                       // 23: 角位
    ];

    // ==================== 工具函数 ====================

    /** 截断为 32 位无符号整数。仅在 fromFen 校验输入时使用。 */
    function u32(n) { return n >>> 0; }

    /**
     * Count Trailing Zeros — 取最低位的 1 的位置索引。
     *
     * 原理：x & -x 提取最低位 1（只剩一个 bit），Math.clz32 数前导零，
     * 31 - clz = 该 bit 的位置。
     *
     * 例：ctz(0b10110000) = 4（最低位 1 在 bit 4）
     *
     * 核心用途：位扫描遍历。
     *   while (bits) { const pos = ctz(bits); bits &= bits - 1; }
     * 每次取出一个棋子/空位的位置，然后清除该 bit 继续下一个。
     * 比 for(i=0;i<24;i++) 快：只迭代有值的位，跳过所有空位。
     */
    function ctz(x) { return 31 - Math.clz32(x & -x); }

    /**
     * Population Count — 统计二进制中 1 的个数。
     *
     * Brian Kernighan 算法：分治法，3 步将相邻 bit 组的计数合并到更宽的组。
     *   第 1 步：2-bit 组计数（每 2 bit 内 1 的个数）
     *   第 2 步：4-bit 组计数（相邻 2-bit 组相加）
     *   第 3 步：8-bit 组计数 → 乘法累加到最高字节
     *
     * 例：popcount(0b10110100) = 4
     *
     * 用途：统计 mill 线上棋子数、空位数（机动性）、场上棋子数（fromFen）。
     */
    function popcount(x) {
        x = x - ((x >> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
        return ((x + (x >> 4) & 0x0F0F0F0F) * 0x01010101) >> 24;
    }

    // ==================== 游戏阶段 ====================

    const PHASE_PLACEMENT = 'PLACEMENT';  // 手上有棋子，可放到任意空位
    const PHASE_MOVING = 'MOVING';        // 手中无子，场上 >3 子，只能移到相邻空位
    const PHASE_FLYING = 'FLYING';        // 手中无子，场上 =3 子，可飞到任意空位

    // ==================== 三次重复检测 ====================
    // 游戏规则：30 步内同一局面出现 3 次判和。
    //
    // 设计：双 Float64Array 环形缓冲区（32 槽），直接存储 own/opp 原始值。
    //   - 零 hash 计算：makeMove 只需写入 own/opp，无需额外算 hash
    //   - Float64Array 连续内存，不触发 GC，适合深度搜索高频调用
    //   - 48 位状态（own 24 位 + opp 24 位）在 Float64 精度范围内（2^53），零精度损失
    //   - 旧版用三进制 hash（pow3[] 乘法 + u32 截断），有碰撞风险且每步需增量计算

    const POS_WINDOW = 32;                 // 环形缓冲区大小（2 的幂 → 取模用位与）
    const POS_MASK = POS_WINDOW - 1;       // 位掩码：31 = 0b11111

    /** 推入当前 (own, opp) 到环形缓冲区。makeMove 后调用。 */
    function pushState() {
        const idx = state.writeIdx & POS_MASK;
        state.posOwn[idx] = state.own;
        state.posOpp[idx] = state.opp;
        state.writeIdx++;
    }

    /** 弹出最后入窗口的状态。undoMove 后调用。 */
    function popState() {
        state.writeIdx--;
        const idx = state.writeIdx & POS_MASK;
        state.posOwn[idx] = 0;
        state.posOpp[idx] = 0;
    }

    /** 检查三次重复：遍历窗口，当前 (own, opp) 出现 ≥3 次 → 判和。 */
    function checkRepetition() {
        const o = state.own, p = state.opp;
        const bufO = state.posOwn, bufP = state.posOpp;
        let count = 0;
        for (let i = 0; i < POS_WINDOW; i++) {
            if (bufO[i] === o && bufP[i] === p && ++count >= 3) {
                state.gameOver = true;
                state.winner = null;
                return;
            }
        }
    }

    /** 查询当前局面在窗口中的重复次数（只读，供弹幕等交互使用）。 */
    function getRepetitionCount() {
        const o = state.own, p = state.opp;
        const bufO = state.posOwn, bufP = state.posOpp;
        let count = 0;
        for (let i = 0; i < POS_WINDOW; i++) {
            if (bufO[i] === o && bufP[i] === p) count++;
        }
        return count;
    }

    // ==================== 内部状态 ====================
    let state = null;

    /**
     * 创建初始状态。
     * @param {object} config - { firstPlayer, opponentHand, aiHand }
     */
    function createInitialState(config = {}) {
        const {
            firstPlayer = TYPE_OPPONENT,
            opponentHand = 9,
            aiHand = 9
        } = config;

        return {
            own: 0,          // AI 棋子位掩码（初始空棋盘）
            opp: 0,          // 对手棋子位掩码

            currentPlayer: firstPlayer,    // 当前走棋方
            millMove: false,               // 是否处于吃子阶段（刚形成 Mill）

            playerOpponent: {
                piecesOnHand: opponentHand,    // 手持棋子数
                piecesOnBoard: 0,              // 场上棋子数
                piecesLost: 0                  // 被吃棋子数
            },
            playerAI: { piecesOnHand: aiHand, piecesOnBoard: 0, piecesLost: 0 },

            moveHistory: [],       // 走棋历史（undoMove 依赖此栈）
            gameOver: false,
            winner: null,          // TYPE_OPPONENT | TYPE_AI | null（平局）

            // ── 三次重复检测（双缓冲区）──
            posOwn: new Float64Array(POS_WINDOW),  // AI 位掩码历史
            posOpp: new Float64Array(POS_WINDOW),  // 对手位掩码历史
            writeIdx: 0,                            // 写指针（绝对位置，取模定位）
        };
    }

    // ==================== 磨坊检测 ====================

    /**
     * 检查 playerBits 在 pos 是否处于已完成的磨坊中。
     *
     * 原理：pos 属于 2 条 mill 线（POSITION_MILLS[pos]），
     * 如果其中任一条线的 3 个 bit 都在 playerBits 中 → 该棋子在已完成 mill 中。
     *
     * 位运算：(playerBits & MILL_MASKS[millIdx]) === MILL_MASKS[millIdx]
     * 表示"playerBits 包含该 mill 线的所有 3 个位置"。
     *
     * @param {number} playerBits - 该玩家的位掩码（own 或 opp）
     * @param {number} pos - 位置索引（0-23）
     * @returns {boolean}
     */
    function isInMillBits(playerBits, pos) {
        const pms = POSITION_MILLS[pos];
        for (let i = 0; i < pms.length; i++) {
            if ((playerBits & MILL_MASKS[pms[i]]) === MILL_MASKS[pms[i]]) return true;
        }
        return false;
    }

    /**
     * 在空位 to 落子是否会形成磨坊。
     *
     * 原理：检查 to 所在的 2 条 mill 线，看"去掉 to 后的另外 2 子"是否都是 playerBits 的。
     * MILL_WITHOUT[to][k] 就是"该 mill 线去掉 to 位置后的 2-bit 掩码"。
     *
     * 例：to=1，mill 线 [0,1,2]，MILL_WITHOUT[1][0] = (1<<0)|(1<<2) = 0b101
     *   如果 playerBits 包含 bit 0 和 bit 2 → (playerBits & 0b101) === 0b101 → 成 mill
     *
     * @param {number} playerBits - 该玩家的位掩码
     * @param {number} to - 目标位置（应为空位）
     * @returns {boolean}
     */
    function wouldFormMillBits(playerBits, to) {
        const pms = POSITION_MILLS[to];
        for (let i = 0; i < pms.length; i++) {
            if ((playerBits & MILL_WITHOUT[to][i]) === MILL_WITHOUT[to][i]) return true;
        }
        return false;
    }

    // ==================== 核心接口 ====================

    /** 初始化游戏，重置所有状态。 */
    function init(config = {}) {
        state = createInitialState(config);
        pushState();  // 初始局面推入重复检测窗口
    }

    /** 获取当前状态的深拷贝（用于序列化、调试等）。 */
    function getState() {
        return {
            own: state.own, opp: state.opp,
            currentPlayer: state.currentPlayer,
            millMove: state.millMove,
            playerOpponent: { ...state.playerOpponent },
            playerAI: { ...state.playerAI },
            moveHistory: [...state.moveHistory],
            gameOver: state.gameOver, winner: state.winner,
            posOwn: new Float64Array(state.posOwn),
            posOpp: new Float64Array(state.posOpp),
            writeIdx: state.writeIdx,
        };
    }

    /** 获取状态视图（只读，返回内部引用，避免深拷贝开销）。 */
    function getStateView() { return state; }

    /** 轻量查询：游戏是否结束（无深拷贝）。 */
    function isGameOver() { return state.gameOver; }

    /** 轻量查询：获胜方（无深拷贝）。 */
    function getWinner() { return state.winner; }

    /**
     * 获取玩家当前所处阶段。
     * PLACEMENT: 手上有棋子（可放到任意空位）
     * MOVING: 手中无子，场上 >3 子（只能移到相邻空位）
     * FLYING: 手中无子，场上 =3 子（可飞到任意空位）
     */
    function getPhase(player) {
        const p = getPlayer(player);
        if (p.piecesOnHand > 0) return PHASE_PLACEMENT;
        if (p.piecesOnBoard === 3) return PHASE_FLYING;
        return PHASE_MOVING;
    }

    /** 根据玩家类型返回对应的玩家数据对象。 */
    function getPlayer(playerType) {
        return playerType === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
    }

    /** 获取玩家的位掩码。TYPE_AI → own，TYPE_OPPONENT → opp。 */
    function getPlayerBits(player) {
        return player === TYPE_AI ? state.own : state.opp;
    }

    // ==================== MILL-FEN（棋盘快照） ====================

    /**
     * 将当前局面打包为 JSON 字符串。
     *
     * 格式：{"own":<uint24>,"opp":<uint24>,"meta":"0x<hex5>"}
     *   own/opp: 直接存储位掩码（零编解码开销）
     *   meta: 5 位十六进制，从高到低：
     *     对手手牌(4bit) | 对手已失(4bit) | AI手牌(4bit) | AI已失(4bit) | 当前玩家+成磨标志(4bit)
     *
     * 旧版用三进制编码 board = Σ board[i] × 3^i，需要 pow3[] 数组和循环解码。
     * 新版直接存 own/opp 两个整数，fromFen 直接赋值。
     */
    function toFen() {
        const o = state.playerOpponent;
        const a = state.playerAI;
        const meta = (o.piecesOnHand << 16)
            | (o.piecesLost << 12)
            | (a.piecesOnHand << 8)
            | (a.piecesLost << 4)
            | state.currentPlayer | (state.millMove ? 2 : 0);
        return `{"own":${state.own},"opp":${state.opp},"meta":"0x${meta.toString(16).padStart(5, '0')}"}`;
    }

    /**
     * 从快照恢复局面。
     * 校验：own/opp 无重叠、棋子数一致、玩家值合法。
     */
    function fromFen(fen) {
        if (typeof fen !== 'string') throw new Error("Invalid FEN: expected string");
        const obj = JSON.parse(fen);

        if (typeof obj.own === 'number' && typeof obj.opp === 'number') {
            const ownVal = u32(obj.own);
            const oppVal = u32(obj.opp);
            if (ownVal < 0 || oppVal < 0) throw new Error("Invalid FEN: negative own/opp");
            if (ownVal & oppVal) throw new Error("Invalid FEN: own & opp overlap");

            const metaStr = obj.meta;
            if (typeof metaStr !== 'string') throw new Error("Invalid FEN: missing meta");
            const m = parseInt(metaStr, 16);
            if (Number.isNaN(m) || m < 0) throw new Error("Invalid FEN: bad meta");

            const onBoardAI = popcount(ownVal);
            const onBoardOpp = popcount(oppVal);

            const last = m & 0xf;
            if (last > 4) throw new Error("Invalid FEN: bad last");
            const aLost = (m >> 4) & 0xf;
            const aHand = (m >> 8) & 0xf;
            const oLost = (m >> 12) & 0xf;
            const oHand = (m >> 16) & 0xf;
            if (oHand + onBoardOpp + oLost !== 9) throw new Error("Invalid FEN: opponent piece mismatch");
            if (aHand + onBoardAI + aLost !== 9) throw new Error("Invalid FEN: ai piece mismatch");

            const currentPlayer = last <= 2 ? last : last - 2;
            if (currentPlayer !== TYPE_OPPONENT && currentPlayer !== TYPE_AI) throw new Error("Invalid FEN: bad player");
            const millMove = last > 2;

            state = {
                own: ownVal, opp: oppVal,
                currentPlayer,
                playerOpponent: { piecesOnHand: oHand, piecesOnBoard: onBoardOpp, piecesLost: oLost },
                playerAI: { piecesOnHand: aHand, piecesOnBoard: onBoardAI, piecesLost: aLost },
                millMove,
                moveHistory: [],
                gameOver: false, winner: null,
                posOwn: new Float64Array(POS_WINDOW),
                posOpp: new Float64Array(POS_WINDOW),
                writeIdx: 0,
            };
            pushState();
            return;
        }

        throw new Error("Invalid FEN: unsupported format");
    }

    // ==================== 走法生成 ====================

    /**
     * 生成玩家所有合法走法（bitboard 版）。
     *
     * 返回 Move[]，每个 Move 结构：
     *   { player, type, from, to, remove }
     *   - type: 'place' | 'move' | 'fly' | 'remove'
     *   - from: 起点（place/remove 时为 -1）
     *   - to: 终点（remove 时为 -1）
     *   - remove: 被吃棋子位置（null 表示无吃子）
     *
     * 三种情况：
     *   1. 不成磨：type=动作类型, remove=null
     *   2. 成磨需吃子：一个动作展开为 N 条 Move（每条吃一个可吃子）
     *   3. 纯吃子（millMove 阶段）：type='remove', from=-1, to=-1
     *
     * 吃子约束：优先吃不在磨坊中的棋子；若对手全部在磨坊中，可吃任意一子。
     *
     * 位扫描优化：
     *   旧版：for(i=0;i<24;i++) if(board[i]===EMPTY) → 24 次循环
     *   新版：while(emptyBits) { ctz(emptyBits); emptyBits &= emptyBits-1; } → 只迭代空位数
     */
    function generateLegalMoves(player) {
        const moves = [];
        const oppType = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const playerBits = getPlayerBits(player);
        const oppBits = getPlayerBits(oppType);
        const emptyBits = ~(state.own | state.opp) & BOARD_MASK;
        const phase = getPhase(player);

        // ── 吃子阶段：millMove=true 时只能执行吃子走法 ──
        if (state.millMove) {
            // 构建可吃子位掩码：不在 mill 中的对手棋子
            let remBits = 0;
            let bits = oppBits;
            while (bits) {
                const pos = ctz(bits);
                if (!isInMillBits(oppBits, pos)) remBits |= (1 << pos);
                bits &= bits - 1;
            }
            // 如果对手所有棋子都在磨坊中，可吃任意一子
            if (!remBits) remBits = oppBits;

            // 展开为 remove moves
            bits = remBits;
            while (bits) {
                moves.push({ player, type: 'remove', from: -1, to: -1, remove: ctz(bits) });
                bits &= bits - 1;
            }
            return moves;
        }

        // ── 放置阶段：遍历所有空位 ──
        if (phase === PHASE_PLACEMENT) {
            let bits = emptyBits;
            while (bits) {
                const to = ctz(bits);
                moves.push({ player, type: 'place', from: -1, to, remove: null });
                bits &= bits - 1;
            }
        }
        // ── 移动/飞行阶段：遍历己方棋子 → 遍历目标 ──
        else {
            let pieces = playerBits;
            while (pieces) {
                const from = ctz(pieces);
                // MOVING: 只能移到相邻空位；FLYING: 可飞到任意空位
                const targets = phase === PHASE_FLYING
                    ? emptyBits
                    : NEIGHBOR_MASKS[from] & emptyBits;
                let t = targets;
                while (t) {
                    const to = ctz(t);
                    moves.push({
                        player,
                        type: phase === PHASE_FLYING ? 'fly' : 'move',
                        from, to, remove: null
                    });
                    t &= t - 1;
                }
                pieces &= pieces - 1;
            }
        }

        // ── 成磨展开吃子 ──
        // removable 延迟初始化：仅当成磨走法存在时才计算可吃子列表
        const finalMoves = [];
        let removable = null;
        for (let mi = 0; mi < moves.length; mi++) {
            const move = moves[mi];
            if (wouldFormMillBits(playerBits, move.to)) {
                // 首次成磨时计算可吃子列表，后续复用
                if (removable === null) {
                    removable = [];
                    let bits = oppBits;
                    while (bits) {
                        const pos = ctz(bits);
                        if (!isInMillBits(oppBits, pos)) removable.push(pos);
                        bits &= bits - 1;
                    }
                    // 全在 mill 中 → 允许吃任意子
                    if (!removable.length) {
                        bits = oppBits;
                        while (bits) { removable.push(ctz(bits)); bits &= bits - 1; }
                    }
                }
                // 为每个可吃子生成一条独立 Move
                for (let ri = 0; ri < removable.length; ri++) {
                    finalMoves.push({ player, type: move.type, from: move.from, to: move.to, remove: removable[ri] });
                }
            } else {
                finalMoves.push(move);
            }
        }

        // 吃子走法排前面（加速 alpha-beta 剪枝）
        finalMoves.sort((a, b) => (b.remove !== null ? 1 : 0) - (a.remove !== null ? 1 : 0));
        return finalMoves;
    }

    // ==================== 执行走法 ====================

    /**
     * 执行一步棋（bitboard 版）。
     *
     * 位操作说明：
     *   place:  own |= (1 << to)         置位
     *   remove: own &= ~(1 << remove)    清位
     *   move:   own ^= (1<<from)|(1<<to)  翻转两位（from 清零，to 置一）
     *   u32():  确保结果为无符号 32 位（JS 位运算强制有符号，高位可能变负）
     *
     * @returns {boolean} true=形成磨坊，调用者需继续执行吃子而非切换回合
     */
    function makeMove(move) {
        if (!move) return null;
        const { player, from, to, remove, type } = move;
        const oppType = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(oppType);
        const historyEntry = { player, type, from, to, remove, removedFrom: type === 'remove' ? oppType : null, formedMill: false };

        // ── 吃子走法 ──
        if (type === 'remove') {
            if (remove !== null) {
                // 清除被吃棋子的 bit
                if (oppType === TYPE_AI) state.own = u32(state.own & ~(1 << remove));
                else state.opp = u32(state.opp & ~(1 << remove));
                oppP.piecesOnBoard--;
                oppP.piecesLost++;
            }
            state.currentPlayer = oppType;
            state.millMove = false;
            state.moveHistory.push(historyEntry);
            pushState();
            if (!state.gameOver) checkGameOver();
            return false;
        }

        // ── 普通走法（place / move / fly）──
        const formedMill = (() => {
            if (type === 'place') {
                // 置位：在 to 位置放子
                if (player === TYPE_AI) state.own = u32(state.own | (1 << to));
                else state.opp = u32(state.opp | (1 << to));
                p.piecesOnHand--;
                p.piecesOnBoard++;
            } else {
                // 翻转两位：from 清零 + to 置一（一条 XOR 指令完成）
                if (player === TYPE_AI) state.own = u32(state.own ^ ((1 << from) | (1 << to)));
                else state.opp = u32(state.opp ^ ((1 << from) | (1 << to)));
            }
            // 检查落子后是否成 mill
            return isInMillBits(player === TYPE_AI ? state.own : state.opp, to);
        })();

        if (formedMill) {
            state.millMove = true;  // 成 mill → 进入吃子阶段，不切换玩家
        } else {
            state.currentPlayer = oppType;
        }

        historyEntry.formedMill = formedMill;
        state.moveHistory.push(historyEntry);

        // 推入重复检测窗口 + 检查重复 + 检查终局
        pushState();
        checkRepetition();
        if (!state.millMove && !state.gameOver) checkGameOver();

        return formedMill;
    }

    /**
     * 检查游戏是否结束。
     * 两种情况：
     *   1. 棋子 <3 且无手牌 → 对手获胜
     *   2. MOVING 阶段所有己方棋子被堵死 → 对手获胜
     */
    function checkGameOver() {
        const current = getPlayer(state.currentPlayer);
        const opponent = state.currentPlayer === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        if (current.piecesOnBoard < 3 && current.piecesOnHand === 0) {
            state.gameOver = true;
            state.winner = opponent;
            return;
        }
        // MOVING 阶段：检查是否有棋子能移动到相邻空位
        if (getPhase(state.currentPlayer) === PHASE_MOVING) {
            const playerBits = getPlayerBits(state.currentPlayer);
            const emptyBits = ~(state.own | state.opp) & BOARD_MASK;
            let canMove = false;
            let bits = playerBits;
            while (bits && !canMove) {
                // 该棋子的邻居中是否有空位？
                if (NEIGHBOR_MASKS[ctz(bits)] & emptyBits) canMove = true;
                bits &= bits - 1;
            }
            if (!canMove) { state.gameOver = true; state.winner = opponent; }
        }
    }

    // ==================== 撤销走法 ====================

    /**
     * 撤销最后一步棋（makeMove 的镜像）。
     * 供 AI 深度搜索使用：搜索树每层 makeMove → 递归 → undoMove。
     *
     * 位操作说明：
     *   undo place:  own &= ~(1 << to)         清位（与 make place 相反）
     *   undo move:   own ^= (1<<from)|(1<<to)   翻转两位（与 make move 相同，XOR 自逆）
     *   undo remove: own |= (1 << remove)       置位（与 make remove 相反）
     */
    function undoMove() {
        if (state.moveHistory.length === 0) return;
        const entry = state.moveHistory.pop();
        const { player, type, from, to, remove, removedFrom, formedMill } = entry;
        const oppType = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(oppType);

        if (type === 'remove') {
            popState();  // 弹出重复检测窗口
            if (remove !== null) {
                // 恢复被吃棋子：置位
                if (oppType === TYPE_AI) state.own = u32(state.own | (1 << remove));
                else state.opp = u32(state.opp | (1 << remove));
                oppP.piecesOnBoard++;
                oppP.piecesLost--;
            }
            state.currentPlayer = player;
            state.millMove = true;  // 恢复到吃子前的状态
        } else {
            popState();
            if (type === 'place') {
                // 撤销放置：清位
                if (player === TYPE_AI) state.own = u32(state.own & ~(1 << to));
                else state.opp = u32(state.opp & ~(1 << to));
                p.piecesOnHand++;
                p.piecesOnBoard--;
            } else {
                // 撤销移动：翻转两位（XOR 自逆）
                if (player === TYPE_AI) state.own = u32(state.own ^ ((1 << from) | (1 << to)));
                else state.opp = u32(state.opp ^ ((1 << from) | (1 << to)));
            }
            if (!formedMill) state.currentPlayer = player;
            state.millMove = false;
        }
        state.gameOver = false;
        state.winner = null;
    }

    // ==================== 公开接口 ====================
    return {
        // ── 玩家常量 ──
        EMPTY,              // 0（空位）
        TYPE_OPPONENT,      // 1（白棋/玩家）
        TYPE_AI,            // 2（黑棋/AI）
        BOARD_SIZE,         // 24

        // ── 预计算掩码表 ──
        MILL_MASKS,         // 16 条 mill 线的 24 位掩码
        NEIGHBOR_MASKS,     // 24 个位置的邻居位掩码
        MILL_WITHOUT,       // 每位置 mill 线去掉自身后的 2 子掩码
        POSITION_MILLS,     // 每个位置属于哪 2 条 mill 线（反向索引）

        // ── 游戏阶段 ──
        PHASE_PLACEMENT,    // 'PLACEMENT' — 手上有棋子
        PHASE_MOVING,       // 'MOVING'    — 手中无子，场上 >3 子
        PHASE_FLYING,       // 'FLYING'    — 手中无子，场上 3 子

        // ── 游戏生命周期 ──
        init,               // (config?) 初始化游戏，重置所有状态

        // ── 状态查询 ──
        getState,           // () → state 深拷贝
        getStateView,       // () → state 视图（只读，返回内部引用）
        isGameOver,         // () → boolean
        getWinner,          // () → TYPE_OPPONENT | TYPE_AI | null
        getPhase,           // (player) → 'PLACEMENT' | 'MOVING' | 'FLYING'
        getRepetitionCount, // () → 当前局面在窗口中的重复次数

        // ── Bitboard 查询 ──
        getOwn: () => state.own,            // AI 位掩码
        getOpp: () => state.opp,            // 对手位掩码
        getEmptyBits: () => ~(state.own | state.opp) & BOARD_MASK,  // 空位掩码
        getPlayerBits,      // (player) → own 或 opp

        // ── 序列化 ──
        toFen,              // () → MILL-FEN JSON 字符串
        fromFen,            // (fen) → 恢复局面

        // ── 走法核心 ──
        generateLegalMoves, // (player) → Move[]（含：成磨展开吃子）
        makeMove,           // (move) → boolean: true=成磨，需继续吃子
        undoMove,           // () 撤销最后一步（成磨+吃子需调两次）

        // ── 位运算工具（供 evaluator 使用）──
        ctz,                // (x) → 最低位 1 的位置索引
        popcount,           // (x) → 1 的个数
        u32,                // (n) → 无符号 32 位
    };
})();
