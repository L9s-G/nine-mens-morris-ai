// ========================================================
// Nine Men's Morris 语义叙述者 (Narrator)
// 版本：v3.0 - 三层标签体系
// 标签分类：
//   Layer 1 位置标签：走前评估，描述棋盘局面特征
//   Layer 2 走法标签：走后评估，描述走法战术性质
//   Layer 3 合成标签：两阶段合并后推导的高层语义
// 台词匹配：合成标签 → 组合标签 → 单标签 → 模式回退
// ========================================================

const Narrator = (() => {
    const E = Engine;

    // ==================== 局面评估函数（自包含） ====================

    const WEIGHTS = {
        force:            1,
        mobility:         3,
        threat:          10,
        fork:            50,
        mill:            40,
        nearMill:        20,
        opponentNearMill:-30,
        flyThreat:       50,
        desperation:     20
    };

    function countMobility(player) {
        const state = E.getStateView();
        const p = player === E.TYPE_OPPONENT ? state.playerOpponent : state.playerAI;
        const isFlying = p.piecesOnHand === 0 && p.piecesOnBoard === 3;
        const isPlacement = p.piecesOnHand > 0;
        const board = state.board;

        if (isPlacement) {
            let count = 0;
            for (let i = 0; i < E.BOARD_SIZE; i++) {
                if (board[i] === null) count++;
            }
            return count;
        }

        let count = 0;
        for (let i = 0; i < E.BOARD_SIZE; i++) {
            if (board[i] !== player) continue;
            if (isFlying) {
                for (let j = 0; j < E.BOARD_SIZE; j++) {
                    if (board[j] === null) count++;
                }
            } else {
                const neighbors = E.NEIGHBORS[i];
                for (let j = 0; j < neighbors.length; j++) {
                    if (board[neighbors[j]] === null) count++;
                }
            }
        }
        return count;
    }

    function countMills(player) {
        const board = E.getStateView().board;
        let count = 0;
        for (let i = 0; i < E.MILLS.length; i++) {
            const mill = E.MILLS[i];
            if (board[mill[0]] === player && board[mill[1]] === player && board[mill[2]] === player) count++;
        }
        return count;
    }

    function analyzeFormationTension(player) {
        const opp = player === E.TYPE_OPPONENT ? E.TYPE_AI : E.TYPE_OPPONENT;
        const board = E.getStateView().board;

        let playerThreats = 0;
        let oppThreats = 0;
        const playerForkMap = new Array(24).fill(0);
        const oppForkMap = new Array(24).fill(0);

        for (let i = 0; i < E.MILLS.length; i++) {
            const [a, b, c] = E.MILLS[i];
            const vals = [board[a], board[b], board[c]];

            let pCount = 0, oCount = 0, emptyPos = -1;
            for (let j = 0; j < 3; j++) {
                if (vals[j] === player) pCount++;
                else if (vals[j] === opp) oCount++;
                else emptyPos = [a, b, c][j];
            }

            if (pCount === 2 && oCount === 0 && emptyPos !== -1) {
                playerThreats++;
                playerForkMap[emptyPos]++;
            }
            if (oCount === 2 && pCount === 0 && emptyPos !== -1) {
                oppThreats++;
                oppForkMap[emptyPos]++;
            }
        }

        let playerForks = 0, oppForks = 0;
        for (let i = 0; i < 24; i++) {
            if (playerForkMap[i] >= 2) playerForks++;
            if (oppForkMap[i] >= 2) oppForks++;
        }

        return {
            playerThreats, oppThreats, playerForks, oppForks,
            tensionScore: (playerThreats + playerForks * 3) - (oppThreats + oppForks * 3)
        };
    }

    function computeBoardScore(player) {
        const state = E.getStateView();
        const playerData = player === E.TYPE_AI ? state.playerAI : state.playerOpponent;
        const oppData = player === E.TYPE_AI ? state.playerOpponent : state.playerAI;
        const opp = player === E.TYPE_AI ? E.TYPE_OPPONENT : E.TYPE_AI;

        const phaseFactor = 1 - (Math.max(playerData.piecesOnHand, oppData.piecesOnHand) / 9);
        const forceW = WEIGHTS.force * (1 - phaseFactor * 0.3);
        const mobilityW = WEIGHTS.mobility * (1 + phaseFactor * 2);

        const forceDiff = (playerData.piecesOnBoard + playerData.piecesOnHand) - (oppData.piecesOnBoard + oppData.piecesOnHand);
        const mobilityDiff = countMobility(player) - countMobility(opp);

        const playerTension = analyzeFormationTension(player);
        const oppTension = analyzeFormationTension(opp);
        const threatDiff = playerTension.playerThreats - oppTension.playerThreats;
        const nearMillBonus = WEIGHTS.nearMill * playerTension.playerThreats + WEIGHTS.opponentNearMill * oppTension.playerThreats;

        const playerMills = countMills(player);
        const oppMills = countMills(opp);
        const millDiff = playerMills - oppMills;

        const playerFlying = playerData.piecesOnBoard <= 3 && playerData.piecesOnHand === 0;
        const oppFlying = oppData.piecesOnBoard <= 3 && oppData.piecesOnHand === 0;
        let playerForkW = WEIGHTS.fork, oppForkW = WEIGHTS.fork;
        if (playerFlying && oppFlying) { playerForkW = 0; oppForkW = 0; }
        else if (oppFlying) { playerForkW = 60; oppForkW = 0; }
        else if (playerFlying) { playerForkW = 0; oppForkW = 60; }

        let flyThreat = 0;
        if (oppFlying) flyThreat += WEIGHTS.flyThreat;
        if (playerFlying) flyThreat -= WEIGHTS.flyThreat;

        let desperationBonus = 0;
        if (forceDiff <= -3) desperationBonus += WEIGHTS.desperation;

        return (
            forceW * forceDiff +
            mobilityW * mobilityDiff +
            WEIGHTS.threat * threatDiff +
            playerForkW * playerTension.playerForks - oppForkW * oppTension.playerForks +
            WEIGHTS.mill * millDiff +
            nearMillBonus +
            flyThreat +
            desperationBonus
        );
    }

    // ==================== 词库（按层组织） ====================

    const DIALOGUE = {

        // ── Layer 1: 位置标签台词（走前评估生成） ──
        position: {
            PHASE_PLACEMENT: [
                "开局而已，看看坐哪合适。",
                "先占个坑，后面再说。",
                "慢慢放，慢慢占，不急。",
                "人越来越多了，我得找个宽敞地儿。",
                "棋盘还空着，先逛逛。",
                "这一步不重要？那你再想想。"
            ],
            PHASE_FLYING: [
                "放心吧，我不会轻易放你飞的。",
                "我就是不吃最后一口，你奈我何。",
                "你以为逆风翻盘的机会到了？没风，哈哈。",
                "空域管制，禁止起飞。",
                "你能耐，你飞过去啊。",
                "留你一颗子，是让你看着自己输。",
                "飞？想得美。",
                "最后三颗子的滋味如何？慢慢享受。"
            ],
            FORCE_AHEAD: [],
            FORCE_BEHIND: [],
            PRESSURE: [
                "巨大的包围圈，正在收缩。",
                "围魏，不一定为了救赵，我就是单纯想围。",
                "走自己的路，让别人无路可走。",
                "收紧绞索，你无处可逃。",
                "你的活动空间正在蒸发。",
                "窒息的感觉如何？",
                "还有地方走吗？我帮你数数。",
                "每走一步，路就少一条。",
                "不是我想围你，是你自己走进来的。",
                "棋盘很大，但属于你的角落越来越小。"
            ],
            THREATENING: [
                "这步棋平平无奇？你自己品。",
                "我什么都没说，你什么都没看到。",
                "安静。别打扰我布局。",
                "你没发现？那最好。",
                "走着走着，磨坊就来了。"
            ],
            SPACE_CONTROL: [
                "多一条路，多一分活路。",
                "条条大路通罗马，我站的这条最宽。",
                "进可攻，退可守。",
                "做人留一线，走路不被堵。",
                "这个位置，四通八达。",
                "我不急，路还长。"
            ],
            DOMINANT: []
        },

        // ── Layer 2: 走法标签台词（走后评估生成） ──
        move: {
            FORMED_MILL: [],
            CAPTURED: [],
            BLOCKED: [
                "想在这里成行？太天真了。",
                "你的如意算盘，我早已看穿。",
                "此路不通。",
                "这条线，到此为止。",
                "你差的那一步，我帮你堵上了。",
                "磨坊？不存在的。",
                "你的计划，我已经读完了。",
                "封死。下一个。"
            ],
            RISKY: [
                "你的磨坊我看见了，但我的棋更大。",
                "先让你得意一下，君子报仇十轮不晚。",
                "你以为这样我就会怕吗？等着。",
                "厉害，没挡住。但你别高兴太早。",
                "这一步我吞下了，下一步轮到你颤抖。"
            ],
            TRICKY: [
                "这步棋我大意了，你敢吃吗？",
                "看来我也有计算失误的时候，这一子算我送你的。",
                "哎呀，走错了。你不会放过这个机会吧？",
                "这一步...是我的破绽？还是你的坟墓？"
            ]
        },

        // ── Layer 3: 合成标签台词（两阶段合并后推导） ──
        derived: {
            // 全面进攻：兵力优势 + 成磨或吃子
            ATTACKING: [
                "全面进攻，你挡不住。",
                "优势在我，磨坊已开。",
                "火力建制碾压，你就认了吧。",
                "收割的时间到了。"
            ],
            // 空间绞杀：对手受限 + 封锁或空间控制
            PRESSING: [
                "路越走越宽，网越收越紧。",
                "我的路四通八达，你的路少了一条。",
                "布局中，顺便断你一条路。",
                "占住路口，进可攻退可守。"
            ],
            // 追杀收割：对手飞行或兵力落后 + 吃子
            HUNTING: [
                "子少了，路断了，对了你还有翅膀……哦不好意思。",
                "吃一颗子而已，你慌什么？又飞不走。",
                "你的棋子越来越少，路也越来越少，巧了。"
            ],
            // 布局成型：磨坊威胁 + 空间控制
            SETTING_UP: [
                "多一条路，磨坊就近一步。",
                "这一步布局，三手之后你就懂了。",
                "路越走越宽，网越收越紧。"
            ],
            // 劣势防守：兵力落后 + 成功封锁
            DEFENDING: [
                "挡住了。现在轮到我了。",
                "落后不代表等死，这一手你没想到吧。",
                "守住了，才有资格反击。"
            ],
            // 以险换速：冒险 + 磨坊威胁或兵力优势
            GAMBLING: [
                "你的磨坊我看在眼里，但我的棋更大。",
                "先让你得意一下，君子报仇十轮不晚。",
                "你以为这样我就会怕吗？等着。",
                "你有后手？我也有。看谁先到。"
            ]
        },

        // ── 策略模式回退台词 ──
        mode: {
            EXPANSION: [
                "哦，今天心情不错，适合下棋。",
                "来吧，继续。",
                "嗯，轮到你了。",
                "慢慢来，不急。",
                "棋盘还大着呢，随便走。"
            ],
            SUPPRESSION: [
                "我都选择困难症了，你是正困难选择中吧。",
                "路太多了，走哪条好呢？你帮我想想？",
                "你那边挺挤的吧？我这边挺宽敞。",
                "我走哪都行，你……还有几条路？",
                "随便走走，反正不急。你呢？"
            ],
            DECISIVE: [
                "我觉得我还能救一救。",
                "我输了，我们之间就结束了，你舍得吗？",
                "做人留一线，他朝好相见。",
                "你先别得意，也许或者可能我会突然翻盘……吧……",
                "等等，让我想想，一定有办法的。",
                "你赢了棋，但你赢不了我的心。",
                "别催，我在想绝地反击的剧本。",
                "这一步我先记下，秋后算账。",
                "你笑吧，反正我也拦不住。",
                "人生如棋，落子无悔……但我悔了。",
                "大不了从头再来。你赶紧的，料理后事我们重开。",
                "你别逼我，逼我我就……认输。",
                "输给你不丢人……吧？",
                "我承认你厉害，但你能不能别那么厉害？"
            ]
        },

        // ── 组合标签台词（多标签精确匹配） ──
        combo: {
            // 4标签：空间控制+磨坊威胁+对手飞行+兵力优势
            'SPACE_CONTROL+THREATENING+PHASE_FLYING+FORCE_AHEAD': [
                "路在我脚下，磨坊在眼前，你飞不起来。",
                "四通八达，磨坊将成，你已经没路了。",
                "我的路越走越宽，你的路越走越窄。"
            ],
            // 4标签：空间控制+对手飞行+封锁+兵力优势
            'SPACE_CONTROL+PHASE_FLYING+BLOCKED+FORCE_AHEAD': [
                "我的路四通八达，你的翅膀折了，退路也断了。",
                "进退自如的是我，走投无路的是你。",
                "你已经无路可走了。"
            ],
            // 3标签：空间控制+磨坊威胁+布局
            'SPACE_CONTROL+THREATENING+PHASE_PLACEMENT': [
                "多一条路，磨坊就近一步。",
                "这一步布局，三手之后你就懂了。",
                "路越走越宽，网越收越紧。"
            ],
            // 3标签：空间控制+磨坊威胁+对手飞行
            'SPACE_CONTROL+THREATENING+PHASE_FLYING': [
                "路在我这边，磨坊在路上，你的翅膀也折了。",
                "我越走越宽，你越走越死。",
                "进退有路的是我，插翅难飞的是你。"
            ],
            // 3标签：对手飞行+封锁+兵力优势
            'PHASE_FLYING+BLOCKED+FORCE_AHEAD': [
                "你说你还有几步可走？我帮你数，零。",
                "别看我，看棋盘。嗯，没路了。",
                "天空是你的？不，天空是我的。地也是。"
            ],
            // 3标签：空间控制+封锁+布局
            'SPACE_CONTROL+BLOCKED+PHASE_PLACEMENT': [
                "我的路越走越宽，你的路少了一条。",
                "布局中，顺便断你一条路。",
                "占住路口，进可攻退可守。"
            ],
            // 3标签：磨坊威胁+冒险+兵力优势
            'THREATENING+RISKY+FORCE_AHEAD': [
                "你的磨坊我看在眼里，但我的更快。",
                "先让你吃，我的线已经走不回去了。",
                "你有后手？我也有。看谁先到。"
            ],
            // 3标签：吃子+对手飞行+封锁
            'CAPTURED+PHASE_FLYING+BLOCKED': [
                "子少了，路断了，对了你还有翅膀……哦不好意思。",
                "吃一颗子而已，你慌什么？又飞不走。",
                "你的棋子越来越少，路也越来越少，巧了。"
            ],
            // 2标签：成磨+吃子（引擎中必然成对出现）
            'FORMED_MILL+CAPTURED': [
                "磨坊转起来了，顺便带走你一颗子。",
                "三子连线，收网，吃子。一气呵成。",
                "成行是手段，吃子才是目的。",
                "磨坊开了，你的棋子少了一颗。",
                "转一圈，磨一颗。"
            ],
            // 2标签：磨坊威胁+对手飞行
            'THREATENING+PHASE_FLYING': [
                "差一步成行，对了你好像飞不了？真巧。",
                "磨坊快好了，你慢慢走，反正哪也去不了。",
                "这条线你看着办。能飞的话早就飞了吧？"
            ],
            // 2标签：磨坊威胁+兵力优势（劣势中的一线生机）
            'THREATENING+FORCE_AHEAD': [
                "差一子成行，这是我最后的机会。",
                "落后又怎样？这条线还没断。",
                "被逼到绝路，反而看到了光。"
            ],
            // 2标签：吃子+封锁
            'CAPTURED+BLOCKED': [
                "吃子是假，封路是真。",
                "你的棋子我收下，你的路线也到此为止。",
                "一子落，两处绝。"
            ],
            // 2标签：封锁+对手飞行
            'BLOCKED+PHASE_FLYING': [
                "挡住了。现在轮到我了。",
                "落后不代表等死，这一手你没想到吧。",
                "守住了，才有资格反击。"
            ],
            // 2标签：封锁+兵力优势
            'BLOCKED+FORCE_AHEAD': [
                "挡住了。现在轮到我了。",
                "落后不代表等死，这一手你没想到吧。",
                "守住了，才有资格反击。"
            ],
            // 2标签：空间控制+兵力优势
            'SPACE_CONTROL+FORCE_AHEAD': [
                "进可攻退可守，这一击你躲不掉。",
                "路宽一寸，命长一截——你的命。",
                "四通八达，致命一击。"
            ],
            // 2标签：空间控制+对手飞行
            'SPACE_CONTROL+PHASE_FLYING': [
                "进可攻退可守，这一击你躲不掉。",
                "路宽一寸，命长一截——你的命。",
                "四通八达，致命一击。"
            ],
            // 2标签：冒险+兵力优势
            'RISKY+FORCE_AHEAD': [
                "你有反击？我知道。但这步棋你拦不住。",
                "吞下这口气，下一回合你就是猎物。",
                "让你一步又如何，结局已经写好了。"
            ],
            // 2标签：冒险+对手飞行
            'RISKY+PHASE_FLYING': [
                "你有反击？我知道。但这步棋你拦不住。",
                "吞下这口气，下一回合你就是猎物。",
                "让你一步又如何，结局已经写好了。"
            ],
            // 2标签：磨坊威胁+冒险
            'THREATENING+RISKY': [
                "你的磨坊我看在眼里，但这条线我先走完。",
                "你可以反击，但挡不住我成行。",
                "明知山有虎，偏向虎山行——因为我更快。"
            ]
        }
    };

    // 情绪修饰符（根据 minimax 评分调整语气）
    const EMOTION_MODIFIERS = {
        arrogant: {  // 大幅优势 (score >= 500)
            prefix: ["哈哈，", "醒醒，", "呵，", ""],
            suffix: ["你尽力了吗？", "这就是你的全部实力吗？", "实力的差距不容置疑。", "我等着你变身啊。"]
        },
        confident: {  // 小幅优势 (score 100~499)
            prefix: ["嗯……", "咳，", "哎呀，", ""],
            suffix: ["别弃垒。", "我什么都没说。", "你加油。", "继续继续。", "挺好的挺好的。"]
        },
        neutral: {  // 均势 (score -99~99)
            prefix: ["", "", ""],
            suffix: ["", "", ""]
        },
        cautious: {  // 小幅劣势 (score -399~-100)
            prefix: ["嗯？", "哦？", "行吧，", ""],
            suffix: ["你先别急。", "这才哪到哪。", "你当我会怕？", "还早呢。", "来啊。"]
        },
        desperate: {  // 大幅劣势 (score < -400)
            prefix: ["啊这……", "不妙。", "等等等等，", ""],
            suffix: ["救救我。", "谁来管管这个人。", "我裂开了。", "这局能不算吗，你撤单吧，重开。", "我的错，我反思。"]
        }
    };

    // ==================== 情绪判断 ====================

    function getEmotion(score) {
        if (score >= 500) return 'arrogant';
        if (score >= 100) return 'confident';
        if (score >= -100) return 'neutral';
        if (score >= -400) return 'cautious';
        return 'desperate';
    }

    function randomPick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ==================== 匹配优先级 ====================

    // 合成标签优先级（叙事特异性从高到低）
    const DERIVED_PRIORITY = [
        'ATTACKING', 'HUNTING', 'PRESSING', 'SETTING_UP', 'DEFENDING', 'GAMBLING'
    ];

    // 组合标签优先级（4标签 > 3标签 > 2标签，同级内按叙事价值排序）
    const COMBO_PRIORITY = [
        // 4标签
        'SPACE_CONTROL+THREATENING+PHASE_FLYING+FORCE_AHEAD',
        'SPACE_CONTROL+PHASE_FLYING+BLOCKED+FORCE_AHEAD',
        // 3标签
        'SPACE_CONTROL+THREATENING+PHASE_PLACEMENT',
        'SPACE_CONTROL+THREATENING+PHASE_FLYING',
        'PHASE_FLYING+BLOCKED+FORCE_AHEAD',
        'SPACE_CONTROL+BLOCKED+PHASE_PLACEMENT',
        'THREATENING+RISKY+FORCE_AHEAD',
        'CAPTURED+PHASE_FLYING+BLOCKED',
        // 2标签
        'FORMED_MILL+CAPTURED',
        'THREATENING+PHASE_FLYING',
        'THREATENING+FORCE_AHEAD',
        'CAPTURED+BLOCKED',
        'BLOCKED+PHASE_FLYING',
        'BLOCKED+FORCE_AHEAD',
        'SPACE_CONTROL+FORCE_AHEAD',
        'SPACE_CONTROL+PHASE_FLYING',
        'RISKY+FORCE_AHEAD',
        'RISKY+PHASE_FLYING',
        'THREATENING+RISKY'
    ];

    // 单标签回退优先级（按战术重要性排序）
    const TAG_PRIORITY = [
        'FORMED_MILL', 'CAPTURED', 'PRESSURE', 'BLOCKED',
        'FORCE_AHEAD', 'FORCE_BEHIND', 'THREATENING', 'PHASE_FLYING',
        'SPACE_CONTROL', 'PHASE_PLACEMENT', 'RISKY'
    ];

    // ==================== 台词匹配 ====================

    function hasCombo(tags, comboKey) {
        const required = comboKey.split('+');
        return required.every(tag => tags.includes(tag));
    }

    function getOfflineLine(tags, mode, score) {
        const emotion = getEmotion(score);
        const modifier = EMOTION_MODIFIERS[emotion];

        let line = '';

        // 1. 合成标签（最高优先级）
        for (const tag of DERIVED_PRIORITY) {
            if (tags.includes(tag) && DIALOGUE.derived[tag] && DIALOGUE.derived[tag].length > 0) {
                line = randomPick(DIALOGUE.derived[tag]);
                break;
            }
        }

        // 2. 组合标签
        if (!line) {
            for (const comboKey of COMBO_PRIORITY) {
                if (hasCombo(tags, comboKey) && DIALOGUE.combo[comboKey]) {
                    line = randomPick(DIALOGUE.combo[comboKey]);
                    break;
                }
            }
        }

        // 3. 单标签回退
        if (!line) {
            for (const tag of TAG_PRIORITY) {
                const pool = DIALOGUE.position[tag] || DIALOGUE.move[tag];
                if (tags.includes(tag) && pool && pool.length > 0) {
                    line = randomPick(pool);
                    break;
                }
            }
        }

        // 4. 模式回退
        if (!line) {
            const modeLines = DIALOGUE.mode[mode] || DIALOGUE.mode.EXPANSION;
            line = randomPick(modeLines);
        }

        // 情绪修饰
        const prefix = randomPick(modifier.prefix);
        const suffix = randomPick(modifier.suffix);

        return prefix + line + suffix;
    }

    // ==================== 在线 Prompt 生成 ====================

    function createPrompt(bestMove, mode, context) {
        const emotion = getEmotion(bestMove.score);

        return {
            role: "system",
            content: `你是一位Nine Men's Morris宗师，性格冷酷而自信。

当前博弈状态：
- 阶段：${context.phase}
- 策略模式：${mode}
- 兵力差：${context.forceDiff}（正=你优势，负=对手优势）
- 机动性差值：${context.mobilityGap}
- 情绪基调：${emotion}

你刚做出的走法：${bestMove.description || ''}
走法标签：${(bestMove.tags || []).join(', ')}

要求：
1. 生成一句简短（20字以内）的宗师点评
2. 语气符合当前情绪基调（优势时傲慢，劣势时冷静，均势时深沉）
3. 如果标签包含 TRICKY，假装这是失误，诱导对手上钩
4. 不要提及具体的棋盘坐标或技术细节`
        };
    }

    // ==================== 共享上下文 ====================

    function _getBoardContext() {
        const state = E.getStateView();
        const aiData = state.playerAI;
        const oppData = state.playerOpponent;
        const score = computeBoardScore(E.TYPE_AI);
        return {
            state, aiData, oppData, score,
            emotion: getEmotion(score),
            forceDiff: (aiData.piecesOnBoard + aiData.piecesOnHand) - (oppData.piecesOnBoard + oppData.piecesOnHand),
            phase: E.getPhase(E.TYPE_AI),
            oppPhase: E.getPhase(E.TYPE_OPPONENT),
            oppMobility: countMobility(E.TYPE_OPPONENT)
        };
    }

    // ==================== Layer 1: 位置标签（走前） ====================

    function _evaluatePositionTags(ctx) {
        const tags = [];

        if (ctx.phase === E.PHASE_PLACEMENT) tags.push('PHASE_PLACEMENT');

        if (ctx.oppData.piecesOnBoard <= 4 && ctx.oppData.piecesOnHand === 0) {
            tags.push('PHASE_FLYING');
        }

        if (ctx.oppPhase === E.PHASE_FLYING || ctx.forceDiff >= 2) {
            tags.push('FORCE_AHEAD');
        }
        if (ctx.forceDiff <= -2) tags.push('FORCE_BEHIND');

        if (ctx.oppMobility <= 4) tags.push('PRESSURE');

        // SPACE_CONTROL：AI 占据高联通位置
        const board = ctx.state.board;
        for (let i = 0; i < E.BOARD_SIZE; i++) {
            if (board[i] !== E.TYPE_AI) continue;
            const neighbors = E.NEIGHBORS[i];
            let emptyN = 0;
            for (let j = 0; j < neighbors.length; j++) {
                if (board[neighbors[j]] === null) emptyN++;
            }
            if (emptyN >= 2) { tags.push('SPACE_CONTROL'); break; }
        }

        // THREATENING：AI 有近磨威胁
        const tension = analyzeFormationTension(E.TYPE_AI);
        if (tension.playerThreats > 0) tags.push('THREATENING');

        // DOMINANT：压制性优势
        if (tags.includes('PRESSURE') && (tags.includes('SPACE_CONTROL') || tags.includes('THREATENING'))) {
            tags.push('DOMINANT');
        }

        // 模式判定
        let mode = 'EXPANSION';
        if (tags.includes('PHASE_FLYING') || tags.includes('FORCE_AHEAD') || tags.includes('FORCE_BEHIND')) mode = 'DECISIVE';
        else if (tags.includes('PRESSURE')) mode = 'SUPPRESSION';

        return { tags, emotion: ctx.emotion, mode, score: ctx.score };
    }

    // ==================== Layer 2: 走法标签（走后） ====================

    function _evaluateMoveTags(ctx, move) {
        const tags = [];

        if (ctx.state.millMove) tags.push('FORMED_MILL');
        if (move.remove !== null) tags.push('CAPTURED');

        // BLOCKED / RISKY：undo 比较走前走后对手的吃子机会
        if (move.type !== 'remove') {
            const opp = E.TYPE_OPPONENT;
            const oppMovesAfter = E.generateLegalMoves(opp);
            let capturesAfter = 0;
            for (let i = 0; i < oppMovesAfter.length; i++) {
                if (oppMovesAfter[i].remove !== null) capturesAfter++;
            }

            E.undoMove();
            const oppMovesBefore = E.generateLegalMoves(opp);
            let capturesBefore = 0;
            for (let i = 0; i < oppMovesBefore.length; i++) {
                if (oppMovesBefore[i].remove !== null) capturesBefore++;
            }
            E.makeMove(move);

            if (capturesAfter < capturesBefore) tags.push('BLOCKED');
            if (capturesAfter > capturesBefore) tags.push('RISKY');
        }

        // TRICKY：看似冒险但实际优势
        if (tags.includes('RISKY') && ctx.forceDiff >= 1) {
            tags.push('TRICKY');
        }

        return tags;
    }

    // ==================== Layer 3: 合成标签推导 ====================

    function _deriveTags(allTags) {
        const derived = [];

        const has = t => allTags.includes(t);

        if (has('FORCE_AHEAD') && (has('FORMED_MILL') || has('CAPTURED'))) derived.push('ATTACKING');
        if (has('PRESSURE') && (has('BLOCKED') || has('SPACE_CONTROL'))) derived.push('PRESSING');
        if ((has('PHASE_FLYING') || has('FORCE_AHEAD')) && has('CAPTURED')) derived.push('HUNTING');
        if (has('THREATENING') && has('SPACE_CONTROL')) derived.push('SETTING_UP');
        if (has('FORCE_BEHIND') && has('BLOCKED')) derived.push('DEFENDING');
        if (has('RISKY') && (has('THREATENING') || has('FORCE_AHEAD'))) derived.push('GAMBLING');

        return derived;
    }

    // ==================== 两阶段公开接口 ====================

    /**
     * 走前评估：分析当前局面，返回台词 + 标签 + 情绪
     * 在 AI 思考前调用
     */
    function assessPosition() {
        const ctx = _getBoardContext();
        const { tags, emotion, mode, score } = _evaluatePositionTags(ctx);

        const line = getOfflineLine(tags, mode, score);
        return { line, tags, emotion, score };
    }

    /**
     * 走后吐槽：评估 AI 刚走的棋，返回台词
     * 在 AI 走法执行后调用
     */
    function reactToMove(move, score, positionTags = []) {
        const ctx = _getBoardContext();
        const moveTags = _evaluateMoveTags(ctx, move);

        // 合并走前标签 + 走法标签（去重）
        const allTags = [...new Set([...positionTags, ...moveTags])];

        // Layer 3: 推导合成标签
        const derived = _deriveTags(allTags);
        allTags.push(...derived);

        // 从合并标签推断模式
        let mode = 'EXPANSION';
        if (allTags.includes('PHASE_FLYING') || allTags.includes('FORCE_AHEAD') || allTags.includes('FORCE_BEHIND')) mode = 'DECISIVE';
        else if (allTags.includes('PRESSURE')) mode = 'SUPPRESSION';

        return getOfflineLine(allTags, mode, score);
    }

    // ==================== 旧接口（保留兼容） ====================

    function getLine(bestMove, mode, isOnline = false) {
        if (!isOnline) {
            return getOfflineLine(bestMove.tags || [], mode, bestMove.score);
        }
        return createPrompt(bestMove, mode, bestMove.context || {});
    }

    // ==================== 公开接口 ====================
    return {
        assessPosition,
        reactToMove,
        getLine,
        getOfflineLine,
        createPrompt,
        getEmotion,

        // 暴露词库供测试或扩展
        _DIALOGUE: DIALOGUE,
        _DERIVED_PRIORITY: DERIVED_PRIORITY,
        _COMBO_PRIORITY: COMBO_PRIORITY,
        _TAG_PRIORITY: TAG_PRIORITY
    };
})();
