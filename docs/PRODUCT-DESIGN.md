# Owlbear Audio — 产品与交互设计纲领

> 核心原则：**我可以不用，但你不能没有。**
>
> 简单不是删除复杂能力，而是通过 progressive disclosure（渐进式暴露）让复杂能力在需要时出现。Live、Director、Advanced 三种界面必须操纵同一套底层模型；预设、Scene 和“一键操作”只是复杂能力的高层入口，而不是能力边界。

## 1. 我们不做什么

Owlbear Audio 不是“Tracks 的漂亮替代品”，也不是普通歌单播放器，更不是要求 DM 临场兼职专业 DJ 的迷你 DAW。

目标是 **TTRPG Sound Director / Show Control System**：吸收 DJ 软件、剧场 Cue 系统和 Ableton Session View 各自最适合跑团的部分，同时把临场认知负担压到最低。

## 2. DJ 范式：把线性录音变成实时可操纵素材

DJ 软件的关键不是“播放两首歌”，而是：

- Deck A 播放当前节目；Deck B 私下准备下一段。
- Cue / Monitor Bus 让操作者在耳机里试听而不让观众听见。
- Cue Point / Hot Cue 让素材能瞬间跳到有意义的位置。
- Loop / Hot Loop 把一段乐句变成可无限延长的结构。
- Crossfader、Gain、EQ、Filter 负责人工接管转场和混音。
- Sampler / One-shot Pad 负责短促、非线性的声音事件。
- Waveform 是准备和高级编辑工具，而不是 DM 临场必须盯着看的中心 UI。

### 对跑团的直接映射

- Deck A/B → 当前音乐 / 下一首候选。
- Cue Bus → GM 私人试听。
- Hot Cue → Intro、高潮、战斗段、胜利段等语义入口。
- Loop → 战斗、潜行、追逐等时长不可预测的剧情段。
- Sampler → 门、爆炸、雷声、龙吼、法术、金币等即时 SFX。
- Mixer → 高级 DM 的人工接管能力。

原则：普通 DM 可以完全不碰 Deck 和 Mixer，但高级用户必须能下钻到这里。

## 3. 剧场 Cue 范式：DM 更像舞台音响师，而不是 DJ

跑团最大的不同是剧情时长不可预测。玩家可能 30 秒结束战斗，也可能和 Boss 谈判 47 分钟。因此系统的中心对象应是 **Cue（动作）**，而不是 Track（歌曲）。

### Cue List

按剧情顺序描述“下一步发生什么”。例如：

1. 开门声。
2. 酒馆音乐 2.5 秒淡出。
3. 启动地下室环境声。
4. Wait / Hold。
5. 启动战斗音乐。

Cue 可以是 PLAY、STOP、FADE、WAIT、LOAD、SET_PARAM、START_SCENE、GROUP 等动作，而不是只有“播放一首歌”。

### Cue Cart

无固定顺序的按钮墙，用于临场任意触发：开门、剑击、爆炸、雷、龙吼、钟声、尖叫、火焰等。支持快捷键、收藏 Pad，未来可考虑 Owlbear 场景/Token 事件绑定。

### Devamp：一级核心能力

典型素材结构：

`Intro -> Combat Loop -> Victory Outro`

Combat Loop 可以无限循环。Boss 倒下时，DM 只按一次 `DEVAMP / EXIT LOOP`。播放器不立即硬切，而是等当前循环/乐句走到合法出口，再自然进入 Outro。

这是解决“剧情时长不可预测”和“音乐仍需有结构性收尾”矛盾的核心工具，应进入 Live Mode 一级控制，而不是藏在高级菜单。

### Audition / Private Preview

玩家继续听 Dungeon 03 时，GM 可以只在自己的监听输出试听 Boss 07、Boss 09，选中后 `ARM NEXT`，剧情到点再 `GO`。艺术判断保留给 DM，但试听不会污染玩家体验。

### Preload

下一 Cue / Scene 所需素材应提前下载、解码和准备，GO 应尽可能成为低延迟确定性动作。

## 4. Ableton Session 范式：Scene + Layer，而不是“一场景一首 MP3”

Scene 是多条 Layer / Bus 的目标状态集合。

推荐基础 Layer：

- Music
- Ambience
- Weather
- Crowd
- Texture
- SFX

例如“雨夜酒馆”不是一个 `rain_tavern.mp3`，而可以是：

- Music → Tavern 02
- Ambience → Indoor Room Tone
- Weather → Heavy Rain
- Crowd → Low Murmur
- Texture → Fireplace

DM 只按一次“雨夜酒馆”，底层同时改变多个 Layer。

### Follow Action / 随机变体

环境声不应长期重复一段完整录音。可以让 Forest Base 持续循环，同时 Bird A/B/C 随机出现、Wind 低概率出现、Branch Crack 偶发。通过随机/概率 Follow Action 降低“听出循环点”的机械感。

## 5. 三层 UI，同一底层模型

### Live / Compact — 临场导演台

目标：DM 看一眼、按一下，立即回到叙事。

一级控件：

- 当前 Scene / 主音乐。
- `GO / NEXT`。
- `HOLD`。
- `DEVAMP / EXIT LOOP`。
- `PANIC / STOP ALL`。
- Play / Pause。
- Master / Music / Ambience 三个关键音量。
- 4–8 个收藏 Pad。
- 当前 Cue 与下一 Cue 的明确状态。
- 进入 Full Studio。

不展示大面积波形、完整 EQ、复杂路由或几十个参数。

### Director — 编排工作台

用于开团前准备和需要更多控制的临场阶段：

- 左：Library / Search / Tags / Playlist / SoundSet。
- 中：Cue List / Scene Grid / Cue Cart 视图切换。
- 下：Now Playing / Armed / Queue。
- 右：Inspector，编辑 Cue、Clip、Scene。
- 顶：Master、同步、玩家连接和错误状态。

### Advanced / DJ Studio — 完整能力

按需展开：

- Deck A / B。
- 双波形。
- Hot Cue / Loop 编辑。
- Crossfader。
- Gain / EQ / Filter。
- Bus Mixer。
- Sampler Banks。
- Automation / Fade Curves。
- BPM / Beat Grid / Quantize / Sync（只有验证跑团收益后再提升优先级）。

高级模式不是另一套播放器，而是把 Director 中同一对象的底层参数全部显露出来。

## 6. Scene 是宏，不是牢笼

普通用户看到：

`🌧 雨夜酒馆`

高级用户展开后看到真实定义，例如：

- Music Bus → Tavern_02, -10 dB
- Ambience → RoomTone_01, -22 dB
- Weather → Rain_Heavy, -18 dB
- Crowd → Murmur_Low, -26 dB
- transition → 2.4 s equal-power crossfade
- preserve SFX bus → true

任何一键预设都必须可展开、可修改、可复制、可组合；不能存在“预设能做到，但高级模式反而无法表达”的隐藏魔法。

## 7. 自动化必须可接管

系统应默认替 DM 做机械工作：响度归一化、equal-power crossfade、预加载、环境音无缝循环、Scene 只更新必要 Layer、SFX 不抢占 Music/Ambience。

但所有自动动作必须允许：

- Skip
- Hold
- Fire Now
- Cancel
- Override
- Return to Programmed State

自动化的目的不是替 DM 作艺术判断，而是让 DM 不必盯秒表、拖滑杆、找文件。

## 8. 统一数据模型

`Asset -> Clip -> Cue -> Bus/Layer -> Scene -> Cue Stack/Show`

另有 `Cart / Pad Bank` 作为无序触发集合。

UI 的所有层级都围绕这套模型工作：

- Live Mode 触发已经编好的 Cue / Scene。
- Director Mode 组织和编辑它们。
- Advanced Mode 修改 Clip、Deck、Bus、Loop、Automation 等底层细节。

这样才能保证“简单入口”和“复杂能力”不会随着开发逐渐分裂。

## 9. 产品优先级

跑团价值优先级高：

1. 稳定播放与同步。
2. Cue / GO / Hold / Panic。
3. Scene + Layer。
4. Devamp。
5. Preload。
6. GM 私人试听。
7. Cue Cart / Pads。
8. Fade / Automation。
9. 随机与概率 Follow Action。
10. 高级 Mixer / Hot Cue / Loop 编辑。

较低优先级、先保留模型空间但不急于实现：beatmatching、key matching、复杂 DJ FX、完整 DAW 式编辑。

## 10. 一句话产品定义

**让普通 DM 像按舞台 Cue 一样简单地控制声音，同时让高级 DM 在需要时拥有真正的 DJ / 剧场 Show Control 级能力。**
