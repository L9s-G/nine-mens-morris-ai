// ========================================================
// Nine Men's Morris 核心引擎 (Engine) — Bitboard 版
// 职责：游戏规则 + 棋盘状态维护
//   - 双二进制棋盘（own/opp 位掩码）
//   - 走法生成（含成磨展开吃子）
//   - 走法执行 / 撤销（makeMove / undoMove）
//   - 状态查询（阶段、终局、FEN 序列化）
//   - 三次重复检测（双 Float64Array 环形缓冲区，零 hash 计算）
// 不含：策略评估、AI 搜索、权重计算
// ========================================================

const Engine = (() => {
    // ==================== 常量定义 ====================
    const EMPTY = 0;
    const TYPE_OPPONENT = 1;
    const TYPE_AI = 2;
    const BOARD_SIZE = 24;
    const BOARD_MASK = 0xFFFFFF;

    // ==================== 预计算表 ====================

    // 16 条 mill 线的位掩码
    const MILL_MASKS = [
        0b000000000000000000000111, // 0: [0,1,2]
        0b000000000000000000111000, // 1: [3,4,5]
        0b000000000000000111000000, // 2: [6,7,8]
        0b000000000000111000000000, // 3: [9,10,11]
        0b000000000111000000000000, // 4: [12,13,14]
        0b000000111000000000000000, // 5: [15,16,17]
        0b000111000000000000000000, // 6: [18,19,20]
        0b111000000000000000000000, // 7: [21,22,23]
        (1<<0)|(1<<9)|(1<<21),     // 8: [0,9,21]
        (1<<3)|(1<<10)|(1<<18),    // 9: [3,10,18]
        (1<<6)|(1<<11)|(1<<15),    // 10: [6,11,15]
        (1<<8)|(1<<12)|(1<<17),    // 11: [8,12,17]
        (1<<5)|(1<<13)|(1<<20),    // 12: [5,13,20]
        (1<<2)|(1<<14)|(1<<23),    // 13: [2,14,23]
        (1<<1)|(1<<4)|(1<<7),      // 14: [1,4,7]
        (1<<16)|(1<<19)|(1<<22),   // 15: [16,19,22]
    ];

    // 从 MILL_MASKS 反推位置
    function decodeMillPos(millIdx) {
        const mask = MILL_MASKS[millIdx];
        const pos = [];
        for (let i = 0; i < 24; i++) { if (mask & (1 << i)) pos.push(i); }
        return pos;
    }

    // 每个位置属于哪两条 mill 线（内部使用）
    const POSITION_MILLS = Array.from({ length: 24 }, () => []);
    for (let i = 0; i < 16; i++) {
        const pos = decodeMillPos(i);
        for (let j = 0; j < 3; j++) POSITION_MILLS[pos[j]].push(i);
    }

    // 每位置 mill 线去掉自身后的两子掩码
    const MILL_WITHOUT = Array.from({ length: 24 }, () => []);
    for (let pos = 0; pos < 24; pos++) {
        const pms = POSITION_MILLS[pos];
        for (let k = 0; k < pms.length; k++) {
            MILL_WITHOUT[pos][k] = MILL_MASKS[pms[k]] & ~(1 << pos);
        }
    }

    // 24 个位置的邻居位掩码
    const NEIGHBOR_MASKS = [
        (1<<1)|(1<<9),                         // 0
        (1<<0)|(1<<2)|(1<<4),                  // 1
        (1<<1)|(1<<14),                        // 2
        (1<<4)|(1<<10),                        // 3
        (1<<1)|(1<<3)|(1<<5)|(1<<7),           // 4
        (1<<4)|(1<<13),                        // 5
        (1<<7)|(1<<11),                        // 6
        (1<<4)|(1<<6)|(1<<8),                  // 7
        (1<<7)|(1<<12),                        // 8
        (1<<0)|(1<<10)|(1<<21),                // 9
        (1<<3)|(1<<9)|(1<<11)|(1<<18),         // 10
        (1<<6)|(1<<10)|(1<<15),                // 11
        (1<<8)|(1<<13)|(1<<17),                // 12
        (1<<5)|(1<<12)|(1<<14)|(1<<20),        // 13
        (1<<2)|(1<<13)|(1<<23),                // 14
        (1<<11)|(1<<16),                       // 15
        (1<<15)|(1<<17)|(1<<19),               // 16
        (1<<12)|(1<<16),                       // 17
        (1<<10)|(1<<19),                       // 18
        (1<<16)|(1<<18)|(1<<20)|(1<<22),       // 19
        (1<<13)|(1<<19),                       // 20
        (1<<9)|(1<<22),                        // 21
        (1<<19)|(1<<21)|(1<<23),               // 22
        (1<<14)|(1<<22),                       // 23
    ];

    // ==================== 工具函数 ====================

    function u32(n) { return n >>> 0; }
    function ctz(x) { return 31 - Math.clz32(x & -x); }
    function popcount(x) {
        x = x - ((x >> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
        return ((x + (x >> 4) & 0x0F0F0F0F) * 0x01010101) >> 24;
    }

    const PHASE_PLACEMENT = 'PLACEMENT';
    const PHASE_MOVING = 'MOVING';
    const PHASE_FLYING = 'FLYING';

    // ==================== 三次重复检测 ====================
    const POS_WINDOW = 32;
    const POS_MASK = POS_WINDOW - 1;

    function pushState() {
        const idx = state.writeIdx & POS_MASK;
        state.posOwn[idx] = state.own;
        state.posOpp[idx] = state.opp;
        state.writeIdx++;
    }

    function popState() {
        state.writeIdx--;
        const idx = state.writeIdx & POS_MASK;
        state.posOwn[idx] = 0;
        state.posOpp[idx] = 0;
    }

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

    function createInitialState(config = {}) {
        const {
            firstPlayer = TYPE_OPPONENT,
            opponentHand = 9,
            aiHand = 9
        } = config;

        return {
            own: 0,
            opp: 0,
            currentPlayer: firstPlayer,
            millMove: false,
            playerOpponent: { piecesOnHand: opponentHand, piecesOnBoard: 0, piecesLost: 0 },
            playerAI: { piecesOnHand: aiHand, piecesOnBoard: 0, piecesLost: 0 },
            moveHistory: [],
            gameOver: false,
            winner: null,
            posOwn: new Float64Array(POS_WINDOW),
            posOpp: new Float64Array(POS_WINDOW),
            writeIdx: 0,
        };
    }

    // ==================== 磨坊检测 ====================

    function isInMillBits(playerBits, pos) {
        const pms = POSITION_MILLS[pos];
        for (let i = 0; i < pms.length; i++) {
            if ((playerBits & MILL_MASKS[pms[i]]) === MILL_MASKS[pms[i]]) return true;
        }
        return false;
    }

    function wouldFormMillBits(playerBits, to) {
        const pms = POSITION_MILLS[to];
        for (let i = 0; i < pms.length; i++) {
            if ((playerBits & MILL_WITHOUT[to][i]) === MILL_WITHOUT[to][i]) return true;
        }
        return false;
    }

    // ==================== 核心接口 ====================

    function init(config = {}) {
        state = createInitialState(config);
        pushState();
    }

    function getState() {
        return {
            own: state.own,
            opp: state.opp,
            currentPlayer: state.currentPlayer,
            millMove: state.millMove,
            playerOpponent: { ...state.playerOpponent },
            playerAI: { ...state.playerAI },
            moveHistory: [...state.moveHistory],
            gameOver: state.gameOver,
            winner: state.winner,
            posOwn: new Float64Array(state.posOwn),
            posOpp: new Float64Array(state.posOpp),
            writeIdx: state.writeIdx,
        };
    }

    function getStateView() { return state; }
    function isGameOver() { return state.gameOver; }
    function getWinner() { return state.winner; }

    function getPhase(player) {
        const p = getPlayer(player);
        if (p.piecesOnHand > 0) return PHASE_PLACEMENT;
        if (p.piecesOnBoard === 3) return PHASE_FLYING;
        return PHASE_MOVING;
    }

    function getPlayer(playerType) {
        return playerType === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
    }

    function getPlayerBits(player) {
        return player === TYPE_AI ? state.own : state.opp;
    }

    // ==================== MILL-FEN ====================

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

    function generateLegalMoves(player) {
        const moves = [];
        const oppType = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const playerBits = getPlayerBits(player);
        const oppBits = getPlayerBits(oppType);
        const emptyBits = ~(state.own | state.opp) & BOARD_MASK;
        const phase = getPhase(player);

        // 吃子阶段
        if (state.millMove) {
            let remBits = 0;
            let bits = oppBits;
            while (bits) {
                const pos = ctz(bits);
                if (!isInMillBits(oppBits, pos)) remBits |= (1 << pos);
                bits &= bits - 1;
            }
            if (!remBits) remBits = oppBits;
            bits = remBits;
            while (bits) {
                moves.push({ player, type: 'remove', from: -1, to: -1, remove: ctz(bits) });
                bits &= bits - 1;
            }
            return moves;
        }

        // 放置阶段
        if (phase === PHASE_PLACEMENT) {
            let bits = emptyBits;
            while (bits) {
                const to = ctz(bits);
                moves.push({ player, type: 'place', from: -1, to, remove: null });
                bits &= bits - 1;
            }
        }
        // 移动/飞行阶段
        else {
            let pieces = playerBits;
            while (pieces) {
                const from = ctz(pieces);
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

        // 成磨展开吃子
        const finalMoves = [];
        let removable = null;
        for (let mi = 0; mi < moves.length; mi++) {
            const move = moves[mi];
            if (wouldFormMillBits(playerBits, move.to)) {
                if (removable === null) {
                    removable = [];
                    let bits = oppBits;
                    while (bits) {
                        const pos = ctz(bits);
                        if (!isInMillBits(oppBits, pos)) removable.push(pos);
                        bits &= bits - 1;
                    }
                    if (!removable.length) {
                        bits = oppBits;
                        while (bits) { removable.push(ctz(bits)); bits &= bits - 1; }
                    }
                }
                for (let ri = 0; ri < removable.length; ri++) {
                    finalMoves.push({ player, type: move.type, from: move.from, to: move.to, remove: removable[ri] });
                }
            } else {
                finalMoves.push(move);
            }
        }
        finalMoves.sort((a, b) => (b.remove !== null ? 1 : 0) - (a.remove !== null ? 1 : 0));
        return finalMoves;
    }

    // ==================== 执行走法 ====================

    function makeMove(move) {
        if (!move) return null;
        const { player, from, to, remove, type } = move;
        const oppType = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(oppType);
        const historyEntry = { player, type, from, to, remove, removedFrom: type === 'remove' ? oppType : null, formedMill: false };

        if (type === 'remove') {
            if (remove !== null) {
                if (oppType === TYPE_AI) { state.own &= ~(1 << remove); state.own >>>= 0; }
                else { state.opp &= ~(1 << remove); state.opp >>>= 0; }
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

        const formedMill = (() => {
            if (type === 'place') {
                if (player === TYPE_AI) { state.own |= (1 << to); state.own >>>= 0; }
                else { state.opp |= (1 << to); state.opp >>>= 0; }
                p.piecesOnHand--;
                p.piecesOnBoard++;
            } else {
                if (player === TYPE_AI) { state.own ^= (1 << from) | (1 << to); state.own >>>= 0; }
                else { state.opp ^= (1 << from) | (1 << to); state.opp >>>= 0; }
            }
            return isInMillBits(player === TYPE_AI ? state.own : state.opp, to);
        })();

        if (formedMill) state.millMove = true;
        else state.currentPlayer = oppType;

        historyEntry.formedMill = formedMill;
        state.moveHistory.push(historyEntry);
        pushState();
        checkRepetition();
        if (!state.millMove && !state.gameOver) checkGameOver();
        return formedMill;
    }

    function checkGameOver() {
        const current = getPlayer(state.currentPlayer);
        const opponent = state.currentPlayer === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        if (current.piecesOnBoard < 3 && current.piecesOnHand === 0) {
            state.gameOver = true;
            state.winner = opponent;
            return;
        }
        if (getPhase(state.currentPlayer) === PHASE_MOVING) {
            const playerBits = getPlayerBits(state.currentPlayer);
            const emptyBits = ~(state.own | state.opp) & BOARD_MASK;
            let canMove = false;
            let bits = playerBits;
            while (bits && !canMove) {
                if (NEIGHBOR_MASKS[ctz(bits)] & emptyBits) canMove = true;
                bits &= bits - 1;
            }
            if (!canMove) { state.gameOver = true; state.winner = opponent; }
        }
    }

    // ==================== 撤销走法 ====================

    function undoMove() {
        if (state.moveHistory.length === 0) return;
        const entry = state.moveHistory.pop();
        const { player, type, from, to, remove, removedFrom, formedMill } = entry;
        const oppType = player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        const p = getPlayer(player);
        const oppP = getPlayer(oppType);

        if (type === 'remove') {
            popState();
            if (remove !== null) {
                if (oppType === TYPE_AI) { state.own |= (1 << remove); state.own >>>= 0; }
                else { state.opp |= (1 << remove); state.opp >>>= 0; }
                oppP.piecesOnBoard++;
                oppP.piecesLost--;
            }
            state.currentPlayer = player;
            state.millMove = true;
        } else {
            popState();
            if (type === 'place') {
                if (player === TYPE_AI) { state.own &= ~(1 << to); state.own >>>= 0; }
                else { state.opp &= ~(1 << to); state.opp >>>= 0; }
                p.piecesOnHand++;
                p.piecesOnBoard--;
            } else {
                if (player === TYPE_AI) { state.own ^= (1 << from) | (1 << to); state.own >>>= 0; }
                else { state.opp ^= (1 << from) | (1 << to); state.opp >>>= 0; }
            }
            if (!formedMill) state.currentPlayer = player;
            state.millMove = false;
        }
        state.gameOver = false;
        state.winner = null;
    }

    // ==================== 公开接口 ====================
    return {
        EMPTY, TYPE_OPPONENT, TYPE_AI, BOARD_SIZE,
        MILL_MASKS, NEIGHBOR_MASKS, MILL_WITHOUT, POSITION_MILLS,
        PHASE_PLACEMENT, PHASE_MOVING, PHASE_FLYING,
        init,
        getState, getStateView, isGameOver, getWinner, getPhase, getRepetitionCount,
        getOwn: () => state.own,
        getOpp: () => state.opp,
        getEmptyBits: () => ~(state.own | state.opp) & BOARD_MASK,
        getPlayerBits,
        toFen, fromFen,
        generateLegalMoves, makeMove, undoMove,
        ctz, popcount, u32,
    };
})();
