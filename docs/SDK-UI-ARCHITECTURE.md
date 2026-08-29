# Owlbear Audio — SDK UI 注入与运行时架构

## 1. 设计目标

Owlbear Audio 不应该把所有功能硬塞进一个 Action popover，也不应该为每个入口各造一套播放器。

正确架构是：

> **一个播放状态模型 + 一个本地播放 owner + 多个轻量控制面。**

不同 Owlbear SDK UI surface 只负责最适合自己的交互，所有 surface 共享同一套 Asset / Clip / Cue / Bus / Scene / Show 模型。

---

## 2. Owlbear 当前可用的主要 UI Surface

根据官方 SDK/文档，扩展可组合使用：

- Manifest Action + Action Popover
- Background page (`background_url`)
- Modal（支持 `fullScreen`）
- Arbitrary Popover
- Context Menu
- Tool
- Tool Mode
- Tool Action
- Notification

其中 Tool / Tool Mode / Tool Action 只有 Scene 已打开、工具栏存在时才适合作为入口，因此不能作为音频系统的唯一控制面。

Manifest 的 `permissions` 支持 `autoplay`，该权限会加到扩展 iframe 的 allow 属性中；但浏览器自身的 user-activation/autoplay policy 仍然需要真实测试，不能把 manifest permission 当成“任何隐藏 iframe 都必然能首次发声”的保证。

---

## 3. 推荐职责分配

### A. Action：全局主入口 + Live Console

Action 在房间左上区域，即使没有 Scene 也存在，是整个系统最可靠的显式入口。

Action popover 承担 Compact / Live Mode：

- 当前 Scene / Music
- Play / Pause
- GO / NEXT
- HOLD
- DEVAMP / EXIT LOOP
- PANIC / STOP ALL
- Master / Music / Ambience 基础音量
- 4–8 个 Favorite Pads
- Current / Next Cue
- 打开 Full Studio

Action API 还可动态改变：

- width / height
- badge text / badge color
- icon / title
- open / close

因此 Action 图标本身应该成为一个非常轻量的状态灯：

- 无播放：普通状态
- Playing：显示小型播放 badge 或状态色
- Cue Armed：提示“下一步已准备”
- Sync degraded / missing asset：错误 badge

原则：**Action 永远是“我现在要管声音”的入口，不要求当前必须有 Scene。**

---

## 4. Full-screen Modal：Director / Studio

官方 Modal 支持 `fullScreen: true`，因此不需要自己伪造整页 overlay。

Full Studio 承担：

- Library / Search / Tags / Collections
- Cue List
- Scene Grid
- Cue Cart
- Now / Armed / Queue
- Inspector
- Deck A/B
- Waveform
- Hot Cue / Loop
- Mixer / Bus
- Automation
- Import / Transcode / Storage
- Diagnostics / Sync state

这是准备阶段和高级操作的主界面。

Modal 是“编辑器/导演台”，不应该成为持续播放 owner；关掉 Modal 不得中断声音。

---

## 5. Tool Action：Scene 打开时的极速 GO / Panic

Tool Action 是工具栏里的无激活态按钮：点击发生动作，但不会抢走当前 active tool。

它非常适合音频的即时操作，因为 DM 不应该为了按一次 GO 而从测距、Fog、Pointer 等工具模式切出去。

建议提供可配置的 Tool Actions：

- `GO`
- `DEVAMP`
- `PANIC`
- `CUE CART`

第一版不应一次塞太多按钮。默认只放一个最有价值的 `GO`，其余让用户在设置中开启。

### 为什么不用普通 Tool 做核心控制

普通 Tool 点击后会成为 active tool；音频控制通常不需要接管地图 pointer events。

因此把音频主入口做成 Tool 反而会打断 DM 的地图操作上下文。

---

## 6. Arbitrary Popover：贴近工具栏的 Cue Cart

`OBR.popover.open()` 可以把自定义 iframe 锚定到指定 Owlbear element。

适合：

- 从 Tool Action 打开一个小型 Cue Cart；
- 显示 8–16 个 SFX / Scene Pad；
- 当前 Scene 的局部快捷控制；
- 临时 Mixer strip。

这比每次把鼠标移动回左上角 Action 更快，又不用常驻占据画布。

原则：Popover 是 **局部临场面板**，不是 Library/Studio。

---

## 7. Context Menu：把声音绑定到游戏对象

Context Menu 只有选中 Scene item 时出现，因此不适合作为播放器主入口，但非常适合未来的“声音和世界对象关联”。

推荐未来功能：

- `Bind Sound…`
- `Bind Cue…`
- `Trigger Bound Sound`
- `Set as Spatial Emitter`
- `Open Audio Inspector`

例如：

- 门 Token → 开门声
- Boss Token → Boss Theme / Death Devamp
- 火堆 Prop → Fire ambience emitter
- 地图区域 → Scene/ambience trigger

绑定信息可以存进 item metadata，并使用扩展自己的 reverse-domain key，避免和其他扩展冲突。

第一版播放核心无需 Context Menu；先把数据模型预留好。

---

## 8. Tool Mode：只留给“空间音频编辑”，不要滥用

Tool Mode 会成为 active mode，并收到 click / drag pointer events。

它真正适合的是未来的地图音频空间工具，例如：

- 点击地图放置 Sound Emitter；
- 拖动 emitter 位置；
- 调整听音半径；
- 绘制区域触发器；
- 编辑方向性声音范围。

这是一种编辑工具，而不是常规 Play/Pause UI。

因此第一阶段：**不创建 Audio Tool Mode。**

---

## 9. Background page：正式的本地播放 Owner + Coordinator

Manifest 官方支持 `background_url`；官方 Custom Tool 教程也使用 background site 来常驻处理 SDK 通信。

Background 很适合承担：

- Broadcast listener
- GM authoritative state coordinator
- 房间状态恢复
- reconnect handling
- preload queue bookkeeping
- sync clock / drift data
- Action badge 更新
- Tool Action / Context Menu 注册
- Compact / Modal / Popover 之间的状态桥

### Autoplay / user activation 已完成 Chrome 真机验证

浏览器 autoplay / user activation 仍是硬约束：全新 Background iframe 在 `navigator.userActivation.hasBeenActive=false` 时直接 `play()` 会抛 `NotAllowedError`。

但 clean-room 实验已经证明下面这条正式链路成立：

1. 新建全新的 Owlbear Room tab，Background 初始 `isActive=false / hasBeenActive=false`；
2. Action 通过真实鼠标事件触发一次播放命令；
3. Action 使用 `OBR.broadcast` 的 `LOCAL` destination 把命令发给 Background；
4. Background 在自己的 handler 内执行 `AudioEngine.unlock()`；
5. Background 的 `AudioContext` 成功进入 `running`，`isUnlocked=true`；
6. 同一个 handler 随后创建/播放 MUSIC channel，`readyState=4`，播放时钟正常前进；
7. Action 收起后 Background 播放继续；后续无需新的 transient activation 即可再启动媒体。

因此桌面 Chromium 当前已可正式采用：

> **Action = 显式用户手势入口；Background = 唯一 Audio Host + Coordinator。**

仍需后续兼容性测试：Firefox / Safari / iOS / 页面冻结 / 内存回收 / Room reconnect。

---

## 10. 播放 Owner 候选架构

### 方案 A：Action iframe 既是 Live UI，也是播放 owner

优点：

- 用户点击 Play 的 gesture 直接发生在真正调用 audio 的 document；
- autoplay 最容易处理；
- 现有 Owlbear 音频扩展 Tracks 也是 Action-centric 架构；
- 实测 Owlbear Action iframe 即使 popover 收起，iframe 仍可能保留在页面中。

风险：

- “Action 收起后 iframe 保留”不是我们应该盲目依赖的公开生命周期契约；
- 移动端、内存回收、重新加载、Room lifecycle 需要测试；
- Action UI HMR/重挂载不应让 engine 被 React 生命周期误销毁。

如果采用此方案，AudioEngine 必须放在 React tree 外的单例 runtime 中。

### 方案 B：Background iframe 是播放 owner

优点：

- 语义最符合“持续后台引擎”；
- UI surface 全部成为纯控制器；
- Modal/Action 的开关不会碰播放器。

风险：

- 首次 autoplay unlock 可能失败；
- background iframe 的 media/audio lifecycle 需要真实浏览器验证。

### 最终优先方案：Background 是唯一 Audio Host

当前桌面 Chrome / Owlbear 真机实验已经让方案 B 胜出：

- Background：唯一 `AudioEngine` owner + authoritative local coordinator；
- Action：Live Console + 首次 user gesture / Enable Audio；
- Full Studio / Tool Action / Popover：纯命令控制器；
- LOCAL Broadcast：同一浏览器内 UI surface → Background RPC；
- Background 回 ACK / snapshot，UI 不直接读取媒体节点；
- Action popover 是否被关闭、React 是否重新渲染，都不影响 transport。

Action iframe 关闭后不销毁、媒体可继续播放这一行为也被实测过，但它不再是架构前提，只作为容错余量。

---

## 11. 玩家端与 GM 端界面

角色由 `OBR.player.getRole()` / player role 判断。

### GM

拥有：

- Library / Import
- Cue authoring
- Scene authoring
- Play / GO / Devamp / Panic
- Mixer
- Sync diagnostics

### PLAYER

默认只需要：

- 当前播放状态
- Local Master Volume
- Mute
- “Enable Audio” 状态
- 必要的 reconnect / autoplay 提示

玩家不应该看到 GM 的 Cue Stack、下一首、私密 Audition 或准备中的 Boss music。

---

## 12. 同步与状态通道

### Broadcast：瞬时命令

官方 Broadcast 是 ephemeral JSON message，单消息上限 16 KB，可指定 REMOTE / LOCAL / ALL。

适合：

- PLAY / PAUSE / STOP
- ARM / GO
- DEVAMP
- Scene transition
- current authoritative clock snapshot
- drift correction
- player ready/audio-unlocked ACK

不适合：

- 保存整个 Library
- 保存波形
- 保存大型 Cue Show JSON

### Room metadata：小型持久房间状态

Room metadata 总量必须低于 16 KB，只适合小状态。

建议只存：

- schema version
- current show id / revision
- current cue id
- current scene id
- transport state
- compact recovery checkpoint

不要放媒体库和大型编排数据。

### IndexedDB：本地用户数据库

保存：

- Library index
- Asset metadata
- Cue/Scene authoring data
- waveform peaks
- loudness analysis
- local settings
- collection/setup state

长期共享 Show 数据如果超出 room metadata，需要另设计可同步的小文档/资产方案，而不是硬塞进 metadata。

---

## 13. Notification

Notification 只用于异常和需要用户处理的状态，不用来承担常规控制：

- Audio blocked：需要点击 Enable Audio
- Missing asset
- 玩家解码失败
- Sync degraded
- Collection setup required
- Storage quota low

正常切歌、Cue transition 不应不断弹通知。

---

## 14. 推荐 UI 组合总表

| Surface | 第一版职责 | 是否持续存在 | 是否依赖 Scene | 是否控制音频 |
| --- | --- | --- | --- | --- |
| Action | Live Console / Enable Audio / 主入口 | 临时 UI；生命周期不再关键 | 否 | 发送命令，不持有 AudioEngine |
| Background | AudioEngine / Sync / state / registrations | 是 | 否 | **唯一 Audio Host** |
| Full-screen Modal | Director / Studio | 否 | 否 | 发送控制命令 |
| Tool Action | GO / Devamp / Panic | 注册持续，UI 仅 Scene 时可见 | 是 | 发送命令 |
| Popover | Cue Cart / Pads | 临时 | 否/可由 Tool Action 打开 | 发送命令 |
| Context Menu | Bind Sound/Cue | 按选择出现 | 是 | 绑定/触发 |
| Tool Mode | Spatial Audio Editor | 激活时 | 是 | 编辑 emitter，不做 transport |
| Notification | Error / attention | 临时 | 否 | 否 |

---

## 15. 第一版实现顺序

1. Background coordinator + AudioEngine owner skeleton。✅
2. Action → LOCAL Broadcast → Background runtime protocol。✅
3. 验证 user activation / autoplay / Background 连续播放。✅（桌面 Chrome）
4. Live Console transport controls。
5. Full-screen Studio controller。
6. 单个 Tool Action：`GO`。
7. Action badge 状态。
8. PLAYER local volume / audio unlock。
9. Cue Cart popover。
10. Context Menu / Spatial Tool 以后再做。

---

## 16. 关键设计约束

- 永远只有一个本地 audio playback owner，避免多个 iframe 同时出声。
- UI mount/unmount 不等于 transport start/stop。
- 任何 surface 都不保存唯一真相；状态由 coordinator/model 管理。
- GM 的编辑信息和玩家可见播放信息必须分离。
- 没有 Scene 时，Audio 仍必须可用。
- 手机、Firefox、Safari、private browsing、页面后台化都必须作为正式兼容场景，而不是 Chrome 桌面特例。
