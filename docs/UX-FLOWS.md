# Owlbear Audio — UX 用户流程与交互原则

## 1. 产品不是“音频软件”，而是 DM 的临场副驾驶

用户的主要任务不是管理文件、调混音器或操作两台 Deck；这些只是底层能力。

真正任务链是：

1. **我有一些声音素材。**
2. **我想把它们变成这场游戏能直接用的剧情声音。**
3. **开团以后我只想知道：现在是什么、下一步是什么、什么时候按 GO。**
4. **剧情突然偏离计划时，我能立刻 Hold / Devamp / Override / Panic。**
5. **结束后不需要整理一堆临时播放器状态。**

UI 必须围绕这条任务链服务，而不是围绕内部数据结构服务。

---

## 2. 三种心理状态，而不是三种“功能页面”

### A. Setup / First Run — “先让我能出声”

第一次打开时用户最怕的是配置成本。

目标：30 秒内完成一次真实播放。

流程：

1. 检查 Background runtime。
2. 明确提示 `Enable Audio`，只解释一次浏览器为什么需要点击。
3. 检查/引导建立 `Owlbear Audio` Collection。
4. 如果还没有素材，给两个明确入口：
   - `Import Audio`
   - `Try Demo Sound`
5. 第一次声音成功后立即进入正常工作流，不继续展示 onboarding。

原则：

- 不要求用户先理解 Asset / Clip / Cue / Bus / Scene。
- 不要求先打开高级设置。
- 每一步都有明确结果和下一步。
- onboarding 不是永久首页。

---

### B. Prepare / Director — “把今晚需要的东西排好”

用户在开团前最常见的路径：

`找到素材 -> 放进一个 Scene / Cue -> 调一下转场 -> 排成顺序 -> 预演 -> 开团`

默认工作台围绕这个流程组织：

#### 左侧：Find

Library + Search + Tags。

回答：“我要用的声音在哪？”

不是把所有文件管理功能都堆进去。

#### 中间：Build

默认显示当前 Show 的 Cue Stack / Scene Timeline。

回答：“今晚接下来会发生什么？”

这里是 Director Mode 的视觉中心。

#### 右侧：Tune

只显示当前选中对象真正相关的 Inspector。

回答：“这个 Cue / Scene 我要怎么改？”

没有选中对象时，不显示几十个 disabled 参数，而显示下一步建议。

#### 底部/顶部固定 Transport Strip

始终回答：

- NOW 是什么
- NEXT 是什么
- Audio 是否 Ready
- 玩家同步是否正常
- 可以随时进入 Live

原则：**Library 是来源，Cue Stack 是任务，Inspector 是细节；任务永远占最大面积。**

---

### C. Live — “别让我离开剧情超过一秒”

Live Console 的信息优先级：

1. NOW
2. NEXT / GO
3. DEVAMP / HOLD（只有当前 Cue 支持时才出现或提升权重）
4. PANIC
5. Play/Pause
6. 三个核心 Bus 音量
7. Favorite Pads
8. 进入 Studio

默认单次操作目标：

- 普通剧情推进：1 click (`GO`)
- 战斗结束：1 click (`DEVAMP`)
- 临时停住自动流程：1 click (`HOLD`)
- 出问题：1 click (`PANIC`)

不要让用户：

- 先选 Deck 再选 Track 再按 Play；
- 为 Scene 切换手工停 3 条旧 Layer 再开 4 条新 Layer；
- 在跑团时读大波形、找文件夹、看技术日志；
- 每次打开 Action 都重新建立播放器状态。

---

## 3. Progressive Disclosure：复杂能力出现的时机

### 一级：永远可理解

- Scene
- Cue
- GO
- Hold
- Devamp
- Panic
- Master / Music / Ambience

### 二级：准备时出现

- Fade duration
- Loop
- Layer
- Random variant
- Follow action
- Cue grouping
- Private audition

### 三级：用户主动展开 Advanced

- Deck A/B
- Waveform
- Hot Cue
- Loop boundaries
- EQ / Filter
- Crossfader
- Beat grid / BPM / Quantize
- Automation curves

原则：**不是把高级功能删除，而是不让高级功能在用户不需要它时占据认知空间。**

---

## 4. Empty State 必须告诉用户“下一步”

坏的 Empty State：

> No Assets

好的 Empty State：

> 还没有声音素材。拖入一个音频文件，或者先用 Demo Sound 试一次完整播放。
> [Import Audio] [Try Demo]

坏的 Cue Stack：

> No Cues

好的 Cue Stack：

> 当前 Show 还没有下一步。把左侧素材拖进这里，会自动创建 Play Cue；或者先创建一个 Scene。
> [Create Scene] [Add Cue]

任何空白区域都必须回答：

- 为什么是空的？
- 用户现在最可能要做什么？
- 最短路径是什么？

---

## 5. 默认动作应匹配用户意图

### 从 Library 拖一个 Track 到 Cue Stack

默认创建 `PLAY` Cue，而不是先弹一个“选择 Cue Type”的对话框。

高级用户之后可把它改成 Group / Random / Devamp 结构。

### 把多个 Layer 放进 Scene

默认：

- 只替换发生变化的 Layer；
- Music 使用 equal-power crossfade；
- Ambience 尝试连续/无缝；
- SFX 不被 Scene 重启；
- 下一 Scene 自动 preload。

### 点击 GO

永远执行“已经 Armed 的下一步”。

如果没有 NEXT，GO 应明确 disabled，并告诉用户去 Studio 排一个 Cue，而不是静默无反应。

---

## 6. 错误恢复必须比错误说明更重要

错误提示结构：

1. **发生了什么**：`Player 2 audio blocked`
2. **当前影响**：`该玩家听不到声音，其他玩家正常`
3. **最短恢复动作**：`Ask player to tap Enable Audio`
4. 技术详情折叠在 Diagnostics 中。

Live Console 不展示 stack trace、CDN URL、MIME、SDK 状态 JSON。

PANIC 必须始终可见且不依赖当前选中对象。

---

## 7. 用户对象名称优先于内部名称

内部：Asset / Clip / Cue / Bus / Runtime Channel。

用户默认看到：

- Sound / Track
- Scene
- Cue
- Music / Ambience / SFX

`Asset`、`Clip`、`Channel` 只在 Advanced / Diagnostics 中出现。

---

## 8. 视觉层级服务于动作层级

### Live

最大：`GO` / `DEVAMP`

第二：NOW / NEXT

第三：Pause / Hold / Bus volume

危险但固定位置：PANIC

最弱：Studio / Diagnostics / Settings

### Director

最大：Cue Stack / Scene Workspace

第二：Library / Inspector

固定状态：Transport strip

Advanced Mixer/Deck 默认折叠。

---

## 9. 不允许的 UX 退化

- 为了“看起来专业”把 Live 做成 DJ Mixer。
- 为了“界面干净”把 Panic、Devamp 等关键能力藏进二级菜单。
- 为了“功能完整”把所有参数同时铺开。
- 把首次配置和日常操作混在同一页面永久存在。
- 用 Toast 代替可恢复状态。
- UI 本地 state 成为唯一真相；重新打开 Action 必须从 Background 恢复。
- 一个动作能默认推断时仍强迫用户先填表单。

---

## 10. 当前第一版用户旅程验收标准

### Journey 1 — 第一次出声

`打开 Action -> Enable Audio / Try Demo -> 听到声音`

最多 2 次显式点击。

### Journey 2 — 日常跑团

`打开 Action -> 看 NOW/NEXT -> GO`

最多 1 次控制点击。

### Journey 3 — 战斗自然结束

`Boss 倒下 -> DEVAMP`

1 click；音乐在合法出口收束。

### Journey 4 — 紧急中止

`异常/电话/剧情中断 -> PANIC`

1 click；无二次确认。

### Journey 5 — 准备节目

`Open Studio -> 找素材 -> 拖入 Cue Stack -> 调整 -> Preview -> Enter Live`

核心流程始终从左到中，不要求在多个 Modal/页面之间往返。

### Journey 6 — UI 重建

`播放中 Action reload/reopen -> UI 自动恢复 NOW / transport / Bus volume`

0 个恢复点击。

这些验收标准比“页面是否漂亮”优先级更高。
