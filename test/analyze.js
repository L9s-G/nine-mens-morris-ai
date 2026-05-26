#!/usr/bin/env node
// ========================================================
// Nine Men's Morris 对战日志分析脚本
// 用法: node test/analyze.js [logs_dir]
// 默认扫描 test/battle_logs/，输出到 test/analysis/
// ========================================================

const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================

const SCRIPT_DIR = __dirname;
const DEFAULT_LOGS_DIR = path.join(SCRIPT_DIR, 'battle_logs');
const DEFAULT_OUTPUT_DIR = path.join(SCRIPT_DIR, 'analysis');

// ==================== 正则 ====================

const RE_HEADER = /^白方 \(TYPE_OPPONENT\):\s+(\S+)\s+模式/;
const RE_HEADER_BLACK = /^黑方 \(TYPE_AI\):\s+(\S+)\s+模式/;
const RE_DATE = /^日期:\s+(.+)$/;
const RE_MOVE_HEADER = /^--- 第 (\d+) 手 \| (\S+?)\(([白黑])\) ---$/;
const RE_PIECES = /初始：白-(\d+)-(\d+)-(\d+)\s+黑-(\d+)-(\d+)-(\d+)$/;
const RE_MOVE_PLACE = /走法:\s+place\s+→\s+(\d+)/;
const RE_MOVE_MOVE = /走法:\s+move\s+(\d+)\s+→\s+(\d+)/;
const RE_MOVE_FLY = /走法:\s+fly\s+(\d+)\s+→\s+(\d+)/;
const RE_MOVE_REMOVE = /走法:\s+remove\s+(\d+)/;
const RE_SCORE = /评分:\s+(-?\d+)/;
const RE_PERF = /用时:\s+(\d+)ms\s*\|\s*节点:\s+(\d+)\s*\|\s*深度:\s+(\d+)/;
const RE_FEN = /^FEN:\s+(.+)$/;
const RE_GAME_OVER = /^游戏结束！胜者:\s+(.+)$/;
const RE_DRAW_LIMIT = /^\[!\]\s+达到最大手数限制，判定为平局$/;
const RE_TOTAL_MOVES = /^总手数:\s+(\d+)$/;
const RE_TOTAL_TIME = /^总用时:\s+(\d+)ms$/;

const INFO_OFFSET = 16; // 13 字符 board + 3 空格

function splitInfo(line) {
    if (line.startsWith('FEN:')) return line;
    if (line.length <= INFO_OFFSET) return '';
    return line.slice(INFO_OFFSET);
}

// ==================== 解析单个日志 ====================

function parseLog(filepath) {
    const lines = fs.readFileSync(filepath, 'utf-8').split(/\r?\n/);

    const game = {
        file: path.basename(filepath),
        white: null,
        black: null,
        date: null,
        winner: null,
        total_moves: 0,
        total_time_ms: 0,
        moves: [],
    };

    let moveData = null;

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) continue;
        const trimmed = line.trim();

        let m;

        if ((m = RE_DATE.exec(trimmed))) { game.date = m[1]; continue; }
        if ((m = RE_HEADER.exec(trimmed))) { game.white = m[1]; continue; }
        if ((m = RE_HEADER_BLACK.exec(trimmed))) { game.black = m[1]; continue; }

        if ((m = RE_MOVE_HEADER.exec(trimmed))) {
            if (moveData) game.moves.push(moveData);
            moveData = {
                move_num: +m[1],
                player: m[2],
                color: m[3],
                move_type: null,
                from: -1,
                to: -1,
                remove: null,
                score: 0,
                time_ms: 0,
                nodes: 0,
                depth: 0,
                fen: '',
                white_pieces: [0, 0, 0],
                black_pieces: [0, 0, 0],
            };
            continue;
        }

        if ((m = RE_GAME_OVER.exec(trimmed))) { game.winner = m[1]; continue; }
        if (RE_DRAW_LIMIT.test(trimmed)) { game.winner = '平局'; continue; }
        if ((m = RE_TOTAL_MOVES.exec(trimmed))) { game.total_moves = +m[1]; continue; }
        if ((m = RE_TOTAL_TIME.exec(trimmed))) { game.total_time_ms = +m[1]; continue; }
        if (trimmed.startsWith('===')) continue;

        const info = splitInfo(line);
        if (!info) continue;

        if ((m = RE_PIECES.exec(info))) {
            moveData.white_pieces = [+m[1], +m[2], +m[3]];
            moveData.black_pieces = [+m[4], +m[5], +m[6]];
            continue;
        }
        if ((m = RE_MOVE_PLACE.exec(info))) { moveData.move_type = 'place'; moveData.to = +m[1]; continue; }
        if ((m = RE_MOVE_MOVE.exec(info))) { moveData.move_type = 'move'; moveData.from = +m[1]; moveData.to = +m[2]; continue; }
        if ((m = RE_MOVE_FLY.exec(info))) { moveData.move_type = 'fly'; moveData.from = +m[1]; moveData.to = +m[2]; continue; }
        if ((m = RE_MOVE_REMOVE.exec(info))) { moveData.move_type = 'remove'; moveData.remove = +m[1]; continue; }
        if ((m = RE_SCORE.exec(info))) { moveData.score = +m[1]; continue; }
        if ((m = RE_PERF.exec(info))) {
            moveData.time_ms = +m[1];
            moveData.nodes = +m[2];
            moveData.depth = +m[3];
            continue;
        }
        if ((m = RE_FEN.exec(trimmed))) { moveData.fen = m[1]; continue; }
    }

    if (moveData) game.moves.push(moveData);

    if (game.total_moves === 0 && game.moves.length > 0) {
        game.total_moves = game.moves[game.moves.length - 1].move_num;
    }
    if (game.total_time_ms === 0 && game.moves.length > 0) {
        game.total_time_ms = game.moves.reduce((s, m) => s + m.time_ms, 0);
    }

    return game;
}

// ==================== 汇总统计 ====================

function percentile(data, p) {
    if (data.length === 0) return 0;
    const s = [...data].sort((a, b) => a - b);
    const idx = Math.floor(s.length * p / 100);
    return s[Math.min(idx, s.length - 1)];
}

function computeSummary(games) {
    const stats = {};

    function ensure(mode) {
        if (!stats[mode]) {
            stats[mode] = {
                games: 0, wins: 0, losses: 0, draws: 0,
                total_moves: 0, total_time_ms: 0, total_nodes: 0,
                move_times: [], move_nodes: [], move_depths: [],
            };
        }
        return stats[mode];
    }

    for (const g of games) {
        const w = ensure(g.white);
        const b = ensure(g.black);
        w.games++;
        b.games++;

        const winner = g.winner;
        if (winner && winner.includes('平局')) {
            w.draws++;
            b.draws++;
        } else if (winner && winner.includes(g.white)) {
            w.wins++;
            b.losses++;
        } else if (winner && winner.includes(g.black)) {
            b.wins++;
            w.losses++;
        }

        for (const m of g.moves) {
            const s = ensure(m.player);
            s.total_moves++;
            s.total_time_ms += m.time_ms;
            s.total_nodes += m.nodes;
            s.move_times.push(m.time_ms);
            s.move_nodes.push(m.nodes);
            s.move_depths.push(m.depth);
        }
    }

    const result = {};
    for (const [mode, s] of Object.entries(stats).sort()) {
        const times = s.move_times;
        const nodes = s.move_nodes;
        const depths = s.move_depths;

        const depthDist = {};
        for (const d of depths) depthDist[d] = (depthDist[d] || 0) + 1;

        result[mode] = {
            games: s.games,
            wins: s.wins,
            losses: s.losses,
            draws: s.draws,
            total_moves: s.total_moves,
            avg_time_ms: Math.round(s.total_time_ms / Math.max(s.total_moves, 1)),
            avg_nodes: Math.round(s.total_nodes / Math.max(s.total_moves, 1)),
            depth_distribution: Object.fromEntries(
                Object.entries(depthDist).sort((a, b) => +a[0] - +b[0])
            ),
            time_p50: percentile(times, 50),
            time_p90: percentile(times, 90),
            time_p99: percentile(times, 99),
            nodes_p50: percentile(nodes, 50),
            nodes_p90: percentile(nodes, 90),
        };
    }

    return result;
}

// ==================== 主函数 ====================

function main() {
    const logsDir = process.argv[2] || DEFAULT_LOGS_DIR;
    const outputDir = DEFAULT_OUTPUT_DIR;

    if (!fs.existsSync(logsDir)) {
        console.error(`日志目录不存在: ${logsDir}`);
        process.exit(1);
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const logFiles = fs.readdirSync(logsDir)
        .filter(f => f.endsWith('.log'))
        .sort();

    if (logFiles.length === 0) {
        console.error(`未找到 .log 文件: ${logsDir}`);
        process.exit(1);
    }

    console.log(`扫描到 ${logFiles.length} 个日志文件`);

    const games = [];
    const allMoves = [];

    for (const f of logFiles) {
        const game = parseLog(path.join(logsDir, f));
        games.push(game);
        for (const m of game.moves) {
            m.file = game.file;
            allMoves.push(m);
        }
    }

    const gamesPath = path.join(outputDir, 'games.json');
    const movesPath = path.join(outputDir, 'moves.json');
    const summaryPath = path.join(outputDir, 'summary.json');

    const gamesSummary = games.map(g => ({
        file: g.file,
        white: g.white,
        black: g.black,
        date: g.date,
        winner: g.winner,
        total_moves: g.total_moves,
        total_time_ms: g.total_time_ms,
    }));

    fs.writeFileSync(gamesPath, JSON.stringify(gamesSummary, null, 2));
    fs.writeFileSync(movesPath, JSON.stringify(allMoves, null, 2));

    const summary = computeSummary(games);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log(`输出:`);
    console.log(`  ${gamesPath}  (${games.length} 局)`);
    console.log(`  ${movesPath}  (${allMoves.length} 步)`);
    console.log(`  ${summaryPath}  (${Object.keys(summary).length} 种模式)`);
}

main();
