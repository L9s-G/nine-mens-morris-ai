
# 九连棋“宗师”AI 引擎设计规范 (Nine Men's Morris "Master" AI Spec)

## 1. 概述 (Overview)

本项目旨在构建一个具备“博弈灵魂”的九连棋 AI。不同于传统的固定难度 AI，本引擎通过动态战术报告（Strategic Report）驱动，能够根据局势实时切换博弈性格，并支持 **LLM（大语言模型）** 产生的自然语言策略对白，同时在离线状态下保持硬核的竞技强度。

## 2. 系统架构 (System Architecture)

系统采用“感知-决策-表达”三层分离架构：

1.  **物理引擎层 (Engine.js)**：
    
    -   维护棋盘状态、执行 `makeMove`、验证合法性。
        
    -   **核心功能**：支持 FEN 状态序列化，提供 `undoMove`（撤销）接口以支持 AI 深度搜索。
        
2.  **战术分析层 (Strategy.js)**：
    
    -   将冰冷的坐标转化为结构化数据。
        
    -   **职责**：进行机动性扫描、阵型张力评估、生成标准化战术报告。
        
3.  **人格驱动层 (Persona/AI Controller)**：
    
    -   **在线模式**：将战术报告喂给 LLM，生成富有性格的对白与决策。
        
    -   **离线模式**：根据报告中的权重标签，由本地状态机选择最优走法。
        

## 3. 动态评估体系 (Dynamic Evaluation)

我们放弃了静态的点位加分制（如单纯给中心点加分），转而采用基于**图论动态属性**的评估模型：

### 3.1 动态机动性 (Effective Mobility)

-   **计算逻辑**：不只是计算 `generateLegalMoves` 的数量，而是过滤掉“移动后会被对方立即成行”的自杀位。
    
-   **压制系数**：计算对方的“呼吸空间”。当对方有效步数趋近于零时，触发“闷杀”逻辑。
    

### 3.2 阵型张力 (Formation Tension)

-   **双重威胁 (Forks)**：识别共用一个空格（Null）的两个连线阵型（3-3 叉子）。
    
-   **磨坊活性 (Mill Activity)**：评估一个磨坊开启和关闭的效率。如果一子移出后能迅速移回形成新磨坊，则该点位权重极大化。
    

## 4. 宗师级策略状态机 (Master Strategy State Machine)

Master AI 并不是单一的性格，而是一个根据局势动态切换策略的实体。

策略模式

触发条件

行为逻辑

语义标签

**扩张布局 (Expansion)**

放置阶段，子数 > 6

优先占据高联通性的点位，构建潜在的连线网络，不急于成行。

`LAYOUT`, `HUB_CONTROL`

**窒息压制 (Suppression)**

走子阶段，机动性占优

放弃不必要的吃子，优先围堵对方棋子的邻居位。预防对方进入“飞行模式”。

`SQUEEZE`, `ANTI_FLYING`

**决战收割 (Decisive Strike)**

劣势翻盘或残局收割

切换至最高搜索深度，利用双重磨坊或连击寻求最快胜径。

`ATTACK`, `KILL_SHOT`

## 5. 标准化战术报告协议 (Protocol)

`Strategy.js` 每一轮输出的 JSON 结构，用于衔接 LLM 或 离线决策器：

```
{
  "context": {
    "phase": "MOVING",
    "materialDiff": 1,
    "isOpponentNearFlying": true
  },
  "metrics": {
    "mobilityGap": 7,
    "tensionScore": 45
  },
  "suggestedMoves": [
    {
      "move": {"from": 10, "to": 3},
      "score": 95,
      "tags": ["BLOCK", "SQUEEZE"],
      "description": "占据中心枢纽，锁死对方逃逸路径"
    }
  ]
}

```

## 6. 心理博弈：陷阱机制 (The Trap Mechanism)

为了模拟人类“赌徒”心理，AI 引入了**深度差（Depth Gap）评估**：

-   **陷阱定义**：如果一步棋在 $D=2$（浅层搜索）评分极低，但在 $D=8$（深层搜索）评分极高，则标记为 `HiddenTrap`。
    
-   **执行策略**：根据玩家的历史表现或随机概率，AI 会故意跳入看似“失误”的陷阱，并利用 LLM 配合诱导性台词：“这步棋我大意了，你敢吃吗？”
    

## 7. 离线兼容性设计

-   **统一接口**：`Strategy.js` 的输出对离线/在线完全一致。
    
-   **话术回退**：离线时，`Narrator.js` 根据 `tags` 从本地预设的性格词库中随机抽取对白。
    
-   **算法稳定性**：即使没有 LLM 的策略建议，依靠 `suggestedMoves` 的原始评分，AI 依然维持宗师级的竞技水平。
    

## 8. 开发路线图 (Roadmap)

1.  **[已完成]** `Engine.js` 核心规则与 `makeMove`。
    
2.  **[进行中]** 为 `Engine.js` 补充 `undoMove` 逻辑。
    
3.  **[待启动]** 实现 `Strategy.js` 的机动性压制算法与战术报告生成器。
    
4.  **[待启动]** 接入 LLM 接口，编写各阶段性格 Prompt。