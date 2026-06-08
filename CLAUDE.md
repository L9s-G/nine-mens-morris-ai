# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pure frontend Nine Men's Morris (九子棋) AI battle game, zero dependencies, runs offline as a single `index.html`. The game features a taunting AI opponent with 4 difficulty levels, 9 visual themes, danmaku commentary, PWA support, and auto-save.

## Key Files

| File | Responsibility |
|------|---------------|
| [index.html](index.html) | Entry point: SVG board layout, modals, script loading order |
| [engine.js](engine.js) | Core engine: bitboard board (own/opp Uint32), rules, move gen/execution/undo, FEN serialization, 3x repetition detection |
| [evaluator.js](evaluator.js) | Leaf evaluation: mill threats (nearMill/hardNearMill/rollingFork/hardRollingFork), mobility with half-life decay, capture value |
| [searcher.js](searcher.js) | Search algorithm: Minimax + alpha-beta pruning, iterative deepening, time wall, same-score shuffle |
| [searcher.worker.js](searcher.worker.js) | Web Worker: imports engine+evaluator+searcher, runs search in background thread |
| [ai.js](ai.js) | AI controller: difficulty config, temperature-weighted random selection, Worker communication |
| [taunt.js](taunt.js) | Taunt system: context building → rule predicates → weighted random line pick, 4 languages (~280 lines, 25 rules) |
| [game.js](game.js) | UI controller: SVG rendering, interaction, animations, settings, save/load, game flow orchestration |
| [style.css](style.css) + [themes.css](themes.css) | CSS: 9 themes via CSS variables, responsive layout, animations |
| [service-worker.js](service-worker.js) | PWA: cache-first strategy, versioned cache, localhost bypass for dev |

## Architecture

All modules are IIFE singletons loaded as global scripts, single dependency direction:

```
game.js (UI)
  ├── ai.js (difficulty config + Worker comms)
  ├── taunt.js (rule/predicate → line pick)
  ├── searcher.js (Minimax+αβ) ──▶ searcher.worker.js (background thread)
  ├── evaluator.js (static evaluation)
  └── engine.js (bitboard board, rules, move gen/execute/undo)
```

### Bitboard Representation

Board state stored as two 24-bit unsigned integers:
- `own`: AI pieces bitmask (bit i = 1 → AI at position i)
- `opp`: opponent pieces bitmask
- `empty = ~(own | opp) & 0xFFFFFF`

Precomputed lookup tables (built once at init):
- `MILL_MASKS[16]`: 16 mill lines, 24-bit masks (3 bits set each)
- `NEIGHBOR_MASKS[24]`: neighbor bitmasks per position
- `MILL_WITHOUT[24][2]`: mill mask minus own position (for wouldFormMill check)
- `POSITION_MILLS[24][2]`: reverse index: which 2 mill lines each position belongs to

Position numbering (3 nested squares + cross connections):
```
       0 -- 1 -- 2         outer
       | 3 - 4 - 5 |       middle
       | | 6-7-8 | |       inner
    9-10-11  12-13-14      horizontal bar
       | |15-16-17| |       inner
       | 18-19-20|         middle
    21--22--23             outer
```

### Move Encoding (18-bit integer)

Eliminates per-node object allocation during search:
- bits 0-4: from (0-23, 31=unused)
- bits 5-9: to (0-23, 31=unused)
- bits 10-14: remove (0-23, 31=none)
- bits 15-16: type (0=place, 1=move, 2=fly, 3=remove)
- bit 17: player (0=OPPONENT, 1=AI)

### Key Data Structures

- **Repetition detection**: Dual `Uint32Array(32)` ring buffer storing raw own/opp values. Zero hash computation, zero GC.
- **Search state**: Engine singleton mutated in-place via `makeMove`/`undoMove`. No deep copies during search.
- **FEN format**: `{"own":12345,"opp":67890,"meta":"0x0c815"}` — compact 24-bit bitmasks + 5-digit hex metadata.

## Common Commands

### Running the App

```bash
# Open directly in browser (no build step)
start index.html          # Windows
open index.html           # macOS

# Or start a static HTTP server (for PWA/service worker)
npx serve .               # or use the included server script
```

### Tests (Node.js via VM sandbox)

```bash
# Engine unit tests (59 cases)
node test/test_engine.js

# Evaluator unit tests (30 cases)
node test/test_evaluator.js

# AI battle simulation
node test/battle.js Normal Master 1

# Loop tournament + log analysis
bash test/run_battles.sh
node test/analyze.js
```

Tests use Node.js `vm` module to load IIFE modules in a sandbox. Each test file modifies the module wrapper to assign globals directly: `.replace('const Engine = (() => {', 'Engine = (() => {')`.

## Development Notes

### JS Bitwise Warning
JavaScript bitwise operators force signed 32-bit integers. Use `>>> 0` (unsigned right shift) or `u32()` wrapper for高位 operations to avoid sign bit issues. Critical for positions 21-23 (bit 21+ has high bit set in signed int).

### AI Difficulty Config (ai.js)

| Level | Depth (PLC/MOV/FLY) | Temperature | Top-K |
|-------|---------------------|-------------|-------|
| 杀手 (Eco) | 1/2/2 | 1.0 | 5 |
| 老手 (Normal) | 2/3/3 | 0.8 | 4 |
| 大师 (Master) | 3/4/5 | 0.25/0.02/0.00 | 2 |
| 恶魔 (Demon) | 5/8/8 | 0 (debug only) | 1 |

### Evaluation Heuristics (evaluator.js)

Score from AI perspective (positive = AI advantage). All features multiplied by `(depth+1)` for depth weighting.

| Feature | Weight | Description |
|---------|--------|-------------|
| nearMill | 10 | 2+1 pattern (2 pieces + 1 empty, reachable) |
| hardNearMill | 20 | nearMill opponent cannot block |
| rollingFork | 40 | Mill-form creates new 2+1 threat |
| hardRollingFork | 80 | Unstoppable rolling fork |
| mobility | 150 × 0.5^(n-1) | Reachable empty spaces, half-life decay |
| capture | 150-200 | Capture value scales with opponent piece count |

### Taunt System (taunt.js)

Rule/predicate architecture: context → predicate match → weighted random ID → line lookup. Rules have IDs encoded as `0x` (pre-move) or `1x` (post-move) with low nibble mapping to phase predicates. ~280 lines across 4 languages (Chinese/English/Greek/French).

### Modifying the Game

- **Rules/move generation**: Only in `engine.js` — `generateLegalMoves`, `makeMove`, `undoMove`
- **AI strength**: Only in `ai.js` `PerformanceConfig` — depth/temperature/topK
- **Evaluation**: Only in `evaluator.js` — `WEIGHTS` and `analyzeMillsBoth` features
- **AI personality**: Only in `taunt.js` — `RULES[]` predicates and `LINES[id]` arrays
- **UI/animation**: Only in `game.js` — SVG rendering, `animateAndExecute`, settings
- **Styles**: `style.css` (base) + `themes.css` (theme-specific CSS variables)

### Search Characteristics

- Mill-forming moves don't consume search depth (forced capture continuation)
- Time wall: 5s normal, 20s debug mode. Checked every 1024 nodes.
- Iterative deepening: reuses best-move order from previous depth.
- Same-score shuffle: Fisher-Yates within same-score segments to avoid deterministic paths.
- Demon level (depth 8) can search ~51M nodes in 5s on mobile (~2550 n/ms).
