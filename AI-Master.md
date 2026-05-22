# Nine Men's Morris AI Engine Specification

## 1. Overview

A competitive Nine Men's Morris AI built on Minimax + Alpha-Beta search, driven by a dynamic strategy state machine and a phase-aware evaluation function. Supports three performance modes (Eco / Normal / Master) with progressive determinism, and produces structured tactical reports for LLM integration.

## 2. Architecture

Three-layer separation: **Perception → Decision → Expression**

1. **Engine (engine.js)** — Board state, `makeMove` / `undoMove`, legal move generation, FEN serialization. The `undoMove` interface is critical for AI deep search.
2. **Strategy (strategy.js)** — Transforms raw board coordinates into structured data: mobility scanning, formation tension analysis, tactical report generation.
3. **AI (ai.js)** — Minimax search, static evaluation, strategy state machine, performance mode management. In online mode, tactical reports are fed to an LLM for natural language output; in offline mode, the local state machine selects moves directly.

## 3. Minimax Search

### 3.1 Core: Alpha-Beta Pruning

Standard minimax with alpha-beta pruning. Termination conditions: game over, depth exhausted (`depth <= 0`), or time limit reached.

### 3.2 Half-Turn Horizon Effect Fix

In Nine Men's Morris, forming a mill and capturing a piece are two separate plies (engine states: `formedMill → millMove → remove`). A naive `depth - 1` for every ply causes the search to miss opponent captures at the depth boundary — the AI sees the mill formation (−40 penalty) but not the subsequent capture (−150).

**Fix**: When `formedMill` is true, the current player's logical turn is not complete (capture still pending), so depth is not decremented:

```javascript
const nextDepth = result.formedMill ? depth : depth - 1;
```

This ensures "form mill + capture" costs exactly one depth level, matching the logical turn structure.

### 3.3 Move Ordering for Pruning Efficiency

Moves are sorted by a lightweight heuristic before traversal to maximize alpha-beta cutoffs:

- **Capture (remove)**: priority 1000
- **Mill formation**: priority 500 (detected via lightweight board simulation + `E.isInMill`)
- **Placement**: priority 10

The mill detection temporarily sets `board[to] = player` and checks `isInMill` without calling `makeMove`, keeping the overhead minimal.

### 3.4 Time Management

- Max think time: 5 seconds
- Checked every 1000 nodes in minimax
- Checked at the start of each root move iteration
- Incomplete results (from mid-evaluation timeout) are discarded

## 4. Static Evaluation

### 4.1 Base Weights

| Factor | Weight | Notes |
|--------|--------|-------|
| material | 150 | Per piece advantage |
| mobility | 2 | Safe move count |
| threat | 15 | Potential mill (NEAR_MILL) |
| fork | 30 | Dual threat (base, modified by flying phase) |
| mill | 40 | Formed mill |
| nearMill | 20 | One step from mill (own) |
| opponentNearMill | −30 | One step from mill (opponent) |

### 4.2 Phase-Aware Weight Smoothing

Material and mobility weights transition smoothly across game phases via `phaseFactor` (0 = early placement, 1 = moving/flying):

- `materialW = 150 * (1 − phaseFactor * 0.3)` — material weight reduces 30% in late game
- `mobilityW = 2 * (1 + phaseFactor * 2)` — mobility weight triples in late game

### 4.3 Asymmetric Flying Phase Fork Weighting

When a player enters flying phase (≤3 pieces on board, 0 on hand), the geometric "fork" structure loses tactical meaning because the opponent can fly away. However, if only one side is flying, the multi-piece side should **enhance** fork weight to drive fork-based kills.

Detection (must check both `piecesOnBoard` and `piecesOnHand` to avoid false positives during placement):

```javascript
const aiFlying = ai.piecesOnBoard <= 3 && ai.piecesOnHand === 0;
const oppFlying = opponent.piecesOnBoard <= 3 && opponent.piecesOnHand === 0;
```

Weight matrix:

| Scenario | AI fork | Opponent fork |
|----------|---------|---------------|
| Both >3 pieces | 30 | 30 |
| Both flying (≤3) | 0 | 0 |
| AI >3, opponent flying | **60** | 0 |
| AI flying, opponent >3 | 0 | **60** |

The multi-piece side gets doubled fork weight to aggressively seek fork-based kills against the flying opponent.

### 4.4 Other Evaluation Factors

- **Fly threat**: ±50 penalty when opponent/AI enters flying phase
- **Desperation bonus**: +20 when material deficit ≥ 3 (encourages risk-taking)

## 5. Move Selection: Rank-Based Exponential Distribution

### 5.1 The Problem with Score-Based Softmax

A naive softmax over raw scores fails catastrophically when score gaps are large (e.g., mill capture at +240 vs normal move at +40). Even at temperature 3.0, the second-best move gets probability ≈ 0, eliminating all randomness.

### 5.2 Solution: Top-k + Rank-Based Exponential

```javascript
function pickWithWeightedRandom(sorted, temperature, topK) {
    const candidates = sorted.slice(0, Math.min(topK, sorted.length));
    const weights = candidates.map((_, i) => Math.exp(-i / temperature));
    // roulette wheel selection
}
```

- **Top-k truncation** (default 3): eliminates catastrophic moves from the candidate pool
- **Rank-based weights**: `exp(-i / temperature)` — completely independent of score magnitude
- **Tie-breaking**: equal scores are shuffled via `Math.random() - 0.5` in the sort comparator to prevent stable sort bias

### 5.3 Progressive Determinism

Temperature varies by game phase to balance exploration and exploitation:

| Mode | PLACEMENT | MOVING | FLYING | Top-k |
|------|-----------|--------|--------|-------|
| Eco | 0.8 | 0.8 | 0.8 | 2 |
| Normal | 0.3 | 0.3 | 0.3 | 3 |
| Master | 0.25 | 0.02 | 0.00 | 2 |

- **Eco**: constant high randomness, simulates human intuition and occasional mistakes
- **Normal**: moderate randomness throughout
- **Master**: opening diversity (0.25) to avoid echo chamber effects in mirror matches, near-deterministic in mid-game (0.02), fully deterministic in flying phase (0.00)

Temperature resolution supports both scalar (fixed) and object (phase-mapped) formats via `resolveTemperature`.

## 6. Strategy State Machine

Three modes triggered by game context:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Expansion** | Default / placement phase | Occupy high-connectivity hubs, build potential mill networks |
| **Suppression** | Moving phase, mobility advantage | Block opponent escape paths, prevent flying transition |
| **Decisive** | Material deficit, opponent near flying, or flying phase | Max search depth, seek fastest kill path via double mills |

Mode determination uses `report.context.phase`, `materialDiff`, `isOpponentNearFlying`, and `metrics.mobilityGap`.

## 7. Trap Detection (Depth Gap Evaluation)

Identifies "hidden traps": moves that appear bad at shallow depth but are actually winning at deeper search.

- Shallow evaluation: D=0 (static eval, near-zero cost)
- Deep evaluation: D=shallow+2 (or custom `deepDepth`)
- If `trapScore = deep − shallow > threshold` and `shallow < 0`, tag as `HIDDEN_TRAP`

## 8. Performance Modes

| Mode | Depth | Trap Check | Temperature | Top-k | Label |
|------|-------|------------|-------------|-------|-------|
| Eco | 1 | off | 0.8 | 2 | Lightweight |
| Normal | 3 | on | 0.3 | 3 | Balanced |
| Master | 4 | on | phase-mapped | 2 | Full power |

Dynamic depth adjustment (when depth not explicitly specified):
- Placement phase with many pieces on hand: depth capped at 2
- Suppression mode: depth +1 (up to 6)
- Decisive + Flying: depth −1 (min 2)

## 9. Context Isolation

In dual AI battles, `selectBestMoveForPlayer` snapshots the global config into a local variable at entry to prevent temperature/topK cross-contamination between players:

```javascript
const config = { ...currentConfig };
```

All downstream references (depth, temperature, topK, label) use this local snapshot.

## 10. Fallback Safety

Multiple fallback layers ensure the main decision interface never returns null:

1. `moves.length === 0` → return null (no legal moves, game should be over)
2. Timeout with empty `moveScores` → return first legal move with score 0
3. `pickWithWeightedRandom` returns null → return first legal move with score 0

## 11. Test Infrastructure

- `test/battle.js`: Dual AI battle runner with per-move logging (board state, score, tags, strategy, timing)
- `test/run_battles.sh`: 24-round tournament (3 modes × all pairings × 4 rounds alternating first player)
- Typical results: Master > Normal > Eco, no draws in normal play, game lengths 20-90 hands

## 12. Design Decisions Log

| Decision | Rationale |
|----------|-----------|
| formedMill depth fix | Prevents horizon effect where AI misses opponent captures at depth boundary |
| Rank-based exponential | Eliminates score-magnitude-dependent probability collapse in softmax |
| Progressive determinism | Opening diversity prevents echo chamber; late-game determinism prevents blunders |
| Asymmetric fork weights | Multi-piece side needs enhanced fork to kill flying opponent; flying side fork is meaningless |
| Top-k truncation | Prevents catastrophic moves from entering the random selection pool |
| Tie-breaking shuffle | Prevents stable sort from creating unfair rank discrimination among equal-score moves |
