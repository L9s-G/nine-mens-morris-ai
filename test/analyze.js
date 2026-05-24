// ========================================================
// Nine Men's Morris AI 对战分析脚本 v2
// 用法: node analyze.js [battle_logs_dir]
// ========================================================

const fs = require('fs');
const path = require('path');

const MILLS = [
    [0,1,2],[3,4,5],[6,7,8],[9,10,11],[12,13,14],[15,16,17],[18,19,20],[21,22,23],
    [0,9,21],[3,10,18],[6,11,15],[8,12,17],[5,13,20],[2,14,23],[1,4,7],[16,19,22]
];

// ==================== 工具函数 ====================

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.95)];
}
function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) + '%' : '-'; }
function pad(s, w) { return String(s).padStart(w); }
function rpad(s, w) { return String(s).padEnd(w); }

function getPhase(white, black) {
    const maxHand = Math.max(white.hand, black.hand);
    if (maxHand > 0) return 'PLACEMENT';
    const minBoard = Math.min(white.onBoard, black.onBoard);
    return minBoard <= 3 ? 'FLYING' : 'MOVING';
}

function parseFen(fen) {
    if (!fen) return null;
    const p = fen.split('/');
    if (p.length < 5) return null;
    return {
        board: p[0].split('').map(c => c === '0' ? null : parseInt(c)),
        currentPlayer: parseInt(p[1]),
        white: { hand: parseInt(p[2][0]), onBoard: parseInt(p[2][1]), lost: parseInt(p[2][2]) },
        black: { hand: parseInt(p[3][0]), onBoard: parseInt(p[3][1]), lost: parseInt(p[3][2]) },
    };
}

function countNearMills(board, player) {
    let c = 0;
    for (const m of MILLS) {
        let mine = 0, empty = 0;
        for (const p of m) { if (board[p] === player) mine++; else if (board[p] === null) empty++; }
        if (mine === 2 && empty === 1) c++;
    }
    return c;
}

function countFullMills(board, player) {
    let c = 0;
    for (const m of MILLS) { if (m.every(p => board[p] === player)) c++; }
    return c;
}

// ==================== 日志解析 ====================

function parseLog(filepath) {
    const text = fs.readFileSync(filepath, 'utf-8');
    const lines = text.split('\n');
    const header = {};
    for (const line of lines.slice(0, 6)) {
        if (line.includes('白方')) header.white = line.split(':')[1].trim().split(' ')[0];
        if (line.includes('黑方')) header.black = line.split(':')[1].trim().split(' ')[0];
    }

    const moves = [];
    let i = 0;
    while (i < lines.length) {
        const mm = lines[i].match(/^--- 第 (\d+) 手 \| (.+?) ---$/);
        if (!mm) { i++; continue; }

        const move = {
            num: parseInt(mm[1]),
            player: mm[2].includes('(白)') ? 'white' : 'black',
            playerName: mm[2],
            aiMode: mm[2].includes('(白)') ? header.white : header.black,
            tags: [], score: 0, time: 0, nodes: 0, depth: 0
        };

        i++;
        while (i < lines.length && !lines[i].startsWith('--- 第') && !lines[i].startsWith('===')) {
            const line = lines[i];
            if (line.startsWith('FEN:')) { move.fen = line.replace('FEN: ', '').trim(); i++; continue; }

            let m;
            if ((m = line.match(/走法: (\S+) (\S+)(?:\s*→\s*(\S+))?/))) {
                move.moveType = m[1];
                if (m[1] === 'place') move.moveTo = parseInt(m[3] || m[2].replace('→', ''));
                else if (m[1] === 'remove') move.removePos = parseInt(m[2]);
                else { move.moveFrom = parseInt(m[2]); move.moveTo = parseInt(m[3]); }
            }
            if ((m = line.match(/评分: (-?\d+)/))) move.score = parseInt(m[1]);
            if ((m = line.match(/标签: \[(.*?)\]/))) move.tags = m[1] ? m[1].split(', ').map(s => s.trim()) : [];
            if ((m = line.match(/策略: (\S+)/))) move.strategy = m[1];
            if ((m = line.match(/用时: (\d+)ms \| 节点: (\d+) \| 深度: (\d+)/))) {
                move.time = parseInt(m[1]); move.nodes = parseInt(m[2]); move.depth = parseInt(m[3]);
            }
            i++;
        }
        moves.push(move);
    }

    let winner = null, totalMoves = 0, totalTime = 0;
    for (const line of lines) {
        let m;
        if ((m = line.match(/胜者: (.+?)\((.+?)\)/))) winner = m[2] === '白' ? 'white' : 'black';
        if ((m = line.match(/总手数: (\d+)/))) totalMoves = parseInt(m[1]);
        if ((m = line.match(/总用时: (\d+)ms/))) totalTime = parseInt(m[1]);
    }
    if (!winner && totalMoves >= 200) winner = 'draw';
    if (totalMoves === 0) totalMoves = moves.length; // 平局兜底

    return { header, moves, winner, totalMoves, totalTime, file: path.basename(filepath) };
}

// ==================== 逐局分析 ====================

function analyzeGame(game) {
    const W = game.header.white, B = game.header.black;
    const stats = {
        white: { mills: 0, captures: 0, blocks: 0, ignoredThreats: 0, forks: 0, maxFork: 0, squeezes: 0,
                 time: { PLACEMENT: [], MOVING: [], FLYING: [] }, nodes: [], maxNodes: 0, maxTime: 0 },
        black: { mills: 0, captures: 0, blocks: 0, ignoredThreats: 0, forks: 0, maxFork: 0, squeezes: 0,
                 time: { PLACEMENT: [], MOVING: [], FLYING: [] }, nodes: [], maxNodes: 0, maxTime: 0 },
        threats: { whiteNearMill: 0, blackNearMill: 0 },
        totalMoves: game.totalMoves,
        winner: game.winner
    };

    for (let i = 0; i < game.moves.length; i++) {
        const m = game.moves[i];
        const s = m.player === 'white' ? stats.white : stats.black;
        const fen = parseFen(m.fen);
        if (!fen) continue;

        const phase = getPhase(fen.white, fen.black);
        const playerType = m.player === 'white' ? 1 : 2;
        const tags = m.tags || [];

        // 性能
        s.time[phase].push(m.time);
        s.nodes.push(m.nodes);
        if (m.nodes > s.maxNodes) s.maxNodes = m.nodes;
        if (m.time > s.maxTime) s.maxTime = m.time;

        // 走法统计
        if (tags.includes('MILL')) s.mills++;
        if (tags.includes('CAPTURE')) s.captures++;
        if (tags.includes('BLOCK')) s.blocks++;
        if (tags.includes('SQUEEZE')) s.squeezes++;

        // Fork：走后该玩家有 ≥2 个近磨
        const nm = countNearMills(fen.board, playerType);
        if (nm >= 2) { s.forks++; if (nm > s.maxFork) s.maxFork = nm; }

        // 威胁响应
        if (i > 0) {
            const prev = game.moves[i - 1];
            if (prev.player !== m.player) {
                const oppType = prev.player === 'white' ? 1 : 2;
                const prevFen = parseFen(prev.fen);
                if (prevFen) {
                    const oppNm = countNearMills(prevFen.board, oppType);
                    // 对手上一手走后有近磨，现在轮到我
                    if (oppNm > 0) {
                        if (prev.player === 'white') stats.threats.whiteNearMill += oppNm;
                        else stats.threats.blackNearMill += oppNm;

                        if (!tags.includes('BLOCK')) s.ignoredThreats++;
                    }
                }
            }
        }
    }

    return stats;
}

// ==================== 汇总统计 ====================

function aggregate(games) {
    const agg = {};
    for (const level of ['Eco', 'Normal', 'Master']) {
        agg[level] = {
            wins: 0, losses: 0, draws: 0,
            totalMoves: 0, mills: 0, captures: 0, blocks: 0, ignoredThreats: 0,
            forks: 0, maxFork: 0, squeezes: 0,
            time: { PLACEMENT: [], MOVING: [], FLYING: [] },
            nodes: [], maxNodes: 0, maxTime: 0,
            threatsReceived: 0
        };
    }

    const matchupAgg = {};

    for (const game of games) {
        const W = game.header.white, B = game.header.black;
        const gs = analyzeGame(game);
        const key = `${W}_vs_${B}`;
        if (!matchupAgg[key]) matchupAgg[key] = { games: [], whiteWins: 0, blackWins: 0, draws: 0 };
        matchupAgg[key].games.push(gs);
        if (gs.winner === 'white') matchupAgg[key].whiteWins++;
        else if (gs.winner === 'black') matchupAgg[key].blackWins++;
        else matchupAgg[key].draws++;

        // 胜负
        if (gs.winner === 'white') { agg[W].wins++; agg[B].losses++; }
        else if (gs.winner === 'black') { agg[B].wins++; agg[W].losses++; }
        else { agg[W].draws++; agg[B].draws++; }

        for (const color of ['white', 'black']) {
            const level = color === 'white' ? W : B;
            const a = agg[level];
            const s = gs[color];
            a.totalMoves += gs.totalMoves;
            a.mills += s.mills; a.captures += s.captures; a.blocks += s.blocks;
            a.ignoredThreats += s.ignoredThreats; a.squeezes += s.squeezes;
            a.forks += s.forks;
            if (s.maxFork > a.maxFork) a.maxFork = s.maxFork;
            if (s.maxNodes > a.maxNodes) a.maxNodes = s.maxNodes;
            if (s.maxTime > a.maxTime) a.maxTime = s.maxTime;
            a.nodes.push(...s.nodes);
            for (const ph of ['PLACEMENT', 'MOVING', 'FLYING']) a.time[ph].push(...s.time[ph]);

            // 威胁：我作为对手时收到了多少近磨
            const oppColor = color === 'white' ? 'black' : 'white';
            a.threatsReceived += color === 'white' ? gs.threats.blackNearMill : gs.threats.whiteNearMill;
        }
    }

    return { agg, matchupAgg };
}

// ==================== 报告输出 ====================

function printReport(games, agg, matchupAgg) {
    const totalMoves = games.reduce((s, g) => s + g.totalMoves, 0);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║               Nine Men\'s Morris AI 对战分析报告 v2                 ║');
    console.log(`║               ${games.length} 场对战 | 共 ${totalMoves} 手                                  ║`);
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    // ── 1. 胜负统计 ──
    console.log('');
    console.log('═══ 1. 胜负统计 ═══');
    console.log('');
    console.log('  按 AI 等级:');
    for (const lv of ['Master', 'Normal', 'Eco']) {
        const a = agg[lv];
        const total = a.wins + a.losses + a.draws;
        console.log(`    ${rpad(lv, 8)} 胜:${pad(a.wins,3)}  负:${pad(a.losses,3)}  平:${pad(a.draws,3)}  胜率:${pct(a.wins, total)}`);
    }

    console.log('');
    console.log('  按对阵:');
    const keys = Object.keys(matchupAgg).sort();
    for (const key of keys) {
        const m = matchupAgg[key];
        const n = m.games.length;
        console.log(`    ${rpad(key, 22)} ${n}局  白胜:${m.whiteWins}  黑胜:${m.blackWins}  平:${m.draws}`);

        // 每局详情
        for (let gi = 0; gi < m.games.length; gi++) {
            const gs = m.games[gi];
            const [w, b] = key.split('_vs_');
            const winnerLabel = gs.winner === 'white' ? w : gs.winner === 'black' ? b : '平局';
            const wTime = gs.white.time.PLACEMENT.concat(gs.white.time.MOVING, gs.white.time.FLYING);
            const bTime = gs.black.time.PLACEMENT.concat(gs.black.time.MOVING, gs.black.time.FLYING);
            console.log(`      第${gi + 1}局 ${pad(gs.totalMoves,3)}手 胜:${rpad(winnerLabel, 6)} ` +
                `白[磨:${gs.white.mills} 吃:${gs.white.captures} 封:${gs.white.blocks} 忽:${gs.white.ignoredThreats} 叉:${gs.white.forks} 压:${gs.white.squeezes}] ` +
                `黑[磨:${gs.black.mills} 吃:${gs.black.captures} 封:${gs.black.blocks} 忽:${gs.black.ignoredThreats} 叉:${gs.black.forks} 压:${gs.black.squeezes}]`);
        }
    }

    // ── 2. 局内统计汇总 ──
    console.log('');
    console.log('═══ 2. 局内统计汇总 ═══');
    console.log('');
    const hdr = '  ' + rpad('AI', 8) + pad('总手', 7) + pad('成磨', 7) + pad('吃子', 7) + pad('封锁', 7) + pad('忽视', 7) + pad('叉子', 14) + pad('压制', 7);
    console.log(hdr);
    console.log('  ' + '─'.repeat(hdr.length - 2));
    for (const lv of ['Eco', 'Normal', 'Master']) {
        const a = agg[lv];
        console.log(`  ${rpad(lv, 8)}${pad(a.totalMoves, 7)}${pad(a.mills, 7)}${pad(a.captures, 7)}` +
            `${pad(a.blocks, 7)}${pad(a.ignoredThreats, 7)}${pad(`${a.forks}(${pct(a.forks, a.totalMoves)})`, 14)}${pad(a.squeezes, 7)}`);
    }

    // ── 3. 威胁响应详情 ──
    console.log('');
    console.log('═══ 3. 威胁响应详情 ═══');
    console.log('');
    console.log('  当对手走后产生近磨威胁，我方是否封锁:');
    console.log('');
    for (const lv of ['Eco', 'Normal', 'Master']) {
        const a = agg[lv];
        const responded = a.blocks;
        const ignored = a.ignoredThreats;
        const total = responded + ignored;
        console.log(`  ${rpad(lv, 8)} 收到威胁:${pad(total, 4)}  封锁:${pad(responded, 4)}  忽视:${pad(ignored, 4)}  响应率:${pct(responded, total)}`);
    }

    // ── 4. 性能统计 ──
    console.log('');
    console.log('═══ 4. 性能统计 ═══');
    console.log('');
    console.log('  ' + rpad('AI', 8) + pad('平均', 8) + pad('中位数', 8) + pad('P95', 8) + pad('最大', 8) + '  ' + rpad('平均节点', 10) + rpad('最大节点', 10) + '平均深度');
    console.log('  ' + '─'.repeat(76));
    for (const lv of ['Eco', 'Normal', 'Master']) {
        const a = agg[lv];
        const times = a.time.PLACEMENT.concat(a.time.MOVING, a.time.FLYING);
        console.log(`  ${rpad(lv, 8)}${pad(avg(times).toFixed(0) + 'ms', 8)}${pad(median(times).toFixed(0) + 'ms', 8)}` +
            `${pad(p95(times).toFixed(0) + 'ms', 8)}${pad(a.maxTime + 'ms', 8)}  ${rpad(avg(a.nodes).toFixed(0), 10)}${rpad(a.maxNodes, 10)}`);
    }

    // 按阶段
    console.log('');
    console.log('  按阶段平均用时:');
    console.log('  ' + rpad('AI', 8) + pad('PLACEMENT', 12) + pad('MOVING', 12) + pad('FLYING', 12));
    console.log('  ' + '─'.repeat(48));
    for (const lv of ['Eco', 'Normal', 'Master']) {
        const a = agg[lv];
        console.log(`  ${rpad(lv, 8)}${pad(avg(a.time.PLACEMENT).toFixed(0) + 'ms', 12)}` +
            `${pad(avg(a.time.MOVING).toFixed(0) + 'ms', 12)}${pad(avg(a.time.FLYING).toFixed(0) + 'ms', 12)}`);
    }

    // 深度分布
    console.log('');
    console.log('  深度分布（搜索深度频率）:');
    for (const lv of ['Eco', 'Normal', 'Master']) {
        const depthMap = {};
        for (const game of games) {
            for (const m of game.moves) {
                if (m.aiMode !== lv) continue;
                depthMap[m.depth] = (depthMap[m.depth] || 0) + 1;
            }
        }
        const entries = Object.entries(depthMap).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        const parts = entries.map(([d, c]) => `D${d}:${c}`);
        console.log(`  ${rpad(lv, 8)} ${parts.join('  ')}`);
    }

    console.log('');
}

// ==================== 主入口 ====================

const logDir = process.argv[2] || path.join(__dirname, 'battle_logs');
if (!fs.existsSync(logDir)) { console.error(`目录不存在: ${logDir}`); process.exit(1); }

const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).map(f => path.join(logDir, f));
if (!logFiles.length) { console.error(`未找到 .log`); process.exit(1); }

console.log(`读取 ${logFiles.length} 个日志...`);
const games = logFiles.map(parseLog);
const { agg, matchupAgg } = aggregate(games);
printReport(games, agg, matchupAgg);
