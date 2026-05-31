// ========================================================
// Nine Men's Morris 毒舌弹幕 (Taunt)
// 职责：AI 走前/走后生成吐槽台词
// 架构：上下文构建 → 规则匹配（谓词返回 ID） → 查表随机选词
// 外部依赖：Engine, Evaluator
// ========================================================

const Taunt = (() => {
    const E = Engine;
    const EV = Evaluator;

    // ==================== 配置 ====================

    let config = {
        mode: 'offline',   // 'offline' | 'online'
        debug: false,
        apiKey: null,
        apiEndpoint: null,
        model: null,
    };

    // ==================== 上下文构建 ====================

    function buildContext(state, move = null, score = 0) {
        const aiData = state.playerAI;
        const oppData = state.playerOpponent;
        const { ai: aiMills, opp: oppMills } = EV.analyzeMillsBoth();
        const aiTotal = aiData.piecesOnBoard + aiData.piecesOnHand;
        const oppTotal = oppData.piecesOnBoard + oppData.piecesOnHand;

        return {
            phase: {
                ai: E.getPhase(E.TYPE_AI),
                opponent: E.getPhase(E.TYPE_OPPONENT),
            },
            pieces: {
                ai: { onBoard: aiData.piecesOnBoard, onHand: aiData.piecesOnHand, lost: aiData.piecesLost, total: aiTotal },
                opponent: { onBoard: oppData.piecesOnBoard, onHand: oppData.piecesOnHand, lost: oppData.piecesLost, total: oppTotal },
            },
            mills: { ai: aiMills, opponent: oppMills },
            mobility: { ai: EV.countMobility(E.TYPE_AI), opponent: EV.countMobility(E.TYPE_OPPONENT) },
            move: move ? { type: move.type, from: move.from, to: move.to, remove: move.remove, formedMill: state.millMove } : null,
            score,
            repetition: E.getRepetitionCount(),
            phaseBefore: null,
        };
    }

    // ==================== 谓词 ====================

    // 走前/走后
    const isPre = c => !c.move;
    const isPost = c => !!c.move;
    const captured = c => c.move && c.move.remove !== null;

    // 阶段
    const placement = c => c.phase.ai === 'PLACEMENT';
    const moving = c => c.phase.ai === 'MOVING';
    const aiFlying = c => c.phase.ai === 'FLYING';
    const oppFlying = c => c.phase.opponent === 'FLYING';
    const ai4 = c => c.pieces.ai.onBoard === 4 && c.pieces.ai.onHand === 0;
    const opp4 = c => c.pieces.opponent.onBoard === 4 && c.pieces.opponent.onHand === 0;

    // 分数段
    const scoreWinning = c => c.score >= 2000;
    const scoreAhead = c => c.score >= 50;
    const scoreEven = c => c.score > -50 && c.score < 50;
    const scoreBehind = c => c.score <= -50;
    const scoreLosing = c => c.score <= -2000;

    // 磨坊威胁
    const oppThreatened = c => c.mills.opponent.rollingForks >= 1 || c.mills.opponent.hardNearMills >= 1;
    const aiThreatened = c => c.mills.ai.rollingForks >= 1 || c.mills.ai.hardNearMills >= 1;
    const oppHasHRF = c => c.mills.opponent.hardRollingForks >= 1;
    const aiHasHRF = c => c.mills.ai.hardRollingForks >= 1;


    // ==================== 规则（只返回 ID）====================
    //
    // ID 编码：
    //   高位 0=走前，1=走后
    //   低位与阶段谓词一一对应：0=placement, 1=moving, 2=aiFlying, 3=oppFlying, 4=ai4, 5=opp4
    //
    // 匹配逻辑：收集所有命中规则的 ID → 随机抽一个 → 查 LINES 表随机选台词
    // 走前/走后互斥（isPre / isPost），各自有兜底规则覆盖全部情况

    // 半衰权重：100 > 50 > 25 > 15 > 10
    const RULES = [

        // ── 00-05 走前·阶段 ──
        { id: '00', w: 15, when: c => isPre(c) && placement(c) },
        { id: '01', w: 15, when: c => isPre(c) && moving(c) },
        { id: '02', w: 15, when: c => isPre(c) && aiFlying(c) },
        { id: '03', w: 15, when: c => isPre(c) && oppFlying(c) },
        { id: '04', w: 25, when: c => isPre(c) && ai4(c) },
        { id: '05', w: 25, when: c => isPre(c) && opp4(c) },

        // ── 06-07 走前·通用 ──
        { id: '06', w: 10, when: c => isPre(c) },
        { id: '07', w: 100, when: c => c.repetition >= 2 },

        // ── 10-15 走后·阶段 ──
        { id: '10', w: 15, when: c => isPost(c) && placement(c) },
        { id: '11', w: 15, when: c => isPost(c) && moving(c) },
        { id: '12', w: 15, when: c => isPost(c) && aiFlying(c) },
        { id: '13', w: 15, when: c => isPost(c) && oppFlying(c) },
        { id: '14', w: 25, when: c => isPost(c) && ai4(c) },
        { id: '15', w: 25, when: c => isPost(c) && opp4(c) },

        // ── 16-17 走后·通用 ──
        { id: '16', w: 10, when: c => isPost(c) },
        { id: '17', w: 100, when: c => isPost(c) && captured(c) },

        // ── 1A-1I 走后·局面 ──
        { id: '1A', w: 100, when: c => isPost(c) && scoreWinning(c) },
        { id: '1B', w: 25, when: c => isPost(c) && scoreAhead(c) },
        { id: '1C', w: 15, when: c => isPost(c) && scoreEven(c) },
        { id: '1D', w: 25, when: c => isPost(c) && scoreBehind(c) },
        { id: '1E', w: 100, when: c => isPost(c) && scoreLosing(c) },
        { id: '1F', w: 25, when: c => isPost(c) && oppThreatened(c) },
        { id: '1G', w: 25, when: c => isPost(c) && aiThreatened(c) },
        { id: '1H', w: 50, when: c => isPost(c) && oppHasHRF(c) },
        { id: '1I', w: 50, when: c => isPost(c) && aiHasHRF(c) },
    ];

    // ==================== 台词库（静态查找表）====================

    const LINES = {

        // ── 00 走前·放置阶段 ──
        '00': ['坐哪好呢？', '给大爷挑个座', '找个敞亮地儿', '慢慢挑位置', '先占个好坑', '这步不重要', '随便放一颗', '看我选哪落', '布局中，勿扰',
            'Just chillin\'', 'Where to drop?', 'Picking my throne', 'Let me cook', 'Casual placement', 'Ωραία θέση' /*Nice spot*/, 'Πού να βάλω;' /*Where to put?*/,
            'Où poser ?', 'Je prends le trône'],
        // ── 01 走前·移动阶段 ──
        '01': ['该出门遛弯了', '看看上哪吃', '我来盘一盘', '我看看该怎么走',
            'Time to stroll', 'Patrolling board', 'Let\'s hunt', 'Moving like a boss', 'Πάμε βόλτα' /*Let's stroll*/, 'Πού πάμε σήμερα;' /*Where are we going today?*/,
            'Je patrouille', 'À la chasse'],
        // ── 02 走前·己方飞行 ──
        '02': ['下一站飞哪', '这么大的世界，我却不敢乱飞', '钢铁侠也没我能飞', '我要飞起来反杀', '你困不住我了',
            'Flying mode on', '3 pieces, still king', 'Catch me if u can', 'Sky is mine', 'Πέταω ελεύθερα' /*Flying free*/, 'Nobody traps me',
            'Mode vol activé', 'Le ciel est à moi'],
        // ── 03 走前·对方飞行 ──
        '03': ['你飞得真欢', '满天飞是吧', '飞啊，继续飞', '你飞得我头晕', '刺激，太刺激', '捕鸟高手出场',
            'Fly all u want', 'Bird season', 'Keep flying loser', 'Wings won\'t save u', 'Πέτα όσο θες' /*Fly as much as you want*/, 'Θα πέσεις σύντομα' /*You'll fall soon*/,
            'Vole tant que tu peux', 'Tes ailes vont tomber'],
        // ── 04 走前·己方4子 ──
        '04': ['别催，等起飞', '四个勇士待命', '剩4个也顶住', '怎么还不吃我？', '时机快到了', '四子不服输', '感觉翅膀快长出来了', '我还能再战',
            'Almost flying', '4 left, still dangerous', 'One more and I fly', 'Don\'t underestimate 4', 'Πάω για πέταγμα' /*About to fly*/, '4 is enough',
            'Presque prêt à voler', '4 pièces dangereuses'],
        // ── 05 走前·对方4子 ──
        '05': ['不能让你飞', '你剩4个了', '困死你再说', '看我堵死你', '别想起飞', '你咋不上天啊，哦你不能', '该收割了么',
            'No flying for you', '4 left, easy prey', 'Grounded forever', 'Stay down', 'Δεν πετάς' /*You don't fly*/, 'Τελείωσες' /*You're done*/,
            'Pas de vol pour toi', 'Reste au sol'],

        // ── 06 走前兜底 ──
        '06': ['该我了么？', '轮到我了', '让我想想', '看我怎么玩', '该我出手了', '别急，我来', '有趣的开始了', '我来教你下', '别吵，我需要思考',
            'My turn baby', 'Watch this', 'Let me think', 'Here we go', 'Μία στιγμή' /*One moment*/, 'Time to shine',
            'À mon tour', 'Regarde ça'],
        // ── 07 déjà vu ──
        '07': ['等等，这个局面……我好像见过', 'déjà vu?', '历史总是惊人的相似', '这棋……是不是在循环？', '我们是不是迷路了？', '怎么有种恐怖游轮的感觉？',
            'Not again...', 'Looping?', 'History repeats', 'Deja vu intensifies', 'Πάλι το ίδιο;' /*Again the same?*/,
            'Encore ce plateau ?', 'Déjà vu'],

        // ── 10 走后·放置阶段 ──
        '10': ['先坐这吧', '随便下一手', '放轻松，到你啦', '占个好位置', '我先蹲这儿', '你猜我为什么放这？',
            'Nice spot huh', 'Planted', 'Your move kid', 'Solid placement', 'Έβαλα γερά' /*I placed strong*/,
            'Bien placé', 'À toi maintenant'],
        // ── 11 走后·移动阶段 ──
        '11': ['这一步，我也不知道会怎么样', '我想干嘛？你猜', '走一步看一步', '这步棋，我自己都没看懂', '这步有深意', '遛弯ing', '你猜我想干嘛',
            'Random flex', 'Trust the plan', 'Sneaky move', 'Πήγα βόλτα' /*Went for a walk*/, 'Deep move',
            'Coup discret', 'Je prépare le piège'],
        // ── 12 走后·己方飞行 ──
        '12': ['我飞我飞我飞飞飞', '自由飞翔ing', '你再也困不住我了', '你看过TopGun吗，靓佬汤演的', '天空才是我的极限',
            'I\'m everywhere', 'Flying god', 'No cage for me', 'Πέταγμα master', 'Can\'t catch me',
            'Je vole partout', 'Impossible à attraper'],
        // ── 13 走后·对方飞行 ──
        '13': ['让你再飞会', '放长线，掉风筝', '剩3个子了还能蹦跶', '飞吧飞吧，飞累了就下来', '风筝线在我手里', '飞得越高，摔得越惨', '鸟人也有落地时',
            'Enjoy flying', 'Crash soon', '3 pieces clown', 'Wings clipped soon', 'Πέσε κάτω' /*Fall down*/,
            'Vole petit oiseau', 'La chute arrive'],
        // ── 14 走后·己方4子 ──
        '14': ['大哥您再吃一口吧', '我蓄势待发', '这步棋，我等风来', '你以为能困住我吗？', '请叫我F4', '四颗子，也能翻盘……吗？',
            '4 still strong', 'F4 activated', 'One step from flight', 'Underdog mode', 'Μην με υποτιμάς' /*Don't underestimate me*/,
            'F4 activé', 'Toujours dangereux'],
        // ── 15 走后·对方4子 ──
        '15': ['看你往哪跑', '我就是不让你飞', '牛顿发现了地心引力，我发现你飞不起来', '要把你困在地上',
            'Grounded', 'No takeoff', 'Stay on earth', '4 and done', 'Τέλος πέταγμα' /*End of flight*/,
            'Tu restes cloué', 'Pas de décollage'],

        // ── 16 走后兜底 ──
        '16': ['来吧，继续', '嗯，轮到你了', '慢慢来，不急', '哦，今天心情不错，适合下棋', '棋盘还大着呢，随便走',
            'Your turn', 'Keep going', 'No rush', 'Fun continues', 'Πάμε παρακάτω' /*Let's continue*/,
            'À toi', 'Continue petit'],
        // ── 17 captured ──
        '17': ['磨坊转起来了，顺便带走一颗子', '三子连线，收网，吃子。一气呵成', '成行是手段，吃子才是目的', '转一圈，磨一颗', '这颗子我收下了', '拿走，谢谢！', '你的子，归我了', '谢啦，虽然不够塞牙缝', '吃一颗，少一颗',
            'One less', 'Nom nom', 'Thanks for the gift', 'Popped one', 'Σου πήρα μία' /*I took one*/, 'Gotcha!',
            'Une de moins', 'Merci pour le cadeau'],

        // ── 1A 走后·必胜 ──
        '1A': ['接下来，见证奇迹吧', '放弃挣扎吧', '接受审判吧', '输了没关系，可以重来', '就喜欢看你无可奈何的样子', '在实力面前，你只能关机', '结局已定', '你可以准备起身了', '你已经没有退路了', '认命吧',
            'GG EZ', 'Game over', 'Bow down', 'No hope left', 'Finished', 'Θα τελειώσουμε' /*We'll finish this*/,
            'Partie terminée', 'Incline-toi'],
        // ── 1B 走后·优势 ──
        '1B': ['抱歉，实力不容掩饰', '别让我啊，继续啊', '哼哼，这么轻松吗', '优势跟帅成正比', '这局稳了', '你让我的？我不信', '占上风了',
            'Too easy', 'I\'m cooking', 'Dominating', 'Crushing it', 'Είμαι καλύτερος' /*I'm better*/,
            'Trop facile', 'Je domine'],
        // ── 1C 走后·拉锯 ──
        '1C': ['这局面有点迷', '快，到你了', '感觉势均力敌', '谁赢还不一定', '这棋有意思', '五五开',
            'Close one', 'Back and forth', 'Interesting', '50/50', 'Μάχη' /*Battle*/,
            'Combat serré'],
        // ── 1D 走后·劣势 ──
        '1D': ['这步棋走得有点……', '感觉不太好', '我觉得我在布局', '闻到了危险的味道', '这局有点悬', '我需要反击了', '鹿死谁手尚未可知',
            'Hmm tricky', 'Not ideal', 'Still fighting', 'Comeback loading', 'Πίεση' /*Pressure*/,
            'Pas idéal', 'Retour en force'],
        // ── 1E 走后·必死 ──
        '1E': ['我再努力一下，感觉还有救……吧', '这局能不算吗', '我裂开了', '谁来管管这个人', '我的错，我反思', '你赢了行吧', '大不了重开', '我知道错了，不该挑战Andrea的', '你欺负我，我要告诉你爸爸',
            'I\'m cooked', 'Rip me', 'Andrea, my Queen.', 'Rematch?', 'Andrea, η Βασίλισσά μου.', 'Πάω σπίτι' /*I'm going home*/,
            'Je suis cuit', 'Rematch ?'],

        // ── 1F 走后·对手有 rf ──
        '1F': ['雕虫小技', '我得小心了', '你把叉子都拿上来了啊', '这套路我懂',
            'Cute fork', 'Nice try', 'Saw that', 'Not bad kid',
            'Jolie fourchette', 'Bien essayé'],
        // ── 1G 走后·己方有 rf ──
        '1G': ['默默拿出我吃饭的家伙', '来看我的表演', '感觉这波吃定了',
            'Fork time', 'Watch this', 'Double trouble', 'Ετοιμάζομαι' /*I'm getting ready*/,
            'Fourchette activée', 'Regarde-moi'],
        // ── 1H 走后·对手有 hrf ──
        '1H': ['我看见了，奈何防不住', '大侠手下留情', '这波我认栽', '防不住，真的防不住', '竟然让你链成了',
            'Oof hard fork', 'You got me', 'Dangerous',
            'Respect', 'Tu m\'as eu'],
        // ── 1I 走后·己方有 hrf ──
        '1I': ['齿轮滚动时，没有人能逃过被碾碎的结局', '我们今天学习链式反应', '这波稳了', '金叉出鞘，非死即伤',
            'Chain reaction', 'Unstoppable', 'Crushing fork', 'Game ender', 'Θα τους φάω όλους' /*I'll eat them all*/,
            'Réaction en chaîne', 'Inarrêtable'],
    };

    // ==================== 匹配引擎 ====================

    /** 收集命中 ID → 加权随机选 → 查表随机选台词（去重） */
    let lastLine = '';
    function pickLine(ctx) {
        let totalWeight = 0;
        const hits = [];
        for (let i = 0; i < RULES.length; i++) {
            if (RULES[i].when(ctx)) {
                const w = RULES[i].w || 1;
                totalWeight += w;
                hits.push({ id: RULES[i].id, w });
            }
        }
        if (hits.length === 0) return '好像死机了';
        const r = Math.random() * totalWeight;
        let acc = 0, id = hits[0].id;
        for (let i = 0; i < hits.length; i++) {
            acc += hits[i].w;
            if (r < acc) { id = hits[i].id; break; }
        }
        const lines = LINES[id];
        let line = lines[Math.floor(Math.random() * lines.length)];
        if (line === lastLine && lines.length > 1) {
            line = lines[Math.floor(Math.random() * lines.length)];
        }
        lastLine = line;

        if (config.debug) {
            const summary = hits.map(h => `${h.id}:${h.w}`).join(' ; ');
            console.log(`[Taunt] { ${summary} } → [${id}] → ${line}  hash=${E.getStateView().posHash}`);
        }

        return line;
    }

    // ==================== 公开接口 ====================

    function configure(opts) { Object.assign(config, opts); }

    function getPreMessage(state) {
        const score = EV.evaluate(0, null);
        const ctx = buildContext(state, null, score);
        const line = pickLine(ctx);
        return { line, ctx };
    }

    function getPostMessage(state, move, preCtx, score) {
        const ctx = buildContext(state, move, score);
        ctx.phaseBefore = preCtx.phase;
        return pickLine(ctx);
    }

    return {
        configure,
        getPreMessage,
        getPostMessage,
        _RULES: RULES,
        _LINES: LINES,
    };
})();
