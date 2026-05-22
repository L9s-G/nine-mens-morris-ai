// ========================================================
// Nine Men's Morris — UI 控制器
// ========================================================

const Game = (() => {
    const E = Engine;
    const BOARD_SIZE = 24;

    // ==================== 棋盘坐标映射 ====================

    // 24 个位置在 7×7 网格上的 (col, row) 坐标
    const GRID = [
        [0,0],[3,0],[6,0],   // 0,1,2
        [1,1],[3,1],[5,1],   // 3,4,5
        [2,2],[3,2],[4,2],   // 6,7,8
        [0,3],[1,3],[2,3],   // 9,10,11
        [4,3],[5,3],[6,3],   // 12,13,14
        [2,4],[3,4],[4,4],   // 15,16,17
        [1,5],[3,5],[5,5],   // 18,19,20
        [0,6],[3,6],[6,6]    // 21,22,23
    ];

    // 网格到 SVG 坐标（viewBox 600×600）
    // 外框 500×500，margin=50，6 格 → CELL = 500/6（精确分数，避免浮点漂移）
    const MARGIN = 50;
    const BOARD_PX = 500;
    const GRID_STEPS = 6;
    const CELL = BOARD_PX / GRID_STEPS; // 83.333...

    function posToSvg(pos) {
        const [c, r] = GRID[pos];
        return { x: MARGIN + c * CELL, y: MARGIN + r * CELL };
    }

    // ==================== SVG 棋盘渲染 ====================

    const NS = 'http://www.w3.org/2000/svg';
    const DOT_RADIUS = 4;

    let svgDots, svgPositions, svgPieces, svgHighlights, svgDebug;

    function createSvgElement(tag, attrs) {
        const el = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
    }

    function initBoard() {
        svgDots = document.getElementById('board-dots');
        svgPositions = document.getElementById('board-positions');
        svgPieces = document.getElementById('board-pieces');
        svgHighlights = document.getElementById('board-highlights');
        svgDebug = document.getElementById('board-debug');

        // 创建 24 个交点标记（黑色实心小圆点）
        for (let i = 0; i < BOARD_SIZE; i++) {
            const { x, y } = posToSvg(i);
            const dot = createSvgElement('circle', {
                cx: x, cy: y, r: DOT_RADIUS,
                class: 'board-dot',
                'data-pos': i
            });
            svgDots.appendChild(dot);

            // Debug: 显示位置编号
            const label = createSvgElement('text', {
                x: x + 14, y: y - 20,
                'font-size': '11',
                fill: '#e74c3c',
                'font-weight': 'bold',
                'pointer-events': 'none'
            });
            label.textContent = i;
            svgDebug.appendChild(label);
        }
        svgDebug.style.display = 'none'; // 默认隐藏

        // 创建 24 个交互区域（与棋子同半径）
        for (let i = 0; i < BOARD_SIZE; i++) {
            const { x, y } = posToSvg(i);
            const hitArea = createSvgElement('circle', {
                cx: x, cy: y, r: 22,
                class: 'board-position',
                'data-pos': i
            });
            hitArea.addEventListener('click', () => onPositionClick(i));
            svgPositions.appendChild(hitArea);
        }
    }

    function renderBoard() {
        const board = E.getBoard();

        // 清空棋子层
        svgPieces.innerHTML = '';

        // 绘制棋子
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (board[i] === null) continue;
            const { x, y } = posToSvg(i);
            const isWhite = board[i] === E.TYPE_OPPONENT;
            const circle = createSvgElement('circle', {
                cx: x, cy: y, r: 22,
                class: `piece ${isWhite ? 'piece-white' : 'piece-black'}`,
                'data-pos': i
            });

            // 选中状态
            if (selectedPos === i) circle.classList.add('selected');
            // 可吃子状态
            if (legalTargets.includes(i) && board[i] !== currentLegalPlayer) circle.classList.add('capture');

            svgPieces.appendChild(circle);
        }

        // 渲染高亮
        renderHighlights();
    }

    function renderHighlights() {
        svgHighlights.innerHTML = '';
        if (legalTargets.length === 0) return;

        const board = E.getBoard();
        for (const target of legalTargets) {
            // 吃子目标由棋子 .capture 样式处理，此处只画空位高亮
            const isCaptureTarget = board[target] !== null;
            if (isCaptureTarget) continue;

            const { x, y } = posToSvg(target);
            const circle = createSvgElement('circle', {
                cx: x, cy: y, r: 14,
                class: 'highlight-move'
            });
            svgHighlights.appendChild(circle);
        }
    }

    // ==================== 游戏状态 ====================

    let selectedPos = null;   // 当前选中的棋子位置
    let legalTargets = [];    // 当前选中棋子的合法目标
    let currentLegalPlayer = null;
    let playerMoves = [];     // 当前玩家的合法走法
    let isAIThinking = false;
    let debugMode = false;    // Debug 模式开关

    // ==================== 交互逻辑 ====================

    function onPositionClick(pos) {
        if (isAIThinking) return;
        if (E.getRawState().currentPlayer !== E.TYPE_OPPONENT) return;
        if (E.isGameOver()) return;

        const state = E.getRawState();

        // 吃子阶段
        if (state.millMove) {
            handleCaptureClick(pos);
            return;
        }

        // 放置阶段
        if (state.playerOpponent.piecesOnHand > 0) {
            handlePlacementClick(pos);
            return;
        }

        // 走子/飞行阶段
        handleMoveClick(pos);
    }

    function handlePlacementClick(pos) {
        const move = playerMoves.find(m => m.type === 'place' && m.to === pos);
        if (move) executePlayerMove(move);
    }

    function handleCaptureClick(pos) {
        const move = playerMoves.find(m => m.type === 'remove' && m.remove === pos);
        if (move) executePlayerMove(move);
    }

    function handleMoveClick(pos) {
        const board = E.getBoard();

        // 已选中棋子 → 尝试移动
        if (selectedPos !== null) {
            const move = playerMoves.find(m => m.from === selectedPos && m.to === pos);
            if (move) {
                executePlayerMove(move);
                return;
            }
            // 点击自己的其他棋子 → 切换选中
            if (board[pos] === E.TYPE_OPPONENT) {
                selectPiece(pos);
                return;
            }
            // 点击无效位置 → 取消选中
            deselectPiece();
            return;
        }

        // 未选中 → 选中自己的棋子
        if (board[pos] === E.TYPE_OPPONENT) {
            selectPiece(pos);
        }
    }

    function selectPiece(pos) {
        selectedPos = pos;
        playerMoves = E.generateLegalMoves(E.TYPE_OPPONENT);
        legalTargets = playerMoves
            .filter(m => m.from === pos)
            .map(m => m.to);
        currentLegalPlayer = E.TYPE_OPPONENT;
        renderBoard();
    }

    function resetSelection() {
        selectedPos = null;
        legalTargets = [];
        currentLegalPlayer = null;
    }

    function deselectPiece() {
        resetSelection();
        renderBoard();
    }

    async function animateAndExecute(move) {
        // 放置 / 走子 / 飞行：从起点滑动到终点
        if (move.type === 'place' || move.type === 'move' || move.type === 'fly') {
            const isWhite = move.player === E.TYPE_OPPONENT;
            const { x: x2, y: y2 } = posToSvg(move.to);

            let x1, y1;
            if (move.type === 'place') {
                // 从棋盘上方落入
                x1 = x2;
                y1 = 0;
            } else {
                const srcPiece = svgPieces.querySelector(`[data-pos="${move.from}"]`);
                if (srcPiece) srcPiece.style.display = 'none';
                const src = posToSvg(move.from);
                x1 = src.x;
                y1 = src.y;
            }

            const anim = createSvgElement('circle', {
                cx: x1, cy: y1, r: 22,
                class: `piece ${isWhite ? 'piece-white' : 'piece-black'}`,
                style: 'transition: cx 0.25s ease, cy 0.25s ease;'
            });
            svgPieces.appendChild(anim);
            await sleep(20);
            anim.setAttribute('cx', x2);
            anim.setAttribute('cy', y2);
            await sleep(280);
            anim.remove();
        }

        // 吃子动画：闪烁 + 缩小消失（仅在实际吃子时播放）
        if (move.type === 'remove' && move.remove !== null && move.remove >= 0) {
            const target = svgPieces.querySelector(`[data-pos="${move.remove}"]`);
            if (target) {
                target.classList.add('captured');
                await sleep(600);
            }
        }

        E.makeMove(move);
        renderBoard();
    }

    async function executePlayerMove(move) {
        await animateAndExecute(move);
        resetSelection();
        updateStatus();

        // 检查游戏是否结束
        if (E.isGameOver()) {
            showGameResult();
            return;
        }

        // 如果成行需要吃子，等待玩家操作（engine 已切换到 millMove）
        if (E.getRawState().millMove && E.getRawState().currentPlayer === E.TYPE_OPPONENT) {
            setMessage('选择对手棋子吃掉');
            playerMoves = E.generateLegalMoves(E.TYPE_OPPONENT);
            legalTargets = playerMoves.filter(m => m.type === 'remove').map(m => m.remove);
            currentLegalPlayer = E.TYPE_OPPONENT;
            renderBoard();
            return;
        }

        // AI 回合
        await doAITurn();
    }

    async function handleAICapture() {
        await sleep(300);
        const captureMoves = E.generateLegalMoves(E.TYPE_AI);
        if (captureMoves.length === 0) return;
        let best = null, bestScore = -Infinity;
        for (const cm of captureMoves) {
            E.makeMove(cm);
            const s = AI.evaluatePosition();
            E.undoMove();
            if (s > bestScore) { bestScore = s; best = cm; }
        }
        await animateAndExecute(best);
        updateStatus();
    }

    async function doAITurn() {
        if (E.isGameOver()) return;

        isAIThinking = true;
        setThinking(true);
        playerMoves = [];

        // 让 UI 有时间刷新
        await sleep(50);

        const result = AI.selectBestMove();

        if (!result || !result.move) {
            isAIThinking = false;
            setThinking(false);
            return;
        }

        await animateAndExecute(result.move);

        // AI 台词
        const line = Narrator.getLine(result.report, {
            tags: result.allScores.length > 0 ? result.allScores[0].tags : [],
            risk: 'low',
            description: ''
        }, result.mode);
        showAILine(line);

        updateStatus();

        // AI 成行后需要吃子
        if (E.getRawState().millMove && E.getRawState().currentPlayer === E.TYPE_AI) {
            await handleAICapture();
        }

        isAIThinking = false;
        setThinking(false);

        if (E.isGameOver()) {
            showGameResult();
            return;
        }

        // 回到玩家回合
        playerMoves = E.generateLegalMoves(E.TYPE_OPPONENT);
        updateStatus();

        if (E.getRawState().millMove) {
            setMessage('选择对手棋子吃掉');
        } else if (E.getRawState().playerOpponent.piecesOnHand === 0) {
            setMessage('轮到你，移动棋子');
        } else {
            setMessage('');
        }
    }

    // ==================== 状态面板 ====================

    function updateStatus() {
        const state = E.getRawState();
        renderDots('dots-opponent', state.playerOpponent, 'white');
        renderDots('dots-ai', state.playerAI, 'black');
        updatePhaseDisplay();
    }

    function renderDots(containerId, playerData, colorClass) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const total = 9;

        for (let i = 0; i < total; i++) {
            const dot = document.createElement('div');
            dot.className = 'dot';

            if (i < playerData.piecesOnHand) {
                dot.classList.add('hand', `dot-${colorClass}`);
            } else if (i < playerData.piecesOnHand + playerData.piecesOnBoard) {
                dot.classList.add('board', `dot-${colorClass}`);
            } else {
                dot.classList.add('lost');
            }

            container.appendChild(dot);
        }
    }

    function updatePhaseDisplay() {
        const state = E.getRawState();
        const el = document.getElementById('phase-display');
        const opp = state.playerOpponent;
        const aiLabel = DIFFICULTIES.find(d => d.key === settings.difficulty).label;

        if (state.gameOver) {
            el.textContent = state.winner === E.TYPE_OPPONENT ? '你赢了！' : `${aiLabel}获胜`;
        } else if (state.millMove) {
            el.textContent = '吃子阶段';
        } else if (opp.piecesOnHand > 0) {
            el.textContent = `放置阶段 (剩余 ${opp.piecesOnHand} 子)`;
        } else if (opp.piecesOnBoard <= 3) {
            el.textContent = '飞行阶段';
        } else {
            el.textContent = '走子阶段';
        }
    }

    function setMessage(text) {
        document.getElementById('message-display').textContent = text ? ' - ' + text : '';
    }

    function exportGameRecord() {
        const state = E.getRawState();
        const history = state.moveHistory;
        const aiLabel = DIFFICULTIES.find(d => d.key === settings.difficulty).label;
        const isPlayerFirst = settings.firstPlayer === 'opponent';
        const isPlayerWin = state.winner === E.TYPE_OPPONENT;
        const rounds = Math.floor(history.length / 2);

        // 玩家标签
        const labelOf = (player) => player === E.TYPE_OPPONENT ? '玩家' : aiLabel;
        const firstLabel = isPlayerFirst ? '玩家' : aiLabel;
        const resultLabel = isPlayerWin ? '玩家获胜' : `${aiLabel}获胜`;

        const lines = [];
        lines.push("=== Nine Men's Morris 对战记录 ===");
        lines.push(`先手：${firstLabel}（${aiLabel} vs 玩家）`);
        lines.push(`结果：${resultLabel}（第 ${rounds} 回合）`);
        lines.push('');

        // 走法列表
        for (let i = 0; i < history.length; i++) {
            const m = history[i];
            const num = String(i + 1).padStart(3);
            const name = labelOf(m.player);

            // 检测成行：当前非 remove 步，下一步是同玩家的 remove
            const next = history[i + 1];
            const formsMill = m.type !== 'remove' && next
                && next.player === m.player && next.type === 'remove';

            let desc = '';
            switch (m.type) {
                case 'place':
                    desc = `置于 ${m.to}`;
                    break;
                case 'move':
                    desc = `${m.from}→${m.to}`;
                    break;
                case 'fly':
                    desc = `${m.from}⇒${m.to}`;
                    break;
                case 'remove':
                    desc = `吃 ${labelOf(m.removedFrom)}@${m.remove}`;
                    break;
            }

            if (formsMill) desc += '，成行';
            lines.push(`${num}. ${name}  ${desc}`);
        }

        lines.push('');
        lines.push('--- 统计 ---');
        const opp = state.playerOpponent;
        const ai = state.playerAI;
        lines.push(`玩家：场上 ${opp.piecesOnBoard} / 手持 ${opp.piecesOnHand} / 被吃 ${opp.piecesLost}`);
        lines.push(`${aiLabel}：场上 ${ai.piecesOnBoard} / 手持 ${ai.piecesOnHand} / 被吃 ${ai.piecesLost}`);

        return lines.join('\n');
    }

    async function copyRecord() {
        const text = exportGameRecord();
        const btn = document.getElementById('btn-result-copy');
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = '已复制';
        } catch {
            btn.textContent = '复制失败';
        }
        setTimeout(() => { btn.textContent = '复制记录'; }, 1500);
    }

    function showGameResult() {
        const state = E.getRawState();
        const isPlayerWin = state.winner === E.TYPE_OPPONENT;
        const isPlayerFirst = settings.firstPlayer === 'opponent';

        // 标题
        const title = isPlayerWin ? '恭喜，玩家获胜！' : '哈哈，你输了！';
        document.getElementById('result-title').textContent = title;

        // 统计数据
        const rounds = Math.floor(state.moveHistory.length / 2);
        const opp = state.playerOpponent;
        const ai = state.playerAI;
        const aiLabel = DIFFICULTIES.find(d => d.key === settings.difficulty).label;
        const firstLabel = isPlayerFirst ? '玩家' : aiLabel;
        const secondLabel = isPlayerFirst ? aiLabel : '玩家';
        const firstData = isPlayerFirst ? opp : ai;
        const secondData = isPlayerFirst ? ai : opp;

        document.getElementById('result-stats').innerHTML = `
            <div><span class="stat-label">先手：</span>${firstLabel}</div>
            <div><span class="stat-label">回合数：</span>${rounds}</div>
            <div><span class="stat-label">${firstLabel}：</span>场上 ${firstData.piecesOnBoard} / 手持 ${firstData.piecesOnHand} / 被吃 ${firstData.piecesLost}</div>
            <div><span class="stat-label">${secondLabel}：</span>场上 ${secondData.piecesOnBoard} / 手持 ${secondData.piecesOnHand} / 被吃 ${secondData.piecesLost}</div>
        `;

        // 显示弹窗
        document.getElementById('game-result-modal').classList.remove('hidden');

        // Debug 模式下显示「复制记录」按钮
        const copyBtn = document.getElementById('btn-result-copy');
        copyBtn.classList.toggle('hidden', !debugMode);
        copyBtn.onclick = copyRecord;

        // AI 台词
        if (isPlayerWin) {
            showAILine('不可能...我竟然输了...');
        } else {
            showAILine('认输吧，你已经没有机会了。');
        }

        setMessage(title);
    }

    // ==================== AI 台词呈现 ====================

    function isLandscape() {
        return window.innerWidth > window.innerHeight && window.innerWidth >= 769;
    }

    function showAILine(text) {
        if (isLandscape()) {
            showBubble(text);
        } else {
            showDanmaku(text);
        }
    }

    // 弹幕（竖屏）
    function showDanmaku(text) {
        const layer = document.getElementById('danmaku-layer');
        const item = document.createElement('div');
        item.className = 'danmaku-item';
        item.textContent = text;

        // 随机纵向位置（棋盘区域的 20%-80%）
        const topPercent = 20 + Math.random() * 60;
        item.style.top = `${topPercent}%`;
        item.style.left = '100%';

        // 随机时长 8-12 秒
        const duration = 8 + Math.random() * 4;
        item.style.animationDuration = `${duration}s`;

        layer.appendChild(item);
        setTimeout(() => item.remove(), duration * 1000);
    }

    // 气泡（横屏）
    function showBubble(text) {
        const list = document.getElementById('bubble-list');
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = text;
        list.appendChild(bubble);

        // 保持最多 20 条
        while (list.children.length > 20) list.removeChild(list.firstChild);

        // 自动滚到底部
        list.scrollTop = list.scrollHeight;
    }

    // ==================== 工具 ====================

    function setThinking(on) {
        document.getElementById('dots-ai').classList.toggle('thinking', on);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== 初始化 ====================

    const DIFFICULTIES = [
        { key: 'Eco',    label: '菜鸟' },
        { key: 'Normal', label: '老手' },
        { key: 'Master', label: '大师' }
    ];

    const FIRST_PLAYERS = [
        { key: 'opponent', label: '玩家先手' },
        { key: 'ai',       label: 'AI 先手' }
    ];

    const THEMES = [
        { key: 'default',  label: '暗夜' },
        { key: 'macaron',  label: '马卡龙' }
    ];

    const DEFAULT_SETTINGS = { difficulty: 'Normal', firstPlayer: 'opponent', theme: 'default' };
    let settings = { ...DEFAULT_SETTINGS };

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('nmm-settings'));
            if (saved && DIFFICULTIES.some(d => d.key === saved.difficulty) && FIRST_PLAYERS.some(f => f.key === saved.firstPlayer)) {
                settings = { ...DEFAULT_SETTINGS, ...saved };
            }
        } catch (e) {}
    }

    function saveSettings() {
        localStorage.setItem('nmm-settings', JSON.stringify(settings));
    }

    function applySettings() {
        const diffBtn = document.getElementById('btn-difficulty');
        const firstBtn = document.getElementById('btn-first-player');
        const themeBtn = document.getElementById('btn-theme');
        diffBtn.dataset.value = settings.difficulty;
        firstBtn.dataset.value = settings.firstPlayer;
        firstBtn.textContent = FIRST_PLAYERS.find(f => f.key === settings.firstPlayer).label;

        const diffLabel = DIFFICULTIES.find(d => d.key === settings.difficulty).label;
        diffBtn.textContent = diffLabel;
        document.getElementById('label-opponent').textContent = '玩家';
        document.getElementById('label-ai').textContent = diffLabel;

        // AI 先手时，黑子行（AI）显示在上面
        document.getElementById('player-status').classList.toggle('ai-first', settings.firstPlayer === 'ai');

        // 主题
        themeBtn.dataset.value = settings.theme;
        themeBtn.textContent = THEMES.find(t => t.key === settings.theme).label;
        document.documentElement.dataset.theme = settings.theme === 'default' ? '' : settings.theme;
    }

    function cycleButton(btnId, options, callback) {
        const btn = document.getElementById(btnId);
        btn.addEventListener('click', () => {
            const curr = options.findIndex(o => o.key === btn.dataset.value);
            const next = (curr + 1) % options.length;
            btn.dataset.value = options[next].key;
            btn.textContent = options[next].label;
            callback(options[next].key);
        });
    }

    function toggleDebug() {
        debugMode = !debugMode;
        svgDebug.style.display = debugMode ? 'block' : 'none';
    }

    function newGame(overrides) {
        if (overrides) {
            if (overrides.difficulty) settings.difficulty = overrides.difficulty;
            if (overrides.firstPlayer) settings.firstPlayer = overrides.firstPlayer;
            if (overrides.theme) settings.theme = overrides.theme;
            saveSettings();
        }

        applySettings();

        const firstPlayer = settings.firstPlayer === 'ai' ? E.TYPE_AI : E.TYPE_OPPONENT;
        AI.setPerformanceMode(settings.difficulty);
        E.init({ firstPlayer });

        resetSelection();
        isAIThinking = false;

        // 隐藏结果弹窗
        document.getElementById('game-result-modal').classList.add('hidden');

        renderBoard();
        updateStatus();
        setThinking(false);

        // 清空弹幕/气泡
        document.getElementById('danmaku-layer').innerHTML = '';
        const bubbleList = document.getElementById('bubble-list');
        if (bubbleList) bubbleList.innerHTML = '';

        if (firstPlayer === E.TYPE_AI) {
            setMessage('AI 先手');
            playerMoves = [];
            doAITurn();
        } else {
            setMessage('轮到你，放置棋子');
            playerMoves = E.generateLegalMoves(E.TYPE_OPPONENT);
        }
    }

    function init() {
        initBoard();
        loadSettings();
        newGame();

        document.getElementById('btn-new-game').addEventListener('click', () => newGame());
        document.getElementById('btn-result-new-game').addEventListener('click', () => newGame());
        cycleButton('btn-difficulty', DIFFICULTIES, (val) => newGame({ difficulty: val }));
        cycleButton('btn-first-player', FIRST_PLAYERS, (val) => newGame({ firstPlayer: val }));
        cycleButton('btn-theme', THEMES, (val) => newGame({ theme: val }));

        // 双击棋盘中心切换 Debug 模式
        document.getElementById('board').addEventListener('dblclick', (e) => {
            const rect = e.target.closest('svg').getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
            if (dist < 24) toggleDebug();
        });
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', Game.init);
