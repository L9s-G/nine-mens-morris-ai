# Nine Men's Morris AI

A pure JavaScript Nine Men's Morris (九子棋) AI engine featuring Minimax search, dynamic strategy state machine, hidden trap detection, and a personality-driven narrator system. Zero dependencies.

## Features

- **Complete game engine** — Placement, Moving, and Flying phases; full move generation with undo support
- **Three AI difficulty modes:**
  - **Eco** — Depth 1, high temperature (randomized), beginner-friendly
  - **Normal** — Depth 3, trap detection, balanced challenge
  - **Master** — Depth 4, trap detection, near-deterministic play
- **Dynamic strategy state machine** — Switches between Expansion, Suppression, and Decisive Strike based on material count, mobility gap, and game phase
- **Hidden trap detection** — Depth-gap evaluation identifies moves that look bad at shallow depth but are winning at deeper analysis
- **Personality narrator** — Emotion-driven Chinese dialogue (arrogant / confident / neutral / cautious / desperate); supports offline word bank and optional LLM integration
- **Tactical report system** — Structured JSON output with context, metrics, scored moves, and semantic tags
- **Weighted random selection** — Softmax-based move selection with configurable temperature for each difficulty
- **Performance time guard** — 5-second search limit with per-1000-node time checks

## Tech Stack

- **Vanilla JavaScript** (ES6+, IIFE module pattern)
- **Zero dependencies** — No npm packages, no bundlers, no frameworks

## Project Structure

```
├── engine.js           # Core game engine (state, rules, move generation, undo)
├── strategy.js         # Tactical analysis (effective mobility, formation tension, reports)
├── ai.js               # AI controller (minimax, alpha-beta, strategy modes, trap detection)
├── narrator.js         # Personality/dialogue system (offline word bank + LLM prompt)
├── AI-Master.md        # Master AI design specification
├── CLAUDE.md           # Project development guidelines
├── test/
│   ├── test_undo.js        # Undo stress test
│   ├── test_strategy.js    # Strategy unit tests
│   ├── test_ai.js          # AI unit tests
│   ├── test_narrator.js    # Narrator tests
│   ├── test_perf.js        # Performance benchmarks
│   ├── battle.js           # AI vs AI battle runner
│   └── run_battles.sh      # Batch battle script
└── .gitignore
```

## Architecture

Four-layer module architecture using the Revealing Module Pattern (IIFE):

```
Engine (game state, rules, move generation, undo)
  └─ Strategy (effective mobility, formation tension, tactical reports)
       └─ AI (minimax + alpha-beta, strategy state machine, trap detection)
            └─ Narrator (emotion system, offline/online dialogue)
```

Each layer exposes a clean public API. The upper layers depend on the lower ones; no circular dependencies.

## Running Tests

Requires Node.js:

```bash
cd test
node test_undo.js
node test_strategy.js
node test_ai.js
node test_narrator.js
node test_perf.js
```

## AI vs AI Battles

```bash
cd test

# Single battle: node battle.js <mode1> <mode2> <rounds> <logfile>
node battle.js Normal Master 1 battle.log

# Batch battles (parallel)
bash run_battles.sh
```

## AI Design Highlights

| Concept | Description |
|---------|-------------|
| **Minimax + Alpha-Beta** | Adversarial search with move ordering for better pruning |
| **Dynamic Depth** | Depth adjusts per strategy mode (+1 for Suppression, -1 for Flying) |
| **Strategy State Machine** | Expansion / Suppression / Decisive, driven by material diff & mobility gap |
| **Hidden Trap** | `TrapScore = Score(D_deep) - Score(D_shallow)` — finds deceptive winning moves |
| **Softmax Temperature** | Controls move randomization: high for Eco, near-zero for Master |
| **Effective Mobility** | Counts only moves that don't immediately lose a piece |
| **Phase-Aware Weights** | Evaluation weights shift smoothly as pieces leave hand (material ↓, mobility ↑) |

## License

MIT
