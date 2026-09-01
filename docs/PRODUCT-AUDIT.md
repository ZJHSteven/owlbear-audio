# Owlbear Audio — Product Reality Audit

> 2026-08-31 纠错基线。本文优先级高于旧的阶段性进度描述。
>
> **Definition of Done：** 一个产品功能只有同时具备可发现的用户入口、真实运行时行为、状态/错误恢复，以及一条从用户视角可复现的验收路径，才算“Implemented”。只有类型、接口、文档或底层 primitive 时，统一标记为 Foundation / Not implemented。

## 1. 产品最终要做什么

一句话：**让 DM 像操作舞台 Cue 一样简单地控制整场跑团声音，同时允许高级用户下钻到 DJ / QLab / Ableton 式的编排和混音能力。**

统一模型仍然是：

`Asset -> Clip -> Cue -> Bus/Layer -> Scene -> Show`

另有 `Cue Cart / Pad Bank` 作为无固定顺序的即时触发集合。

## 2. 正确用户路线

### A. 第一次使用

1. 打开 Owlbear Audio。
2. 一次 `启用声音` 浏览器授权。
3. 进入 `准备`。
4. 拖入本地 MP3/WAV/M4A，或从 Owlbear Audio 资产库添加。
5. 素材自动转码、分析响度并进入声音库。
6. 用户可以试听，确认声音确实可用。

用户不应该先理解 Asset / Clip / Bus / WebM / Opus。

### B. 开团前准备

1. **声音库**：搜索、标签、分类、试听。
2. **场景 / Cue 编排**：把音乐、环境、音效组织成 Scene、Cue Stack 或 Cue Cart。
3. **片段编辑**：设定 Intro / Loop / Outro、Hot Cue、Loop Region、淡入淡出。
4. **监听与预演**：GM 私人试听，不广播给玩家。
5. `进入现场`。

### C. 跑团现场

主界面只回答：

- 现在是什么？
- 下一步是什么？
- 我要触发什么？
- 出问题怎么停？

一级控制：

- `GO`
- `DEVAMP / EXIT LOOP`（当前 Cue 支持时）
- `HOLD`
- `PANIC`
- 当前 Scene / NOW / NEXT
- 常用 SFX Pads

### D. 高级控制

按需展开，而不是默认塞满屏：

- Deck A/B
- Preview/Cue Bus
- Waveform
- Hot Cue / Loop Editor
- Mixer / EQ / Filter / FX
- Automation
- Follow Action / Random

## 3. 当前真实实现矩阵

| 功能 | 状态 | 当前真实程度 |
| --- | --- | --- |
| Background 单一 Audio Host | **Implemented foundation** | 真正播放 owner；Action 生命周期不影响播放 |
| GM/Player 当前播放同步 | **Implemented foundation** | NOW、播放位置、Pause/Resume/Panic、late join 已验证 |
| Music/Ambience/SFX/Voice Bus | **Partial** | Audio graph 有 4 路；UI 只暴露少量 gain，不是完整 mixer |
| 基础整轨播放 | **Implemented** | PLAY / pause / stop / seek / 整轨 loop |
| Equal-power crossfade | **Implemented foundation** | PLAY Cue 之间可淡化；缺高级转场编辑 |
| Cue Stack | **Minimal only** | 仅 PLAY Cue；可排序、gain、bus、整轨 loop、fade |
| GO / HOLD / PANIC | **Minimal implemented** | 可以驱动上面的 PLAY-only Cue Stack |
| 本地文件转 Opus/WebM | **Foundation implemented** | 浏览器转码已验证；产品导入 UX 尚未完整验收 |
| Owlbear Audio Collection 上传 | **Foundation implemented** | 媒体上传与 CDN 已独立验证；完整产品流仍需收敛 |
| Library 搜索 | **Minimal only** | 只有按名称 substring；无标签/分类/集合管理 |
| Loudness 分析 | **In progress foundation** | 分析器已写；尚未完成产品验收，不算功能完成 |
| Scene + Layer | **NOT IMPLEMENTED** | 只有类型/文档；没有 runtime 和 UI |
| DEVAMP / Exit Loop | **NOT IMPLEMENTED** | 只有类型/文档概念 |
| Loop Region | **NOT IMPLEMENTED** | 现在只有整轨 loop checkbox |
| Clip / In-Out 编辑 | **NOT IMPLEMENTED** | 无 UI、无 runtime |
| Cue Cart / Pads | **NOT IMPLEMENTED** | 无 UI、无 runtime |
| GM 私人试听 / Audition | **NOT IMPLEMENTED** | 无 Cue Bus / preview workflow |
| Deck A/B | **NOT IMPLEMENTED** | 无 UI、无 runtime 抽象 |
| Waveform | **NOT IMPLEMENTED** | 只有模型字段预留 |
| Hot Cue | **NOT IMPLEMENTED** | 只有文档概念 |
| Sampler | **NOT IMPLEMENTED** | 无功能 |
| Wait Cue | **NOT IMPLEMENTED** | 只有 core type |
| Group Cue | **NOT IMPLEMENTED** | 只有 core type |
| Random Choice | **NOT IMPLEMENTED** | 只有 core type |
| Auto-follow / Auto-continue | **NOT IMPLEMENTED** | 无 runtime |
| Automation | **NOT IMPLEMENTED** | 无功能 |
| EQ / Filter / FX | **NOT IMPLEMENTED** | AudioEngine 注释预留，不是功能 |
| 完整 Advanced Mixer | **NOT IMPLEMENTED** | 只有 3 个基础 level slider |
| Tool Action GO | **NOT IMPLEMENTED** | 尚未注册 |
| Context-menu spatial sound | **NOT IMPLEMENTED** | 未来能力 |

## 4. 当前 UI 的问题（不是 polish，而是产品问题）

1. **视觉系统仍来自 Vite 模板 + 自写 CSS**，没有成熟组件体系，密度、层级、控件状态和暗色模式都不统一。
2. **中英文混杂**：NOW/NEXT/GO/Library/Inspector/Import/中文提示混用，没有语言策略。
3. **Studio 三栏只是开发者数据结构的投影**，不是完整用户任务流。尤其“Advanced 以后会有……”属于把 TODO 直接展示给用户。
4. **导入过程暴露内部实现**：Local only、Link imported、Collection/保存阶段等概念过多，普通用户不应该理解云端引用修复细节。
5. **没有试听**，导致用户导入素材后连最基本的“这是不是我要的声音”都无法自然确认。
6. **没有 Scene / SFX Pad / Devamp**，所以 UI 无法体现最初产品卖点，看起来只是一个简陋顺序歌单。
7. **Diagnostics 暴露在正常 Live Footer**，测试工具污染产品入口。
8. 空状态太多且组件面积大，造成“白色空块很多”的观感。
9. 默认 UI 不应出现 WebM/Opus/bitrate/云端 Link 等基础设施语言，除非进入 Import Details / Diagnostics。

## 5. Owlbear surface 正确职责

- **Background iframe**：完全内部、不可见的 AudioEngine + Sync。产品正常使用不打开浏览器新标签页。
- **Action popover**：现场控制台，始终轻量。
- **Full-screen Modal**：准备 / 编排 / 高级 Studio，仍然位于 Owlbear 内部。
- **Owlbear Asset Picker**：只在需要选择资产时短暂接管宿主 modal；完成后返回 Studio。
- **外部浏览器 tab**：只属于开发/CDP 测试，不是产品路线。

## 6. “三个插件”的根因

仓库曾保留并安装：

- 旧 manifest URL（早期版本）
- `/manifest.json`
- 为绕过 Owlbear manifest 强缓存临时创建的 `/manifest-v2.json`

Owlbear 按安装 URL 识别自定义扩展，因此测试 URL 会表现成多个独立扩展条目。这是开发残留，不是产品设计。

纠正策略：

- 仓库只保留一个 canonical `/manifest.json`。
- 产品名去掉 `Lab` / `Probe`。
- diagnostics/probes 不出现在正常入口。
- 登录测试账户恢复后，删除旧的重复安装条目，只保留 canonical manifest。

## 7. 接下来真正的实现顺序

### Milestone 1 — Product Shell Reset

- 单一扩展入口 / 单一 manifest。
- 统一中文 UI（专业术语保留必要英文缩写即可）。
- 引入成熟 component primitives / design tokens，重做 Live + Studio shell。
- 去掉用户可见的 probe / diagnostics / TODO 文案。
- Studio 信息架构改为 `声音库 | 场景与 Cue | 即时音效 | 混音`，不是把 FIND/BUILD/TUNE 当整个产品。

### Milestone 2 — Minimum Real Product

必须同时实现并可见：

1. Import + 试听。
2. PLAY Cue Stack + GO。
3. Scene + Music/Ambience Layer。
4. SFX Cue Cart / Pads。
5. Devamp（Intro -> Loop -> Outro）。
6. GM private audition。
7. Player 自动同步。

做到这里才能称为“第一版真的能跑团”。

### Milestone 3 — Advanced Control

- Clip editor / waveform。
- Hot Cue / Loop Region。
- Deck A/B。
- Mixer / EQ / Filter。
- Automation / Follow Action。

## 8. 新验收原则

以后汇报必须分别写：

- **User-visible implemented**
- **Foundation implemented**
- **Prototype/test only**
- **Not implemented**

禁止再用“模型已建 / primitive 已有”代替“产品功能已完成”。
