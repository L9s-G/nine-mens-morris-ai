// ========================================================
// Nine Men's Morris 语义叙述者 (Narrator)
// 版本：v2.0 - 组合标签系统
// 特性：
//   - 离线模式：组合标签优先匹配 → 单标签回退 → 模式台词
//   - 在线模式：生成 LLM System Prompt
//   - 情绪系统：根据 forceDiff 动态调整语气
//   - 陷阱话术：HiddenTrap 专属诱导性台词
// ========================================================

const Narrator = (() => {

    // ==================== 离线词库 ====================

    // 按策略模式分类的台词
    const MODE_TEMPLATES = {
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
    };

    // 按标签组合分类的台词（同级内按实战频率排序）
    const COMBO_TEMPLATES = {
        // ========== 4标签组合（最精确，优先匹配） ==========
        // HUB_CONTROL + NEAR_MILL + ANTI_FLYING + DECISIVE_STRIKE（74次）：路宽+近磨+禁飞+致命
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING+DECISIVE_STRIKE': [
            "路在我脚下，磨坊在眼前，你飞不起来。",
            "四通八达，磨坊将成，你已经没路了。",
            "我的路越走越宽，你的路越走越窄。"
        ],
        // HUB_CONTROL + ANTI_FLYING + BLOCK + DECISIVE_STRIKE（42次）：路宽+禁飞+封锁+致命
        'HUB_CONTROL+ANTI_FLYING+BLOCK+DECISIVE_STRIKE': [
            "我的路四通八达，你的翅膀折了，退路也断了。",
            "进退自如的是我，走投无路的是你。",
            "你已经无路可走了。"
        ],

        // ========== 3标签组合 ==========
        // HUB_CONTROL + NEAR_MILL + LAYOUT（112次）：路宽+近磨+布局
        'HUB_CONTROL+NEAR_MILL+LAYOUT': [
            "多一条路，磨坊就近一步。",
            "这一步布局，三手之后你就懂了。",
            "路越走越宽，网越收越紧。"
        ],
        // HUB_CONTROL + NEAR_MILL + ANTI_FLYING（79次）：路宽+近磨+禁飞
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING': [
            "路在我这边，磨坊在路上，你的翅膀也折了。",
            "我越走越宽，你越走越死。",
            "进退有路的是我，插翅难飞的是你。"
        ],
        // ANTI_FLYING + BLOCK + DECISIVE_STRIKE（60次）：禁飞+封锁+致命
        'ANTI_FLYING+BLOCK+DECISIVE_STRIKE': [
            "你说你还有几步可走？我帮你数，零。",
            "别看我，看棋盘。嗯，没路了。",
            "天空是你的？不，天空是我的。地也是。"
        ],
        // HUB_CONTROL + BLOCK + LAYOUT（43次）：路宽+封锁+布局
        'HUB_CONTROL+BLOCK+LAYOUT': [
            "我的路越走越宽，你的路少了一条。",
            "布局中，顺便断你一条路。",
            "占住路口，进可攻退可守。"
        ],
        // NEAR_MILL + RISKY + DECISIVE_STRIKE（34次）：近磨+冒险+致命
        'NEAR_MILL+RISKY+DECISIVE_STRIKE': [
            "你的磨坊我看在眼里，但我的更快。",
            "先让你吃，我的线已经走不回去了。",
            "你有后手？我也有。看谁先到。"
        ],
        // CAPTURE + ANTI_FLYING + BLOCK（34次）：吃子+禁飞+封锁
        'CAPTURE+ANTI_FLYING+BLOCK': [
            "子少了，路断了，对了你还有翅膀……哦不好意思。",
            "吃一颗子而已，你慌什么？又飞不走。",
            "你的棋子越来越少，路也越来越少，巧了。"
        ],

        // ========== 2标签组合（子集匹配，精确组合未命中时回退） ==========
        // NEAR_MILL + DECISIVE_STRIKE（84次）：近磨+决战（劣势中的一线生机）
        'NEAR_MILL+DECISIVE_STRIKE': [
            "差一子成行，这是我最后的机会。",
            "落后又怎样？这条线还没断。",
            "被逼到绝路，反而看到了光。"
        ],
        // CAPTURE + BLOCK（63次）：吃子+封锁
        'CAPTURE+BLOCK': [
            "吃子是假，封路是真。",
            "你的棋子我收下，你的路线也到此为止。",
            "一子落，两处绝。"
        ],
        // NEAR_MILL + ANTI_FLYING（52次）：近磨+禁飞
        'NEAR_MILL+ANTI_FLYING': [
            "差一步成行，对了你好像飞不了？真巧。",
            "磨坊快好了，你慢慢走，反正哪也去不了。",
            "这条线你看着办。能飞的话早就飞了吧？"
        ],
        // BLOCK + DECISIVE_STRIKE（38次）：封锁+决战（劣势中的反击）
        'BLOCK+DECISIVE_STRIKE': [
            "挡住了。现在轮到我了。",
            "落后不代表等死，这一手你没想到吧。",
            "守住了，才有资格反击。"
        ],
        // HUB_CONTROL + DECISIVE_STRIKE（29次）：路宽+致命
        'HUB_CONTROL+DECISIVE_STRIKE': [
            "进可攻退可守，这一击你躲不掉。",
            "路宽一寸，命长一截——你的命。",
            "四通八达，致命一击。"
        ],
        // RISKY + DECISIVE_STRIKE（21次）：冒险+致命
        'RISKY+DECISIVE_STRIKE': [
            "你有反击？我知道。但这步棋你拦不住。",
            "吞下这口气，下一回合你就是猎物。",
            "让你一步又如何，结局已经写好了。"
        ],
        // NEAR_MILL + RISKY（18次）：近磨+冒险
        'NEAR_MILL+RISKY': [
            "你的磨坊我看在眼里，但这条线我先走完。",
            "你可以反击，但挡不住我成行。",
            "明知山有虎，偏向虎山行——因为我更快。"
        ],
        // MILL + CAPTURE：成行+吃子（引擎中必然成对出现）
        'MILL+CAPTURE': [
            "磨坊转起来了，顺便带走你一颗子。",
            "三子连线，收网，吃子。一气呵成。",
            "成行是手段，吃子才是目的。",
            "磨坊开了，你的棋子少了一颗。",
            "转一圈，磨一颗。"
        ],

        // ========== 特殊：HIDDEN_TRAP ==========
        'HIDDEN_TRAP': [
            "这步棋我大意了，你敢吃吗？",
            "看来我也有计算失误的时候，这一子算我送你的。",
            "哎呀，走错了。你不会放过这个机会吧？",
            "这一步...是我的破绽？还是你的坟墓？"
        ]
    };

    // 按单标签分类的台词（组合未命中时的回退）
    // MILL 和 CAPTURE 在引擎中必然成对出现，台词已合并到 MILL+CAPTURE 组合
    const TAG_TEMPLATES = {
        MILL: [],
        CAPTURE: [],
        SQUEEZE: [
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
        BLOCK: [
            "想在这里成行？太天真了。",
            "你的如意算盘，我早已看穿。",
            "此路不通。",
            "这条线，到此为止。",
            "你差的那一步，我帮你堵上了。",
            "磨坊？不存在的。",
            "你的计划，我已经读完了。",
            "封死。下一个。"
        ],
        DECISIVE_STRIKE: [
            "没有退路了，那就拼到底。",
            "输了子又如何，棋还没下完。",
            "被逼到这一步，反而清醒了。",
            "绝境？不，这才刚开始。",
            "退无可退，背水一战。"
        ],
        NEAR_MILL: [
            "这步棋平平无奇？你自己品。",
            "我什么都没说，你什么都没看到。",
            "安静。别打扰我布局。",
            "你没发现？那最好。",
            "走着走着，磨坊就来了。"
        ],
        ANTI_FLYING: [
            "放心吧，我不会轻易放你飞的。",
            "我就是不吃最后一口，你奈我何。",
            "你以为逆风翻盘的机会到了？没风，哈哈。",
            "空域管制，禁止起飞。",
            "你能耐，你飞过去啊。",
            "留你一颗子，是让你看着自己输。",
            "飞？想得美。",
            "最后三颗子的滋味如何？慢慢享受。"
        ],
        HUB_CONTROL: [
            "多一条路，多一分活路。",
            "条条大路通罗马，我站的这条最宽。",
            "进可攻，退可守。",
            "做人留一线，走路不被堵。",
            "这个位置，四通八达。",
            "我不急，路还长。"
        ],
        LAYOUT: [
            "开局而已，看看坐哪合适。",
            "先占个坑，后面再说。",
            "慢慢放，慢慢占，不急。",
            "人越来越多了，我得找个宽敞地儿。",
            "棋盘还空着，先逛逛。",
            "这一步不重要？那你再想想。"
        ],
        SUPPRESSION: [],
        RISKY: [
            "你的磨坊我看见了，但我的棋更大。",
            "先让你得意一下，君子报仇十轮不晚。",
            "你以为这样我就会怕吗？等着。",
            "厉害，没挡住。但你别高兴太早。",
            "这一步我吞下了，下一步轮到你颤抖。"
        ]
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

    /**
     * 根据 minimax 评估分判断情绪
     * 基于 24 局实战评分分布校准
     */
    function getEmotion(score) {
        if (score >= 500) return 'arrogant';
        if (score >= 100) return 'confident';
        if (score >= -100) return 'neutral';
        if (score >= -400) return 'cautious';
        return 'desperate';
    }

    /**
     * 从数组中随机选取一个元素
     */
    function randomPick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ==================== 离线台词生成 ====================

    /**
     * 离线模式：组合标签优先 → 单标签回退 → 模式台词 + 情绪修饰
     */
    // 组合匹配优先级（特异性优先：4标签 > 3标签 > 2标签，同级内按频率排序）
    const COMBO_PRIORITY = [
        // 4标签
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING+DECISIVE_STRIKE',
        'HUB_CONTROL+ANTI_FLYING+BLOCK+DECISIVE_STRIKE',
        // 3标签
        'HUB_CONTROL+NEAR_MILL+LAYOUT',
        'HUB_CONTROL+NEAR_MILL+ANTI_FLYING',
        'ANTI_FLYING+BLOCK+DECISIVE_STRIKE',
        'HUB_CONTROL+BLOCK+LAYOUT',
        'NEAR_MILL+RISKY+DECISIVE_STRIKE',
        'CAPTURE+ANTI_FLYING+BLOCK',
        // 2标签
        'MILL+CAPTURE',
        'NEAR_MILL+DECISIVE_STRIKE',
        'CAPTURE+BLOCK',
        'NEAR_MILL+ANTI_FLYING',
        'BLOCK+DECISIVE_STRIKE',
        'HUB_CONTROL+DECISIVE_STRIKE',
        'RISKY+DECISIVE_STRIKE',
        'NEAR_MILL+RISKY',
        // 特殊
        'HIDDEN_TRAP'
    ];

    // 单标签回退优先级
    const TAG_PRIORITY = [
        'MILL', 'CAPTURE', 'SQUEEZE', 'BLOCK',
        'DECISIVE_STRIKE', 'NEAR_MILL', 'ANTI_FLYING',
        'HUB_CONTROL', 'LAYOUT', 'SUPPRESSION', 'RISKY'
    ];

    /**
     * 检查 tags 是否包含指定组合的所有标签
     */
    function hasCombo(tags, comboKey) {
        const required = comboKey.split('+');
        return required.every(tag => tags.includes(tag));
    }

    function getOfflineLine(bestMove, mode, score) {
        const emotion = getEmotion(score);
        const modifier = EMOTION_MODIFIERS[emotion];
        const tags = bestMove.tags || [];

        let line = '';

        // 1. 优先匹配组合标签
        for (const comboKey of COMBO_PRIORITY) {
            if (hasCombo(tags, comboKey)) {
                line = randomPick(COMBO_TEMPLATES[comboKey]);
                break;
            }
        }

        // 2. 回退到单标签
        if (!line) {
            for (const tag of TAG_PRIORITY) {
                if (tags.includes(tag) && TAG_TEMPLATES[tag]) {
                    line = randomPick(TAG_TEMPLATES[tag]);
                    break;
                }
            }
        }

        // 3. 最终回退到模式台词
        if (!line) {
            const modeLines = MODE_TEMPLATES[mode] || MODE_TEMPLATES.EXPANSION;
            line = randomPick(modeLines);
        }

        // 添加情绪修饰
        const prefix = randomPick(modifier.prefix);
        const suffix = randomPick(modifier.suffix);

        return prefix + line + suffix;
    }

    // ==================== 在线 Prompt 生成 ====================

    /**
     * 在线模式：生成给 LLM 的 System Prompt
     */
    function createPrompt(report, bestMove, mode) {
        const emotion = getEmotion(bestMove.score);

        return {
            role: "system",
            content: `你是一位Nine Men's Morris宗师，性格冷酷而自信。

当前博弈状态：
- 阶段：${report.context.phase}
- 策略模式：${mode}
- 兵力差：${report.context.forceDiff}（正=你优势，负=对手优势）
- 机动性差值：${report.metrics.mobilityGap}
- 情绪基调：${emotion}

你刚做出的走法：${bestMove.description}
走法标签：${bestMove.tags.join(', ')}

要求：
1. 生成一句简短（20字以内）的宗师点评
2. 语气符合当前情绪基调（优势时傲慢，劣势时冷静，均势时深沉）
3. 如果标签包含 HIDDEN_TRAP，假装这是失误，诱导对手上钩
4. 不要提及具体的棋盘坐标或技术细节`
        };
    }

    // ==================== 统一接口 ====================

    /**
     * 获取台词
     * @param {object} report - 战术报告
     * @param {object} bestMove - AI 选择的最佳走法（含 score, tags）
     * @param {string} mode - 策略模式
     * @param {boolean} isOnline - 是否在线模式
     * @returns {string|object} 离线返回字符串，在线返回 Prompt 对象
     */
    function getLine(report, bestMove, mode, isOnline = false) {
        if (!isOnline) {
            return getOfflineLine(bestMove, mode, bestMove.score);
        }
        return createPrompt(report, bestMove, mode);
    }

    // ==================== 公开接口 ====================
    return {
        getLine,
        getOfflineLine,
        createPrompt,
        getEmotion,

        // 暴露词库供测试或扩展
        _MODE_TEMPLATES: MODE_TEMPLATES,
        _TAG_TEMPLATES: TAG_TEMPLATES,
        _COMBO_TEMPLATES: COMBO_TEMPLATES,
        _COMBO_PRIORITY: COMBO_PRIORITY,
        _TAG_PRIORITY: TAG_PRIORITY
    };
})();
