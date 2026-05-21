# Nine Men's Morris

A browser-based Nine Men's Morris (九子棋) game with a sophisticated AI opponent featuring dynamic strategy, hidden trap detection, and a personality-driven narrator system.

> **GitHub Project Info**
> - **Name:** `nine-mens-morris-ai`
> - **Description:** Browser-based Nine Men's Morris game with Minimax AI, dynamic strategy state machine, hidden trap detection, and personality narrator — zero dependencies, pure vanilla JS.

## Features

- **Complete game rules** — Placement, Moving, and Flying phases fully implemented
- **Three AI difficulty modes:**
  - **Eco** — Depth 1, relaxed play, good for beginners
  - **Normal** — Depth 3, trap detection, balanced challenge
  - **Master** — Depth 4, trap detection, near-deterministic play
- **Dynamic strategy state machine** — Switches between Expansion, Suppression, and Decisive Strike tactical modes based on game state
- **Hidden Trap detection** — Identifies moves that look bad at shallow depth but are brilliant at deeper analysis (depth-gap evaluation)
- **Personality narrator** — AI speaks with emotion-driven Chinese dialogue (arrogant, confident, neutral, cautious, desperate); supports optional LLM integration
- **Tactical report system** — Structured JSON reports with metrics, scored moves, and semantic tags
- **Undo support** — Human player can undo moves (reverts both human and AI moves)
- **Responsive SVG UI** — Adapts between portrait and landscape layouts
- **AI vs AI battle framework** — Automated play between different difficulty modes for testing

## Tech Stack

- **Vanilla JavaScript** (ES6+, IIFE module pattern)
- **HTML5 / CSS3** — Single-page application with responsive layout
- **Inline SVG** — Board rendering with no external dependencies
- **Zero dependencies** — No npm packages, no bundlers, no frameworks

## Project Structure

```
├── index.html          # Game UI + Controller (HTML/CSS/JS)
├── engine.js           # Core game engine (state, rules, move generation)
├── strategy.js         # Tactical analysis (mobility, tension, reports)
├── ai.js               # AI controller (minimax, alpha-beta, strategy modes)
├── narrator.js         # Personality/dialogue system
├── test/
│   ├── test_undo.js        # Undo stress test (100 random cycles)
│   ├── test_strategy.js    # Strategy unit tests
│   ├── test_ai.js          # AI unit tests
│   ├── test_narrator.js    # Narrator tests
│   ├── test_perf.js        # Performance benchmarks
│   ├── battle.js           # AI vs AI battle runner
│   └── run_battles.sh      # Batch battle script
├── PRD-NineMensMorris.md   # Architecture design document (Chinese)
├── AI-Master.md            # Master AI design specification
└── chat.md                 # Development notes
```

## Quick Start

No build step required. Open directly in a browser:

```bash
# Option 1: Open index.html in your browser

# Option 2: Use a local server
python3 -m http.server 9000
# or
npx serve -l 9000
```

Then visit `http://localhost:9000`.

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

# Run a single battle: node battle.js <mode1> <mode2> <rounds> <logfile>
node battle.js Normal Master 1 battle.log

# Run batch battles (5 parallel Eco vs Eco)
bash run_battles.sh
```

## Architecture

The codebase follows a layered module architecture using the Revealing Module Pattern (IIFE):

```
Engine (game state, rules, move generation)
  └─ Strategy (tactical analysis, mobility, tension)
       └─ AI (minimax search, alpha-beta pruning, strategy modes)
            └─ Narrator (emotion system, dialogue generation)
```

The Game Controller in `index.html` orchestrates all modules.

## AI Design Highlights

| Concept | Description |
|---------|-------------|
| **Minimax + Alpha-Beta** | Standard adversarial search with pruning for performance |
| **Dynamic Depth** | Search depth adjusts per strategy mode (1–4 plies) |
| **Strategy State Machine** | Expansion → Suppression → Decisive Strike, driven by material & mobility |
| **Hidden Trap** | `TrapScore = Score(D_deep) - Score(D_shallow)` — finds non-obvious winning moves |
| **Temperature** | Controls move randomization — high for Eco, low for Master |
| **Effective Mobility** | Counts moves that don't immediately lose a piece (not just raw mobility) |

## Browser Compatibility

Works in any modern browser with ES6+ support. Tested on Chrome, Firefox, Safari, and Edge.

## License

MIT
