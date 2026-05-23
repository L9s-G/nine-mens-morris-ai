# Nine Men's Morris 语义叙述者设计规范

## 1. 概述

Narrator 是 AI 引擎的"表达层"模块，负责将结构化战术数据转化为人类可读的宗师风格台词。支持两种工作模式：

- **离线模式**：基于标签组合、策略模式、情绪状态从本地词库抽取对白，零网络依赖
- **在线模式**：生成 LLM System Prompt，由大模型生成自然语言点评

核心设计理念：**组合标签优先匹配**。基于 1804 个实战样本的标签频率分析，构建了 16 个高频标签组合模板，有效覆盖率从优化前的 ~17% 提升至 88.1%。

## 2. 系统架构

Narrator 采用"词库-匹配-修饰"三层流水线：

```
输入: bestMove.tags + mode + forceDiff
        │
        ▼
┌─────────────────────┐
│  1. 组合标签匹配     │  COMBO_PRIORITY → COMBO_TEMPLATES
│     (特异性优先)     │  4标签 > 3标签 > 2标签
└─────────┬───────────┘
          │ 未命中
          ▼
┌─────────────────────┐
│  2. 单标签回退       │  TAG_PRIORITY → TAG_TEMPLATES
└─────────┬───────────┘
          │ 未命中
          ▼
┌─────────────────────┐
│  3. 模式台词兜底     │  MODE_TEMPLATES[mode]
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  4. 情绪修饰         │  prefix + line + suffix
│     (forceDiff)      │  EMOTION_MODIFIERS[emotion]
└─────────────────────┘
          │
          ▼
       输出台词
```

## 3. 离线词库

### 3.1 组合标签模板 (COMBO_TEMPLATES)

基于实战对战数据（24 场循环赛，1804 手）的标签频率分析构建。按特异性分层：

#### 4 标签组合（最精确，优先匹配）

| 组合 | 实战频率 | 场景描述 | 示例台词 |
|------|---------|---------|---------|
| `HUB_CONTROL+NEAR_MILL+ANTI_FLYING+DECISIVE_STRIKE` | 74 | 全面压制：枢纽+近磨+禁飞+致命 | "枢纽、磨坊、禁飞——你已经是个死人了。" |
| `HUB_CONTROL+ANTI_FLYING+BLOCK+DECISIVE_STRIKE` | 42 | 枢纽禁飞封锁致命 | "心脏归我，翅膀折断，此路不通。" |

#### 3 标签组合

| 组合 | 实战频率 | 场景描述 | 示例台词 |
|------|---------|---------|---------|
| `HUB_CONTROL+NEAR_MILL+LAYOUT` | 112 | 开局抢占枢纽，布局成行 | "枢纽归我，磨坊已在路上。" |
| `HUB_CONTROL+NEAR_MILL+ANTI_FLYING` | 79 | 枢纽+近磨+禁飞 | "三重绞杀，无处可逃。" |
| `ANTI_FLYING+BLOCK+DECISIVE_STRIKE` | 60 | 禁飞+封锁+致命 | "飞不起来，走不动路，这就是绝境。" |
| `HUB_CONTROL+BLOCK+LAYOUT` | 43 | 枢纽+封锁+布局 | "布局中，顺便断你一条路。" |
| `NEAR_MILL+RISKY+DECISIVE_STRIKE` | 34 | 近磨+冒险+致命 | "高风险？不，这是必杀。" |
| `CAPTURE+ANTI_FLYING+BLOCK` | 34 | 吃子+禁飞+封锁 | "吃你的子，折你的翅，断你的路。" |

#### 2 标签组合（子集匹配，精确组合未命中时回退）

| 组合 | 实战频率 | 场景描述 | 示例台词 |
|------|---------|---------|---------|
| `NEAR_MILL+DECISIVE_STRIKE` | 84 | 即将成行+致命一击 | "差一子成行，而这一步，就是那最后一子。" |
| `CAPTURE+BLOCK` | 63 | 吃子+封锁 | "吃子是假，封路是真。" |
| `NEAR_MILL+ANTI_FLYING` | 52 | 近磨+禁飞 | "磨坊将成，你的棋子连飞都飞不了。" |
| `BLOCK+DECISIVE_STRIKE` | 38 | 封锁+致命一击 | "封锁只是序曲，致命一击才是正文。" |
| `HUB_CONTROL+DECISIVE_STRIKE` | 29 | 枢纽+致命 | "占据心脏，一击致命。" |
| `RISKY+DECISIVE_STRIKE` | 21 | 冒险+致命 | "看似冒险，实则必杀。" |
| `NEAR_MILL+RISKY` | 18 | 近磨+冒险 | "赌一把？赌你拦不住我成行。" |

#### 特殊

| 组合 | 说明 |
|------|------|
| `HIDDEN_TRAP` | 诱导性台词，假装失误引诱对手上钩 |

### 3.2 单标签模板 (TAG_TEMPLATES)

组合未命中时的回退词库，覆盖所有 11 种引擎标签：

| 标签 | 含义 | 示例台词 |
|------|------|---------|
| `MILL` | 形成磨坊 | "磨坊转动，你的棋子消逝。" |
| `CAPTURE` | 吃子 | "少一子，多一分绝望。" |
| `SQUEEZE` | 挤压空间 | "收紧绞索，你无处可逃。" |
| `BLOCK` | 封锁 | "想在这里成行？太天真了。" |
| `DECISIVE_STRIKE` | 致命一击 | "精准。致命。不给你任何机会。" |
| `NEAR_MILL` | 差一步成行 | "差一子成行，你拦得住吗？" |
| `ANTI_FLYING` | 限制飞行 | "禁飞区已划定，你只能老老实实走路。" |
| `HUB_CONTROL` | 占据枢纽 | "枢纽在手，天下我有。" |
| `LAYOUT` | 布局阶段 | "布局阶段，每一步都是伏笔。" |
| `SUPPRESSION` | 压制 | "收网开始了。" |
| `RISKY` | 冒险走法 | "赌一把？" |

### 3.3 模式模板 (MODE_TEMPLATES)

最终兜底，按策略模式提供通用台词：

| 模式 | 风格 | 示例台词 |
|------|------|---------|
| `EXPANSION` | 深沉、布局感 | "你只看到了眼前的棋子，而我看到了整张网。" |
| `SUPPRESSION` | 窒息、压迫感 | "困兽之斗。你每走一步，都是在自寻死路。" |
| `DECISIVE` | 冷酷、终结感 | "游戏结束了。从现在开始，只有收割。" |

## 4. 情绪系统

### 4.1 情绪判断

根据 `forceDiff`（兵力差 = 己方棋子数 − 对手棋子数）映射到 5 种情绪：

| 兵力差 | 情绪 | 风格 |
|--------|------|------|
| ≥ 3 | `arrogant`（傲慢） | 前缀"呵，"/ 后缀"不过如此。" |
| 1 ~ 2 | `confident`（自信） | 前缀"" / 后缀"继续。" |
| 0 | `neutral`（中性） | 无修饰 |
| -1 ~ -2 | `cautious`（谨慎） | 前缀"这一步..." / 后缀"我们走着瞧。" |
| ≤ -3 | `desperate`（绝望） | 前缀"不可能..." / 后缀"绝地反击。" |

### 4.2 修饰叠加

情绪修饰通过前缀 (prefix) 和后缀 (suffix) 叠加到台词上：

```
最终台词 = prefix + line + suffix
```

- prefix 和 suffix 从各自数组中随机选取
- `neutral` 的 prefix/suffix 均为空字符串，不改变台词原貌
- `arrogant` 和 `desperate` 的修饰最强烈，中性情绪最克制

## 5. 匹配算法

### 5.1 组合匹配优先级

组合模板按**特异性**（标签数量）排序，而非单纯频率：

```
4标签组合 > 3标签组合 > 2标签组合 > HIDDEN_TRAP
```

同级内按实战频率降序。这确保了当 tags 包含多个标签时，最精确的组合被优先匹配。

**示例**：tags = `['NEAR_MILL', 'RISKY', 'DECISIVE_STRIKE']`
- 不会误匹配 2 标签的 `NEAR_MILL+DECISIVE_STRIKE`
- 正确匹配 3 标签的 `NEAR_MILL+RISKY+DECISIVE_STRIKE`

### 5.2 子集匹配机制

组合匹配使用子集检测：只要 tags **包含**组合所需的所有标签即命中，允许 tags 有额外标签。

```javascript
function hasCombo(tags, comboKey) {
    const required = comboKey.split('+');
    return required.every(tag => tags.includes(tag));
}
```

这意味着 `tags = ['CAPTURE', 'BLOCK', 'SUPPRESSION']` 会命中 `CAPTURE+BLOCK`（因为包含了所需标签），而不会要求精确匹配。

### 5.3 完整匹配流程

```
1. COMBO_PRIORITY 遍历（特异性优先）
   ├── 命中 → 从 COMBO_TEMPLATES 取台词 → 跳到 4
   └── 全部未命中 → 继续

2. TAG_PRIORITY 遍历（单标签）
   ├── 命中 → 从 TAG_TEMPLATES 取台词 → 跳到 4
   └── 全部未命中 → 继续

3. MODE_TEMPLATES[mode] 兜底

4. 情绪修饰叠加（prefix + line + suffix）
```

## 6. 在线模式 (LLM Prompt)

在线模式不使用本地词库，而是生成结构化 System Prompt 交给 LLM 生成台词。

### 6.1 Prompt 结构

```
角色设定：Nine Men's Morris 宗师，性格冷酷而自信

博弈状态：
- 阶段（PLACEMENT / MOVING / FLYING）
- 策略模式（EXPANSION / SUPPRESSION / DECISIVE）
- 兵力差（正=优势，负=劣势）
- 机动性差值
- 情绪基调（由 forceDiff 自动推导）

走法信息：
- 描述、标签、风险等级

生成要求：
1. 20 字以内
2. 语气符合情绪基调
3. HIDDEN_TRAP 时假装失误
4. 不提及坐标或技术细节
```

### 6.2 离线 vs 在线对比

| 维度 | 离线模式 | 在线模式 |
|------|---------|---------|
| 网络依赖 | 无 | 需要 LLM API |
| 台词质量 | 固定词库，风格一致 | 自然语言，灵活多变 |
| 延迟 | < 1ms | 取决于 API |
| 适用场景 | 单机 / 性能敏感 | 在线 / 追求沉浸感 |

## 7. 覆盖率分析

基于 24 场 AI 循环赛（Eco / Normal / Master 全配对 × 4 轮）的 1804 手实战数据：

| 匹配层级 | 样本数 | 占比 |
|---------|--------|------|
| 组合匹配 | 1120 | 62.1% |
| 单标签匹配 | 470 | 26.1% |
| 模式回退（空标签） | 214 | 11.9% |
| **有效覆盖** | **1590** | **88.1%** |

11.9% 的模式回退全部来自空标签 `[]`（引擎在某些局面下不产生标签），属于正常行为。

### 7.1 标签频率分布（Top 12）

| 标签 | 出现次数 | 是否有模板 |
|------|---------|-----------|
| `NEAR_MILL` | 718 | 是（新增） |
| `BLOCK` | 589 | 是 |
| `HUB_CONTROL` | 572 | 是 |
| `DECISIVE_STRIKE` | 560 | 是（新增） |
| `ANTI_FLYING` | 512 | 是（新增） |
| `CAPTURE` | 385 | 是 |
| `RISKY` | 369 | 是 |
| `LAYOUT` | 241 | 是（新增） |
| `SUPPRESSION` | 201 | 是（新增） |
| `MILL` | 193 | 是 |
| `SQUEEZE` | 165 | 是 |
| `HIDDEN_TRAP` | — | 是（引擎特殊标签） |

## 8. 公开接口

```javascript
Narrator.getLine(report, bestMove, mode, isOnline)
// 统一入口。isOnline=false 返回字符串，isOnline=true 返回 Prompt 对象

Narrator.getOfflineLine(bestMove, mode, forceDiff)
// 离线台词生成

Narrator.createPrompt(report, bestMove, mode)
// 在线 Prompt 生成

Narrator.getEmotion(forceDiff)
// 兵力差 → 情绪字符串
```

### 8.1 bestMove 结构

```javascript
{
    score: 150,           // 走法评分
    tags: ['NEAR_MILL', 'DECISIVE_STRIKE'],  // 语义标签
    risk: 'high',         // 风险等级
    description: '...'    // 走法描述
}
```

### 8.2 report 结构

```javascript
{
    context: {
        phase: 'MOVING',
        forceDiff: 2,          // 兵力差
        isOpponentNearFlying: false,
        desperationLevel: 0
    },
    metrics: {
        mobilityGap: 3,
        tensionScore: 15
    }
}
```

## 9. 扩展指南

### 9.1 添加新台词

1. **单标签台词**：在 `TAG_TEMPLATES[tag]` 数组中追加字符串
2. **组合台词**：在 `COMBO_TEMPLATES[comboKey]` 数组中追加字符串
3. **新模式台词**：在 `MODE_TEMPLATES` 中添加新模式或追加到现有数组

### 9.2 添加新组合

1. 在 `COMBO_TEMPLATES` 中添加 `'TAG1+TAG2': [...]` 条目
2. 在 `COMBO_PRIORITY` 数组中按特异性插入正确位置（4标签 > 3标签 > 2标签）
3. 运行覆盖率分析脚本验证匹配效果

### 9.3 调整情绪阈值

修改 `getEmotion(forceDiff)` 中的数值即可。当前阈值：

```
arrogant:  forceDiff ≥ 3
confident: forceDiff ≥ 1
neutral:   forceDiff === 0
cautious:  forceDiff ≥ -2
desperate: forceDiff < -2
```

### 9.4 调试与测试

暴露内部数据结构供测试：

```javascript
Narrator._COMBO_TEMPLATES   // 组合模板
Narrator._COMBO_PRIORITY    // 组合优先级
Narrator._TAG_TEMPLATES     // 单标签模板
Narrator._TAG_PRIORITY      // 单标签优先级
Narrator._MODE_TEMPLATES    // 模式模板
```
