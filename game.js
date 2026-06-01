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
        svgDots = document.getElementById('board-dots');           // 棋盘交点标记（24 个黑点）
        svgPositions = document.getElementById('board-positions'); // 点击热区（透明圆，捕获用户交互）
        svgPieces = document.getElementById('board-pieces');       // 棋子层（黑白棋子 + 选中态）
        svgHighlights = document.getElementById('board-highlights'); // 高亮层（可落点、吃子闪烁）
        svgDebug = document.getElementById('board-debug');         // 调试层（位置编号、AI 思考信息）

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
        const own = E.getOwn();
        const opp = E.getOpp();

        // 清空棋子层
        svgPieces.innerHTML = '';

        // 绘制棋子
        for (let i = 0; i < BOARD_SIZE; i++) {
            const isOwn = (own >> i) & 1;
            const isOpp = (opp >> i) & 1;
            if (!isOwn && !isOpp) continue;
            const { x, y } = posToSvg(i);
            const circle = createSvgElement('circle', {
                cx: x, cy: y, r: 22,
                class: `piece ${isOpp ? 'piece-white' : 'piece-black'}`,
                'data-pos': i
            });

            // 选中状态
            if (selectedPos === i) circle.classList.add('selected');
            // 可吃子状态（当前合法玩家 ≠ 该棋子归属 → 可吃）
            const isPlayerPiece = isOpp ? currentLegalPlayer === E.TYPE_OPPONENT : currentLegalPlayer === E.TYPE_AI;
            if (legalTargets.includes(i) && !isPlayerPiece) circle.classList.add('capture');

            svgPieces.appendChild(circle);
        }

        // 渲染高亮
        renderHighlights();
    }

    function renderHighlights() {
        svgHighlights.innerHTML = '';
        if (legalTargets.length === 0) return;

        const occupied = E.getOwn() | E.getOpp();
        for (const target of legalTargets) {
            // 吃子目标由棋子 .capture 样式处理，此处只画空位高亮
            if ((occupied >> target) & 1) continue;

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
        if (E.getStateView().currentPlayer !== E.TYPE_OPPONENT) return;
        if (E.isGameOver()) return;

        const state = E.getStateView();

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
        const isOppPiece = (E.getOpp() >> pos) & 1;

        // 已选中棋子 → 尝试移动
        if (selectedPos !== null) {
            const move = playerMoves.find(m => m.from === selectedPos && m.to === pos);
            if (move) {
                executePlayerMove(move);
                return;
            }
            // 点击自己的其他棋子 → 切换选中
            if (isOppPiece) {
                selectPiece(pos);
                return;
            }
            // 点击无效位置 → 取消选中
            deselectPiece();
            return;
        }

        // 未选中 → 选中自己的棋子
        if (isOppPiece) {
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
        resetSelection();
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
        if (E.getStateView().millMove && E.getStateView().currentPlayer === E.TYPE_OPPONENT) {
            playerMoves = E.generateLegalMoves(E.TYPE_OPPONENT);
            if (playerMoves.length === 0) {
                showGameResult();
                return;
            }
            setMessage('选择对手棋子吃掉');
            legalTargets = playerMoves.filter(m => m.type === 'remove').map(m => m.remove);
            currentLegalPlayer = E.TYPE_OPPONENT;
            renderBoard();
            saveGameFen();
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
            const s = AI.evaluatePosition(cm);
            E.undoMove();
            if (s > bestScore) { bestScore = s; best = cm; }
        }
        await animateAndExecute(best);
        updateStatus();
    }

    async function doAITurn() {
        if (E.isGameOver()) return;

        setThinking(true);
        playerMoves = [];

        // 走前弹幕
        const preMove = Taunt.getPreMessage(Engine.getStateView());
        showAILine(preMove.line);

        const result = await AI.selectBestMove();

        if (!result || !result.move) {
            setThinking(false);
            showAILine('[BUG] AI 无合法走法，请开新游戏。FEN: ' + Engine.toFen());
            return;
        }

        await animateAndExecute(result.move);

        // debug 信息（不受弹幕开关影响）
        if (debugMode) {
            const { depth, targetDepth, elapsed, nodeCount, topK, temperature } = result.stats;
            const topN = result.allScores.slice(0, topK);
            const debugText = topN.map((s) => {
                const m = s.move;
                const desc = m.type === 'place' ? `→${m.to}`
                    : m.type === 'remove' ? `×${m.remove}`
                    : m.type === 'fly' ? `${m.from}✈${m.to}`
                    : `${m.from}→${m.to}`;
                const eat = m.remove != null && m.type !== 'remove' ? `x${m.remove}` : '';
                return `[${desc}${eat}|${s.score}]`;
            }).join(' ');
            const timeStr = elapsed >= 1000 ? `${Math.round(elapsed / 1000)}s` : `${Math.round(elapsed)}ms`;
            const nodesStr = nodeCount >= 1000000 ? `${(nodeCount / 1000000).toFixed(1)}M` : nodeCount >= 1000 ? `${Math.round(nodeCount / 1000)}k` : `${nodeCount}`;
            const tp = elapsed > 0 ? Math.round(nodeCount / elapsed) : 0;
            showAILineRaw(`${debugText} < {D${depth}/${targetDepth} ${timeStr} ${nodesStr} ${tp}/ms T${temperature.toString().slice(0, 4)}}`);
        }

        // 走后弹幕
        const postLine = Taunt.getPostMessage(Engine.getStateView(), result.move, preMove.ctx, result.score);
        showAILine(postLine);

        updateStatus();

        // AI 成行后需要吃子
        if (E.getStateView().millMove && E.getStateView().currentPlayer === E.TYPE_AI) {
            await handleAICapture();
        }

        setThinking(false);

        if (E.isGameOver()) {
            showGameResult();
            return;
        }

        // 回到玩家回合
        playerMoves = E.generateLegalMoves(E.TYPE_OPPONENT);
        updateStatus();

        if (E.getStateView().millMove) {
            setMessage('选择对手棋子吃掉');
        } else if (E.getStateView().playerOpponent.piecesOnHand === 0) {
            setMessage('轮到你，移动棋子');
        } else {
            setMessage('');
        }

        saveGameFen();
    }

    // ==================== 状态面板 ====================

    function updateStatus() {
        const state = E.getStateView();
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
        const state = E.getStateView();
        const el = document.getElementById('phase-display');
        const opp = state.playerOpponent;
        const aiLabel = DIFFICULTIES.find(d => d.key === settings.difficulty).label;

        if (E.isGameOver()) {
            const winner = E.getWinner();
            el.textContent = winner === null ? '局面重复三次' : winner === E.TYPE_OPPONENT ? '你赢了！' : `${aiLabel}获胜`;
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
        const state = E.getStateView();
        const history = state.moveHistory;
        const aiLabel = DIFFICULTIES.find(d => d.key === settings.difficulty).label;
        const isPlayerFirst = settings.firstPlayer === 'opponent';
        const winner = E.getWinner();
        const isPlayerWin = winner === E.TYPE_OPPONENT;
        const isDraw = winner === null;
        const rounds = Math.floor(history.length / 2);

        // 玩家标签
        const labelOf = (player) => player === E.TYPE_OPPONENT ? '玩家' : aiLabel;
        const firstLabel = isPlayerFirst ? '玩家' : aiLabel;
        const resultLabel = isDraw ? '平局' : isPlayerWin ? '玩家获胜' : `${aiLabel}获胜`;

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
            btn.textContent = 'Done';
        } catch {
            btn.textContent = '复制失败';
        }
        setTimeout(() => { btn.textContent = 'LogCopy'; }, 1500);
    }

    function showGameResult() {
        clearGameFen();
        const state = E.getStateView();
        const winner = E.getWinner();
        const isPlayerWin = winner === E.TYPE_OPPONENT;
        const isDraw = winner === null;
        const isPlayerFirst = settings.firstPlayer === 'opponent';

        // 标题
        const title = isDraw ? '竟然，没输没赢！' : isPlayerWin ? '恭喜，玩家获胜！' : '哈哈，你输了！';
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
        if (!settings.danmaku) return;
        showAILineRaw(text);
    }

    function showAILineRaw(text) {
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

        // 随机纵向位置（屏幕上方 30%）
        const topPercent = Math.random() * 30;
        item.style.top = `${topPercent}%`;
        item.style.left = '100%';

        // 随机时长 8-12 秒
        const duration = 8 + Math.random() * 4;
        item.style.animationDuration = `${duration}s`;

        layer.appendChild(item);
        item.addEventListener('animationend', () => item.remove(), { once: true });
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
        isAIThinking = on;
        document.getElementById('dots-ai').classList.toggle('thinking', on);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== 初始化 ====================

    const DIFFICULTIES = [
        { key: 'Eco',    label: '菜鸟' },
        { key: 'Normal', label: '老手' },
        { key: 'Master', label: '大师' },
    ];

    const FIRST_PLAYERS = [
        { key: 'opponent', label: '玩家先手' },
        { key: 'ai',       label: 'AI 先手' }
    ];

    const THEMES = [
        { key: 'wasteland', label: '荒野余晖' },
        { key: 'fogslate',  label: '雾灰石板' },
        { key: 'dawnwarm',  label: '晨光暖灰' },
        { key: 'macaron',   label: '马卡龙' },
        { key: 'cyber',     label: '霓虹幻影' },
        { key: 'default',   label: '暗夜深空' },
    ];

    const DEFAULT_SETTINGS = { difficulty: 'Normal', firstPlayer: 'opponent', theme: 'default', danmaku: true };
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

        // AI 性能模式
        AI.setPerformanceMode(settings.difficulty);

        // 主题
        themeBtn.dataset.value = settings.theme;
        themeBtn.textContent = THEMES.find(t => t.key === settings.theme).label;
        document.documentElement.dataset.theme = settings.theme === 'default' ? '' : settings.theme;

        // 弹幕
        document.getElementById('btn-danmaku').textContent = settings.danmaku ? '开' : '关';
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
        AI.setDebugMode(debugMode);
        Taunt.configure({ debug: debugMode });

        // Debug 开启时加入恶魔选项，关闭时移除并回退
        const hasDemon = DIFFICULTIES.some(d => d.key === 'Demon');
        if (debugMode && !hasDemon) {
            DIFFICULTIES.push({ key: 'Demon', label: '恶魔' });
        } else if (!debugMode && hasDemon) {
            DIFFICULTIES.splice(DIFFICULTIES.findIndex(d => d.key === 'Demon'), 1);
            if (settings.difficulty === 'Demon') {
                settings.difficulty = 'Master';
                applySettings();
            }
        }
    }

    const FEN_KEY = 'nmm-fen';

    function saveGameFen() {
        if (!E.isGameOver()) {
            localStorage.setItem(FEN_KEY, E.toFen());
        }
    }

    function clearGameFen() {
        localStorage.removeItem(FEN_KEY);
    }

    let savedSettings = null;

    function openSettings() {
        savedSettings = { ...settings };
        document.getElementById('settings-modal').classList.remove('hidden');
        updateSettingsConfirmBtn();
    }

    function closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    }

    function cancelSettings() {
        settings = { ...savedSettings };
        applySettings();
        closeSettings();
    }

    function confirmSettings() {
        const needsReset = settings.firstPlayer !== savedSettings.firstPlayer;
        closeSettings();
        if (needsReset) {
            newGame();
        } else {
            saveSettings();
        }
    }

    function updateSettingsConfirmBtn() {
        const dirty = settings.firstPlayer !== savedSettings.firstPlayer;
        const btn = document.getElementById('btn-settings-confirm');
        btn.textContent = dirty ? 'New Game' : 'Apply';
    }

    function resetUI() {
        applySettings();
        resetSelection();
        document.getElementById('game-result-modal').classList.add('hidden');
        renderBoard();
        updateStatus();
        setThinking(false);
        document.getElementById('danmaku-layer').innerHTML = '';
        const bubbleList = document.getElementById('bubble-list');
        if (bubbleList) bubbleList.innerHTML = '';
    }

    function newGame() {
        clearGameFen();
        saveSettings();
        E.init({ firstPlayer: settings.firstPlayer === 'ai' ? E.TYPE_AI : E.TYPE_OPPONENT });
        resetUI();

        if (settings.firstPlayer === 'ai') {
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

        document.getElementById('btn-new-game').addEventListener('click', () => newGame());
        document.getElementById('btn-result-new-game').addEventListener('click', () => newGame());
        document.getElementById('panel-header').querySelector('h1').addEventListener('dblclick', (e) => {
            e.target.textContent = 'Χρόνια πολλά για τα 16α γενέθλιά σου, πριγκίπισσά μου, Andrea.';
            e.target.classList.add('birthday');
        });
        document.getElementById('btn-settings').addEventListener('click', openSettings);
        document.getElementById('btn-settings-confirm').addEventListener('click', confirmSettings);
        document.getElementById('btn-settings-cancel').addEventListener('click', cancelSettings);
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) cancelSettings();
        });
        cycleButton('btn-difficulty', DIFFICULTIES, (val) => { settings.difficulty = val; applySettings(); updateSettingsConfirmBtn(); });
        cycleButton('btn-first-player', FIRST_PLAYERS, (val) => { settings.firstPlayer = val; applySettings(); updateSettingsConfirmBtn(); });
        cycleButton('btn-theme', THEMES, (val) => { settings.theme = val; applySettings(); updateSettingsConfirmBtn(); });
        document.getElementById('btn-danmaku').addEventListener('click', () => {
            settings.danmaku = !settings.danmaku;
            applySettings();
            updateSettingsConfirmBtn();
        });
        document.getElementById('board').addEventListener('dblclick', (e) => {
            const rect = e.target.closest('svg').getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
            if (dist < 24) toggleDebug();
        });

        // 尝试从保存的 FEN 恢复棋局
        const savedFen = localStorage.getItem(FEN_KEY);
        if (savedFen) {
            try {
                E.fromFen(savedFen);
                resetUI();
                playerMoves = E.generateLegalMoves(E.TYPE_OPPONENT);
                if (playerMoves.length === 0) throw new Error('terminal position');
                if (E.getStateView().millMove) {
                    setMessage('选择对手棋子吃掉');
                    legalTargets = playerMoves.filter(m => m.type === 'remove').map(m => m.remove);
                    currentLegalPlayer = E.TYPE_OPPONENT;
                    renderBoard();
                } else {
                    setMessage('');
                }
                return;
            } catch (e) {
                localStorage.removeItem(FEN_KEY);
            }
        }

        newGame();
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', Game.init);
