# Nine Men's Morris AI Engine Specification

## 1. Overview

A competitive Nine Men's Morris AI engine built on Minimax + Alpha-Beta search, with a phase-aware evaluation function and a dynamic strategy state machine. Supports three performance modes (Eco / Normal / Master), produces structured tactical reports for LLM integration, and is designed for both competitive play and open-source reference.

## 2. Architecture

Three-layer separation: **Perception → Decision → Expression**

### 2.1 Engine Layer (engine.js)

Board state management and rule execution:

- **Board representation**: 24-position array, each storing player type or null
- **Player state**: `piecesOnHand` (pending placement), `piecesOnBoard` (alive on board), `piecesLost` (captured)
- **Move generation**: `generateLegalMoves(player)` produces all legal moves based on current phase (placement/moving/flying)
- **Move execution**: `makeMove(move)` returns `{ formedMill, move }`; on mill formation, sets `millMove` state without switching players
- **Move undo**: `undoMove()` precisely restores board and player state, enabling AI deep search
- **Serialization**: FEN format (`MILL-FEN`) for state persistence and restoration
- **Mill detection**: `isInMill(board, pos, player)` checks if a position belongs to a mill

### 2.2 Strategy Layer (strategy.js)

Transforms board coordinates into structured tactical data:

- **Formation tension**: `analyzeFormationTension(player)` returns threat count, fork count, and other metrics
- **Mobility**: `countMobility(player)` counts safe moves
- **Tactical report**: `generateReport()` outputs standardized JSON with phase, material diff, mobility diff, suggested moves and tags

### 2.3 AI Controller Layer (ai.js)

Core module for search, evaluation, and decision-making:

- **Minimax search**: Alpha-Beta pruned game tree search
- **Static evaluation**: Multi-factor weighted evaluation function
- **Strategy state machine**: Dynamic personality switching based on game context
- **Performance modes**: Three difficulty presets
- **Move selection**: Rank-based exponential distribution with progressive determinism

## 3. Game Rules Engine

### 3.1 Three-Phase Flow

| Phase | Condition | Move Type |
|-------|-----------|-----------|
| PLACEMENT | `piecesOnHand > 0` | `place`: from hand to empty position |
| MOVING | Both `piecesOnHand === 0`, `piecesOnBoard > 3` | `move`: to adjacent empty position |
| FLYING | `piecesOnBoard <= 3` and `piecesOnHand === 0` | `fly`: to any empty position |

### 3.2 Dual-Ply Mill + Capture Structure

"Form mill and capture" is split into two separate plies in the engine:

1. **Form mill**: `makeMove` returns `formedMill: true`, sets `state.millMove = true`, **does not switch players**
2. **Execute capture**: generates `type: 'remove'` moves, resets `millMove = false` on execution, switches players

This dual-ply structure is the foundation of the "half-turn horizon effect" fix.

### 3.3 Capture Legality

Captures must respect: pieces in fully-formed mills cannot be captured (unless all opponent pieces are in mills). The engine enforces this precisely in `generateLegalMoves` using `isInMill` and neighbor relationships.

## 4. Minimax Search

### 4.1 Alpha-Beta Pruning

Standard minimax with alternating maximizing (AI) and minimizing (opponent) layers. Alpha-Beta pruning reduces nodes by 80%+ with good move ordering.

Termination: game over (`E.isGameOver()`), depth exhausted (`depth <= 0`), or timeout (checked every 1000 nodes, 5-second limit).

### 4.2 Move Ordering

Heuristic sorting before traversal to maximize cutoffs:

| Priority | Type | Score | Detection |
|----------|------|-------|-----------|
| Highest | Capture (remove) | 1000 | `m.remove !== null` |
| High | Mill formation | 500 | Board simulation + `E.isInMill` |
| Normal | Placement | 10 | `m.type === 'place'` |

Mill detection temporarily modifies the board array without calling `makeMove`, keeping overhead minimal.

### 4.3 Dynamic Depth Adjustment

When depth is not specified, adjusted dynamically based on game context:

- **Placement with many pieces on hand** (≥6): depth capped at 2 (high branching factor)
- **Suppression mode**: depth +1 (low branching factor, room to search deeper)
- **Decisive + Flying**: depth −1 (branching factor explosion)

### 4.4 Time Management

- Max think time: 5 seconds
- Checked every 1000 nodes in minimax
- Checked at start of each root move iteration
- Incomplete results from mid-evaluation timeout are discarded

Measured performance: depth 4 typically 9-588ms, depth 5 mostly 63-513ms, occasional spikes up to the 5-second limit (~1.2M nodes). The timeout serves as a safety net for extreme positions.

## 5. Static Evaluation

### 5.1 Base Weights

| Factor | Weight | Description |
|--------|--------|-------------|
| material | 150 | Per piece advantage |
| mobility | 2 | Safe move count |
| threat | 15 | Potential mill (one step away) |
| fork | 30 | Dual threat (base value, modified in flying phase) |
| mill | 40 | Formed mill |
| nearMill | 20 | One step from own mill (bonus) |
| opponentNearMill | −30 | One step from opponent mill (penalty) |

### 5.2 Phase-Aware Weight Smoothing

Weights transition smoothly across game phases to avoid evaluation discontinuities:

- `phaseFactor = 1 − max(both hands) / 9` (0 = early placement, 1 = hands empty)
- `materialW = 150 × (1 − phaseFactor × 0.3)` — material weight reduces 30% in late game
- `mobilityW = 2 × (1 + phaseFactor × 2)` — mobility weight triples in late game

### 5.3 Asymmetric Flying Phase Fork Weighting

In flying phase (≤3 pieces, 0 on hand), forks lose tactical meaning (opponent can fly away). However, the multi-piece side needs enhanced fork weight to drive fork-based kills.

Detection (must check both `piecesOnBoard` and `piecesOnHand` to avoid false positives during placement):

```javascript
const aiFlying = ai.piecesOnBoard <= 3 && ai.piecesOnHand === 0;
const oppFlying = opponent.piecesOnBoard <= 3 && opponent.piecesOnHand === 0;
```

Weight matrix:

| Scenario | AI fork | Opponent fork |
|----------|---------|---------------|
| Both >3 pieces | 30 | 30 |
| Both flying | 0 | 0 |
| AI multi-piece, opponent flying | **60** | 0 |
| AI flying, opponent multi-piece | 0 | **60** |

### 5.4 Other Factors

- **Fly threat**: ±50 penalty when opponent/AI enters flying phase
- **Desperation bonus**: +20 when material deficit ≥ 3 (encourages risk-taking)

## 6. Strategy State Machine

AI dynamically switches personality based on game context:

| Mode | Trigger | Behavior | Tags |
|------|---------|----------|------|
| **Expansion** | Default / placement | Occupy high-connectivity hubs, build mill networks | `HUB_CONTROL`, `LAYOUT` |
| **Suppression** | Moving phase, mobility gap > 2 | Block opponent escape, prevent flying transition | `SQUEEZE`, `ANTI_FLYING` |
| **Decisive** | Material deficit / opponent near flying / flying | Max depth, seek fastest kill via double mills | `ATTACK`, `DECISIVE_STRIKE` |

Strategy mode affects two dimensions:
1. **Depth**: Suppression +1, Decisive+Flying −1
2. **Move bonus**: `applyModeBonus` adds/subtracts based on mode and tags

## 7. Move Selection

### 7.1 Rank-Based Exponential Distribution

Score-based softmax fails catastrophically with large score gaps (mill capture +240 vs normal +40 → second-best probability ≈ 0). Solution: decouple probability from score magnitude entirely.

```javascript
function pickWithWeightedRandom(sorted, temperature, topK) {
    const candidates = sorted.slice(0, Math.min(topK, sorted.length));
    const weights = candidates.map((_, i) => Math.exp(-i / temperature));
    // roulette wheel selection
}
```

- **Top-k truncation**: only select from top k moves, excluding catastrophic options
- **Rank-based weights**: `exp(-i / temperature)`, independent of score magnitude
- **Tie-breaking**: random shuffle for equal scores prevents stable sort bias

### 7.2 Progressive Determinism

Temperature varies by game phase:

| Mode | PLACEMENT | MOVING | FLYING | Top-k |
|------|-----------|--------|--------|-------|
| Eco | 0.8 | 0.8 | 0.8 | 2 |
| Normal | 0.3 | 0.3 | 0.3 | 3 |
| Master | 0.25 | 0.02 | 0.00 | 2 |

Master mode rationale:
- **Placement 0.25**: Opening diversity, prevents "echo chamber" in mirror matches
- **Moving 0.02**: Near-deterministic, full computational power in mid-game
- **Flying 0.00**: Fully deterministic, random mistakes are too costly in flying phase

### 7.3 Context Isolation

In dual AI battles, `selectBestMoveForPlayer` snapshots global config to a local variable at entry, preventing temperature/topK cross-contamination:

```javascript
const config = { ...currentConfig };
```

## 8. Trap Detection

Identifies "hidden traps": moves that appear bad at shallow depth but are actually winning at deeper search.

- Shallow: D=0 (static eval, near-zero cost)
- Deep: D=current config depth (or custom `deepDepth`)
- `trapScore = deep score − shallow score`
- If `trapScore > threshold (default 50)` and `shallow score < 0`, tag as `HIDDEN_TRAP`

Use case: AI can deliberately choose seemingly bad moves to lure opponents into traps.

## 9. Performance Modes

| Mode | Depth | Trap Check | Temperature | Top-k | Use Case |
|------|-------|------------|-------------|-------|----------|
| Eco | 1 | off | 0.8 | 2 | Lightweight, simulates novice |
| Normal | 3 | on | 0.3 | 3 | Balanced, suitable for casual play |
| Master | 4 | on | phase-mapped | 2 | Full power, competitive level |

## 10. Fallback Safety

Multiple layers ensure the main decision interface never returns null:

1. `moves.length === 0` → return null (game should be over)
2. Timeout with empty `moveScores` → return first legal move
3. `pickWithWeightedRandom` returns null → return first legal move

## 11. Test Infrastructure

- `test/battle.js`: Dual AI battle runner with per-move logging (board, score, tags, strategy, timing)
- `test/run_battles.sh`: 24-round tournament (3 modes × all pairings × 4 rounds alternating first player)
- Typical results: Master > Normal > Eco, no draws in normal play, 20-90 hands per game

## 12. Design Highlights

Key problems discovered and solved during development, with reference value for similar game AI projects:

### 12.1 Half-Turn Horizon Effect

**Problem**: Mill + capture is two plies but one logical turn. If depth runs out at mill formation, AI sees the mill (−40) but not the capture (−150), failing to block.

**Fix**: Don't decrement depth on mill formation, ensuring the capture ply is searched.

### 12.2 Rank-Based Exponential Distribution

**Problem**: Score-based softmax degenerates to argmax with large score gaps.

**Fix**: Rank-based exponential + top-k truncation. Probability depends only on rank, not score magnitude.

### 12.3 Progressive Determinism

**Problem**: Zero-temperature mirror matches produce "echo chamber" — first player always loses.

**Fix**: Master mode retains 0.25 temperature in placement for opening diversity, converges to near-deterministic in later phases.

### 12.4 Asymmetric Flying Phase Evaluation

**Problem**: Forks are meaningless in flying phase, but zeroing fork for both sides kills the multi-piece side's winning strategy.

**Fix**: Detect flying per-side. Flying player fork=0, multi-piece opponent fork=60 (enhanced kill drive).

### 12.5 Move Ordering with Mill Detection

**Problem**: Alpha-Beta pruning efficiency depends heavily on move traversal order.

**Fix**: Capture > Mill formation > Placement priority. Mill detection via temporary board modification, no `makeMove` overhead.
