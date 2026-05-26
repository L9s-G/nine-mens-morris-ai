// ========================================================
// Nine Men's Morris 搜索引擎 Web Worker
// 职责：在独立线程中执行 AI 搜索，避免阻塞主线程
// ========================================================

// Worker 内部需要包含 Engine、Evaluator、Searcher 的代码
// 由于 Worker 无法访问主线程的全局变量，需要重新定义这些模块

// ==================== Engine (Worker 版本) ====================
const Engine = (() => {
    const TYPE_OPPONENT = 1;
    const TYPE_AI = 2;
    const BOARD_SIZE = 24;

    const NEIGHBORS = [
        [1, 9], [0, 2, 4], [1, 14], [4, 10], [1, 3, 5, 7], [4, 13],
        [7, 11], [4, 6, 8], [7, 12], [0, 10, 21], [3, 9, 11, 18],
        [6, 10, 15], [8, 13, 17], [5, 12, 14, 20], [2, 13, 23],
        [11, 16], [15, 17, 19], [12, 16], [10, 19], [16, 18, 20, 22],
        [13, 19], [9, 22], [19, 21, 23], [14, 22]
    ];

    const MILLS = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14],
        [15, 16, 17], [18, 19, 20], [21, 22, 23], [0, 9, 21], [3, 10, 18],
        [6, 11, 15], [8, 12, 17], [5, 13, 20], [2, 14, 23], [1, 4, 7],
        [16, 19, 22]
    ];

    const POSITION_MILLS = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
        POSITION_MILLS[i] = [];
        for (let j = 0; j < MILLS.length; j++) {
            if (MILLS[j].includes(i)) POSITION_MILLS[i].push(j);
        }
    }

    let state = null;
    const history = [];

    function getStateView() {
        return state;
    }

    function getPhase(player) {
        const p = player === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
        if (p.piecesOnHand > 0) return 'PLACEMENT';
        if (p.piecesOnBoard <= 3) return 'FLYING';
        return 'MOVING';
    }

    function isGameOver() {
        const opponent = state.playerOpponent;
        const ai = state.playerAI;
        if (opponent.piecesOnBoard < 3 && opponent.piecesOnHand === 0) return true;
        if (ai.piecesOnBoard < 3 && ai.piecesOnHand === 0) return true;
        if (state.currentPlayer === TYPE_OPPONENT && generateLegalMoves(TYPE_OPPONENT).length === 0) return true;
        if (state.currentPlayer === TYPE_AI && generateLegalMoves(TYPE_AI).length === 0) return true;
        return false;
    }

    function getWinner() {
        const opponent = state.playerOpponent;
        const ai = state.playerAI;
        if (opponent.piecesOnBoard < 3 && opponent.piecesOnHand === 0) return TYPE_AI;
        if (ai.piecesOnBoard < 3 && ai.piecesOnHand === 0) return TYPE_OPPONENT;
        if (state.currentPlayer === TYPE_OPPONENT && generateLegalMoves(TYPE_OPPONENT).length === 0) return TYPE_AI;
        if (state.currentPlayer === TYPE_AI && generateLegalMoves(TYPE_AI).length === 0) return TYPE_OPPONENT;
        return null;
    }

    function isInMill(pos, player) {
        const posMills = POSITION_MILLS[pos];
        for (let i = 0; i < posMills.length; i++) {
            const mill = MILLS[posMills[i]];
            if (state.board[mill[0]] === player && state.board[mill[1]] === player && state.board[mill[2]] === player) {
                return true;
            }
        }
        return false;
    }

    function canRemove(board, remover, target) {
        const oppPieces = [];
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (board[i] === target) oppPieces.push(i);
        }
        const notInMill = oppPieces.filter(p => !isInMill(p, target));
        if (notInMill.length > 0) return notInMill;
        return oppPieces;
    }

    function generateLegalMoves(player) {
        const moves = [];
        const p = player === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
        const phase = getPhase(player);

        if (state.millMove && state.currentPlayer === player) {
            const targets = canRemove(state.board, player, player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT);
            for (const t of targets) {
                moves.push({ type: 'remove', player, remove: t });
            }
            return moves;
        }

        if (phase === 'PLACEMENT') {
            for (let i = 0; i < BOARD_SIZE; i++) {
                if (state.board[i] === null) {
                    const move = { type: 'place', player, to: i };
                    const formedMill = makeMove(move);
                    if (formedMill) {
                        const captures = canRemove(state.board, player, player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT);
                        for (const c of captures) {
                            moves.push({ type: 'place', player, to: i, remove: c });
                        }
                    } else {
                        moves.push(move);
                    }
                    undoMove();
                }
            }
        } else if (phase === 'MOVING') {
            for (let i = 0; i < BOARD_SIZE; i++) {
                if (state.board[i] === player) {
                    for (const n of NEIGHBORS[i]) {
                        if (state.board[n] === null) {
                            const move = { type: 'move', player, from: i, to: n };
                            const formedMill = makeMove(move);
                            if (formedMill) {
                                const captures = canRemove(state.board, player, player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT);
                                for (const c of captures) {
                                    moves.push({ type: 'move', player, from: i, to: n, remove: c });
                                }
                            } else {
                                moves.push(move);
                            }
                            undoMove();
                        }
                    }
                }
            }
        } else if (phase === 'FLYING') {
            for (let i = 0; i < BOARD_SIZE; i++) {
                if (state.board[i] === player) {
                    for (let j = 0; j < BOARD_SIZE; j++) {
                        if (state.board[j] === null) {
                            const move = { type: 'fly', player, from: i, to: j };
                            const formedMill = makeMove(move);
                            if (formedMill) {
                                const captures = canRemove(state.board, player, player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT);
                                for (const c of captures) {
                                    moves.push({ type: 'fly', player, from: i, to: j, remove: c });
                                }
                            } else {
                                moves.push(move);
                            }
                            undoMove();
                        }
                    }
                }
            }
        }

        return moves;
    }

    function makeMove(move) {
        history.push(JSON.parse(JSON.stringify(state)));

        if (move.type === 'place') {
            state.board[move.to] = move.player;
            const p = move.player === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
            p.piecesOnHand--;
            p.piecesOnBoard++;
        } else if (move.type === 'move' || move.type === 'fly') {
            state.board[move.from] = null;
            state.board[move.to] = move.player;
        }

        if (move.remove != null) {
            const target = move.player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
            state.board[move.remove] = null;
            const tp = target === TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
            tp.piecesOnBoard--;
            tp.piecesLost++;
            state.millMove = false;
            state.currentPlayer = move.player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
        } else {
            const formedMill = isInMill(move.to, move.player);
            if (formedMill) {
                state.millMove = true;
                state.currentPlayer = move.player;
            } else {
                state.millMove = false;
                state.currentPlayer = move.player === TYPE_OPPONENT ? TYPE_AI : TYPE_OPPONENT;
            }
        }

        return state.millMove && state.currentPlayer === move.player;
    }

    function undoMove() {
        if (history.length > 0) {
            state = history.pop();
        }
    }

    function fromFen(fen) {
        const parts = fen.split('/');
        if (parts.length !== 5) throw new Error("Invalid MILL-FEN");

        const board = new Array(BOARD_SIZE);
        for (let i = 0; i < BOARD_SIZE; i++) {
            const ch = parts[0][i];
            board[i] = ch === '0' ? null : Number(ch);
        }

        const currentPlayer = Number(parts[1]);
        const opponent = {
            piecesOnHand: Number(parts[2][0]),
            piecesOnBoard: Number(parts[2][1]),
            piecesLost: Number(parts[2][2])
        };
        const ai = {
            piecesOnHand: Number(parts[3][0]),
            piecesOnBoard: Number(parts[3][1]),
            piecesLost: Number(parts[3][2])
        };
        const millMove = parts[4] === '1';

        state = { board, currentPlayer, playerOpponent: opponent, playerAI: ai, millMove };
        return state;
    }

    return {
        TYPE_OPPONENT, TYPE_AI, BOARD_SIZE, NEIGHBORS, MILLS, POSITION_MILLS,
        getStateView, getPhase, isGameOver, getWinner, isInMill,
        generateLegalMoves, makeMove, undoMove, fromFen
    };
})();

// ==================== Evaluator (Worker 版本) ====================
const Evaluator = (() => {
    const E = Engine;

    const SCORE_WIN = 100000;
    const SCORE_LOSE = -100000;

    function evaluate(depth, ctx) {
        if (E.isGameOver()) {
            const winner = E.getWinner();
            if (winner === E.TYPE_AI) return SCORE_WIN + depth;
            if (winner === E.TYPE_OPPONENT) return SCORE_LOSE - depth;
            return 0;
        }

        const board = E.getStateView().board;
        const aiPieces = board.filter(p => p === E.TYPE_AI).length;
        const oppPieces = board.filter(p => p === E.TYPE_OPPONENT).length;

        return (aiPieces - oppPieces) * 100;
    }

    return { evaluate, SCORE_WIN, SCORE_LOSE };
})();

// ==================== Searcher (Worker 版本) ====================
const Searcher = (() => {
    const E = Engine;
    const EV = Evaluator;

    const DEFAULT_TIME_LIMIT = 5000;

    let nodeCount = 0;
    let startTime = 0;
    let timeLimit = DEFAULT_TIME_LIMIT;
    let timedOut = false;

    function minimax(depth, alpha, beta, isMax, ctx) {
        nodeCount++;

        if ((nodeCount & 1023) === 0 && Date.now() - startTime > timeLimit) {
            timedOut = true;
        }

        if (timedOut || E.isGameOver() || depth <= 0) {
            return EV.evaluate(depth, ctx);
        }

        const player = isMax ? E.TYPE_AI : E.TYPE_OPPONENT;
        const moves = E.generateLegalMoves(player);

        if (moves.length === 0) {
            return isMax ? EV.SCORE_LOSE : EV.SCORE_WIN;
        }

        if (isMax) {
            let best = -Infinity;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                const formedMill = E.makeMove(move);
                const nextCtx = { player, move, formedMill };
                const val = formedMill
                    ? minimax(depth, alpha, beta, true, nextCtx)
                    : minimax(depth - 1, alpha, beta, false, nextCtx);
                E.undoMove();
                if (val > best) best = val;
                if (val > alpha) alpha = val;
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                const formedMill = E.makeMove(move);
                const nextCtx = { player, move, formedMill };
                const val = formedMill
                    ? minimax(depth, alpha, beta, false, nextCtx)
                    : minimax(depth - 1, alpha, beta, true, nextCtx);
                E.undoMove();
                if (val < best) best = val;
                if (val < beta) beta = val;
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    function search(player, maxDepth, timeLimitMs) {
        timeLimit = timeLimitMs || DEFAULT_TIME_LIMIT;
        nodeCount = 0;
        timedOut = false;
        startTime = Date.now();

        const isAI = (player === E.TYPE_AI);
        const moves = E.generateLegalMoves(player);

        if (moves.length === 0) return null;

        let completedDepth = 0;
        let bestScores = [];

        for (let d = 1; d <= maxDepth; d++) {
            if (Date.now() - startTime > timeLimit) break;
            timedOut = false;

            const results = [];
            for (let i = 0; i < moves.length; i++) {
                if (timedOut) break;

                const move = bestScores.length > 0 ? bestScores[i].move : moves[i];
                const formedMill = E.makeMove(move);
                const ctx = { player, move, formedMill };
                const nextIsMax = formedMill ? isAI : !isAI;
                const nextDepth = formedMill ? d : d - 1;
                let score = minimax(nextDepth, -Infinity, Infinity, nextIsMax, ctx);
                if (!isAI) score = -score;
                E.undoMove();

                if (timedOut) break;
                results.push({ move, score });
            }

            if (!timedOut && results.length === moves.length) {
                completedDepth = d;
                results.sort((a, b) => b.score - a.score);
                for (let j = 0; j < results.length;) {
                    let k = j + 1;
                    while (k < results.length && results[k].score === results[j].score) k++;
                    for (let m = k - 1; m > j; m--) {
                        const n = j + Math.floor(Math.random() * (m - j + 1));
                        const tmp = results[m]; results[m] = results[n]; results[n] = tmp;
                    }
                    j = k;
                }
                bestScores = results;
            } else {
                break;
            }
        }

        const elapsed = Date.now() - startTime;

        return {
            ranked: bestScores,
            stats: {
                depth: completedDepth,
                targetDepth: maxDepth,
                nodeCount,
                elapsed,
                nodesPerMs: elapsed > 0 ? Math.round(nodeCount / elapsed) : 0,
                timedOut
            }
        };
    }

    return { search };
})();

// ==================== Worker 消息处理 ====================

self.onmessage = function (e) {
    const { fen, player, depth, timeLimit } = e.data;

    try {
        // 从 FEN 恢复棋盘状态
        Engine.fromFen(fen);

        // 执行搜索
        const result = Searcher.search(player, depth, timeLimit);

        // 返回结果
        self.postMessage({ success: true, result });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
