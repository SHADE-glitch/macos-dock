<p align="right"><a href="README.md">English</a> | <a href="README.zh-CN.md"><b>简体中文</b></a></p>

# MacOS Dock —— 本地维护分支

为 GNOME Shell 打造的 macOS 风格 Dock，支持放大、动画、避让、键盘导航与 Genie 最小化/还原动画。

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: MIT + GPL-2.0-or-later](https://img.shields.io/badge/license-MIT%20%2B%20GPL--2.0--or--later-green)
![Based on: MacOSDock + macos-genie](https://img.shields.io/badge/based%20on-MacOSDock%20%2B%20macos--genie-orange)
[![Repository](https://img.shields.io/badge/repository-GitHub-black?logo=github)](https://github.com/SHADE-glitch/macos-dock)

## 项目说明

本仓库是 **vinnytherobot** 的 [**MacOSDock**](https://github.com/vinnytherobot/MacOSDock)（同时上架于 [extensions.gnome.org](https://extensions.gnome.org/extension/10719/macos-dock/)，编号 #10719）的**个人维护分支**，冻结在上游 **v9** 版本，以 `macos-dock@local` 为 UUID 在本地维护。本分支还合并了 **Thuong Vo（SekiroKenjii）** 的 **macOS Genie** 最小化/还原动画。

本项目**与上游作者无关**，也未获得其背书。本分支保留上游功能，重点处理**启动闪烁、资源泄漏、空闲功耗以及分隔线/显隐逻辑**，并采用保守、可回退的维护风格。

## 功能特性

- **macOS 风格 Dock**，可配置图标尺寸、位置、不透明度、圆角、模糊、背景色与图标质量。
- **放大效果** —— 基于时间的指数平滑（与帧率无关），带指针死区与可配置衰减。
- **窗口预览** —— 悬停显示，缩放比例可调。
- **避让 / 自动隐藏** —— 仅聚焦时隐藏、贴边窥探（peek）、窥探保持延迟、全屏时隐藏。
- **键盘导航** —— `Super` + `1` … `0` 启动、聚焦、切换或最小化前十个应用，并短暂弹出 Dock 让你看清。
- **运行指示器**、启动弹跳、动画时长与显示阈值。
- **媒体控制**（MPRIS），可选指示器。
- **分隔线** —— 将收藏应用与正在运行的非收藏应用分开。
- **应用按钮**、运行应用展示与工作区模式设置。
- **Genie 最小化/还原动画** —— 窗口从任意 Dock 边缘流进/流出其**真实 Dock 图标**，合并自 macOS Genie。

## 前置依赖

| 依赖 | 说明 |
|---|---|
| GNOME Shell | 48 – 50 |

## 安装

```bash
git clone https://github.com/SHADE-glitch/macos-dock.git ~/.local/share/gnome-shell/extensions/macos-dock@local
cd ~/.local/share/gnome-shell/extensions/macos-dock@local
glib-compile-schemas schemas/
gnome-extensions enable macos-dock@local
```

在 Wayland 下需注销后重新登录，GNOME Shell 才会加载扩展。

### 卸载

```bash
gnome-extensions disable macos-dock@local
rm -rf ~/.local/share/gnome-shell/extensions/macos-dock@local
```

## 使用

启用后，Dock 会出现在配置的屏幕边缘。悬停可放大并显示预览；点击图标启动或聚焦对应应用；右键打开应用菜单。使用 `Super` + 数字键按位置启动应用，每次都会短暂弹出 Dock。

## 偏好设置

打开 **GNOME 设置 → 扩展 → MacOS Dock → 设置**，可配置外观与位置、放大效果、预览、避让/自动隐藏、键盘导航（含弹出 Dock）、媒体控制、运行指示器、分隔线、动画时长与 Genie 最小化/还原动画。

## Genie 动画

最小化或还原窗口时会播放 macOS Genie 动画：窗口被切成条带，经由弯曲的漏斗流进/流出其**真实 Dock 图标**。漏斗轴向跟随 Dock 所在的屏幕边缘，因此下、上、左、右四种 Dock 位置都能正确收束。动画目标是纯图标方块（不含运行指示点），在动画开始时对图标当前放大后的位置取一次快照；当应用没有可见图标时按回退链处理（实时矩形 → 上一次缓存的矩形 → Dock 边缘中心 → 主屏上 Dock 所在的那条边）。**两个方向**都基于窗口的同一份快照运行，实时窗口在动画期间被停放（缩放 ≈ 0），不再逐帧重绘。即使窗口紧贴甚至压在图标上，漏斗仍保留饱满的"肚腩"；尾部条带各自溶解而非整体淡出容器；缓动改为快起、收尾急吸；窗口落位时目标图标轻微下压回弹（独立开关）。条带数量随窗口在漏斗轴向上的尺寸自适应，以网格分辨率设置为上限（默认 64），小窗口省算力、大窗口够顺滑。

Dock 因避让而隐藏时，会在动画期间短暂**探头（peek）**，让你看清窗口飞去了哪里；该行为可关闭，关闭后窗口改为飞向 Dock 所在的屏幕边缘并保持图标在该边上的位置。Genie 动画进行期间会暂停放大效果，且 Dock 沿自身轴向滑动（上下 Dock 竖直移动，左右 Dock 水平移动）；避让轮询在指针远离 Dock 后自行停机，并在下一次指针或窗口事件时唤醒，空闲 Dock 不再持续轮询。工具窗与后台窗沿用系统原生动画。Genie 仅在 Dock 启用时生效，启动时会校验所需的 Shell 私有 API，缺失则大声记录警告并退化为系统原生动画。

如果你安装了独立的 `macos-genie@thuongvo.dev` 扩展，请**停用它** —— 本分支已提供相同动画，两者同时启用会争抢同一批窗口。

## 测试

两个不依赖 GNOME/GI 导入的模块配有单元测试，用纯 Node 即可运行 —— 无需 `gjs`、无依赖、无构建步骤：

```
npm test
```

- `lib/genieGeometry.js` → `test/genieGeometry.test.js`（坐标变换、缓动、Dock 位置表、条带变换契约）
- `lib/signalManager.js` → `test/signalManager.test.js`（连接记账：按 source 断开、容错、幂等清理）

依赖 GI 的模块无法在 shell 之外导入，改为在实机验证。修 bug 时请先补一个在**修复前代码上会失败**的回归测试，再让它通过。

## 相对上游的改动（v9）

本分支在上游 v9 基线（`a2140d0`）之上新增若干维护提交，并合并了 macOS Genie 最小化/还原动画：

- **启动 / 闪烁：** 恢复 `_started` 启动守卫，修复登录后整排 Dock 图标闪烁；对 `installed-changed` 与 `favorite-apps` 一律增量同步，根除 settle 之外的全量重建闪烁；合并避让/显隐模块；回退过宽的性能/时序改动以收紧范围。
- **资源泄漏与崩溃守卫：** 放大轮询与 dock 管理器增加容器销毁门卫；窗口变更淡出 `onComplete` 增加已销毁 actor 守卫；避让 `stop()`/`_refreshDodge()` 尊重启动淡入，不再强制 `opacity = 255`；避让隐藏日志移到 `_hide()` 守卫之后。
- **性能 / 空闲功耗：** 放大效果空闲停表、靠近时重启，消除 60Hz 常驻唤醒；避让轮询自适应降频（近边缘 120ms，其余 500ms 心跳）。
- **预览：** 预览弹窗跟随悬停应用切换，同一应用复用弹窗，退场动画中可复活。
- **键盘导航：** 为 stock 快捷键增加**崩溃自愈 sentinel** —— 在扩展自有 schema 中保存备份与 dirty 标记。
- **分隔线：** 修复 `_enforceOrder` 误报（索引比较剔除分隔线/按钮，稳态零移动）；新增分隔线增删打点日志；分隔线删线与图标淡出对齐；grace 条件化提前结束（下限 400ms + 静默 500ms，上限 1200ms）。
- **正确性：** 窗口类型判断改用 `Meta.WindowType` 符号。
- **Genie 合并：** 并入 macOS Genie 最小化/还原动画（`lib/genieGeometry.js`、`lib/genieEngine.js`、`lib/genieController.js`）—— 飞向真实 Dock 图标，快照实时放大位置，按实时矩形 → 缓存矩形 → Dock 边缘的回退链处理，可选对避让隐藏的 Dock 探头，启动时校验 Shell 私有 API（缺失则退化原生动画），并保证完成回调恰好一次。
- **热键弹出 Dock：** `Super` + 数字现在对每个动作（启动/聚焦/切换/最小化）都短暂弹出隐藏的 Dock，并提供独立开关与时长；探头请求取最长待定时长，热键的探头不会被更短的请求截短。
- **Genie 正确性与保真：** 漏斗轴向与两条无图标回退路径现在都由 `dock-position` 推导，上/左/右 Dock 也能收束到正确的边；最小化与还原**两个方向**都基于同一份窗口快照运行（实时窗口在动画期间被停放）；尾部条带各自溶解而非整体淡出容器；缓动改为快起 + 收尾急吸；网格分辨率设置改为**上限**（默认降到 64），条带数量随窗口在漏斗轴向上的尺寸自适应；吸入深度回退值与 schema 默认值对齐。漏斗锥度仍至少覆盖窗口自身高度（窗口压在图标上不被压扁），吸入目标仍保留最小下沉量。
- **Genie 性能：** `layoutStrips` 每帧零分配（已逐位比对与旧矩阵完全一致，约 2.5× 提速）；Genie 动画期间暂停放大效果，暂停/恢复采用引用计数，无论正常完成、异常还是卸载都不会泄漏挂起。
- **图标反应：** 窗口最小化进图标或从图标还原时，目标图标轻微下压回弹，并提供独立开关。
- **图标淡入：** 由增量同步（窗口变化、收藏同步）新增的图标在 180ms 内淡入；整表 reload 与启动首建仍保留单次容器级淡入。
- **放大平滑：** 用基于时间的指数平滑替换逐 tick 的 LERP 系数，60/120/144/240Hz 下的收敛时间一致。
- **避让空闲功耗：** 指针远离 Dock 后避让轮询自行停机 —— 但 Dock 隐藏时绝不停机（轮询正是探头愈合机制）—— 并在下一次指针或窗口事件时唤醒。
- **启动首帧：** Dock 在首帧即揭示，而不是等 settle grace 结束，完全不透明从约 T0+1440ms 提前到约 T0+250ms；grace 收尾改走增量同步而非整表重建 —— 后者正是过去整排图标闪烁的来源。
- **分隔线稳定性：** 分隔线改按 **settled**（动画收敛后）的图标集合判定，淡出中的图标不再计入，因此最小化最后一个运行中的非收藏应用时 Dock 不会再宽 15px 又弹回。计数也改为直接读真实图标表，不再二次查询运行集 —— 那条路可能计入一个 `AppSystem.lookup_app()` 解析不出 id 的应用（新增路径本来就会跳过它），从而升起一条孤儿分隔线。
- **避让正确性与开销：** 为每个窗口挂 `position-changed` / `size-changed` / `unmanaged` 监听，因此拖动一个**已经聚焦**的窗口压到 Dock 上也会隐藏 —— 轮询停机后本来无从得知普通移动：`restacked` 不因移动触发，而整段拖动指针都可以待在远离边缘的一侧。全屏判定改为读 mutter 自己的每显示器状态（`Monitor.inFullscreen`，即 `ui/layout.js` 读的那个），作为一道 O(1) 的门；门只能**打开**权威扫描，绝不替代其结论。chrome 类型窗口不再被监听。
- **放大唤醒通路：** 新增容器 `notify::visible` 这条重启通路，因此 Dock 在**静止指针**下方被揭示时，光标下那个图标会立即放大，不必等下一次鼠标移动。
- **Genie 与 mutter 计数：** `_steal()` 现在**先于** `finishFor()`，且引擎只恢复它确实停放过的 actor。两者都是为了阻止 Clutter 的隐式转换移除机制把 `stopped` 送进 shell 的回调 —— 那会让一个效果上报两次完成，mutter 随即打印 "Error in minimize/unminimize accounting."。`MODAL_DIALOG` 加入参与动画的窗口类型以对齐 shell 自己的列表，模态对话框不再静默回落到原生动画。
- **Genie 轴向堆积：** 条带沿漏斗轴改为非均匀分布（`v^gamma`，gamma 随前缘渐入并由 curvature 滑杆缩放），材料因此在颈部堆积，而不是整个窗口等比例缩小 —— 即"被抽过喷嘴"的观感。静止时分布严格均匀，未动的窗口绝不会被扭曲；`curvature = 0` 时逐位退回改动前的行为。
- **无障碍：** 最小化/还原时长通过 shell 自己的 `adjustAnimationTime()` 遵循全局"减慢动画"系数，且换算发生在 100–3000ms 的 clamp **之后**，因此该系数可以突破滑杆上限。
- **指示点刷新开销：** 每轮指示点刷新只做一次窗口 actor 走查，而不是每个图标一次（17 图标的 Dock 即 17 → 1）；共享结果挂在一轮 pass 的作用域上，iconFix 那个固定两参数的包装不会把它丢掉。
- **已销毁 actor 守卫：** 图标下压回弹的存活判定容忍 wrapper 已被销毁 —— 兜底回调在一次整表 reload 之后最长还会存活 `step*3+120` ms。
- **开机后 Dock 不在位：** 隐藏动画期间到达的显示请求现在会被记下、并在该动画结束时补做，而不是在守卫处被丢弃且再没有任何机制重新触发它 —— 这个丢弃叠上隐藏态的 500ms 心跳，曾让 Dock 在登录后消失约 810ms，并打印 8 条完全相同的日志。ease 的 `onComplete`、它的 `catch`、`dur === 0` 早返回和兜底 watchdog 都会兑现它；日志移进 `_show()` 且只对具名调用打印，因此探头路径自己那条日志的形状不变。
- **启动避让宽限改为静默判据：** 原先固定 2s 的宽限短于真实冷启动的自启动爆发（journal 证实到期后 800ms 仍在拉起窗口），于是宽限过期后的第一次判定命中一个 166ms 之后就自行消失的瞬时重叠，Dock 被隐藏。现在是下限 2000ms + 窗口静默 500ms，并受 6000ms 硬上限约束，形状与 iconManager 既有的宽限设计一致 —— 安静会话仍在恰好 2000ms 放行。它是闸门而非一次性计时器：之后的窗口事件会把它重新关上，且打戳发生在评估**之前**，所以"本该触发这次隐藏的那个事件"会先把闸门关上。轮询停表判定共用同一判据，并在闸门重新武装时唤醒轮询。

## 参与贡献

欢迎提交 Issue 与 Pull Request。请保持改动范围聚焦，并针对上述 GNOME Shell 版本进行测试。

## 致谢与来源说明

本扩展是 **vinnytherobot** 的 **MacOSDock** 的**维护分支**，并**合并**了 **Thuong Vo（SekiroKenjii）** 的 macOS Genie 动画。原始设计与功能均出自其手。

- **Dock 上游：** [vinnytherobot/MacOSDock](https://github.com/vinnytherobot/MacOSDock) —— 许可证 **MIT**
- **Dock 上游作者：** vinnytherobot
- **GNOME 扩展页面：** [#10719](https://extensions.gnome.org/extension/10719/macos-dock/)
- **分支基线：** 上游 **v9**（提交 `a2140d0`）
- **Genie 上游：** [SekiroKenjii/macos-genie](https://github.com/SekiroKenjii/macos-genie) —— 许可证 **GPL-2.0-or-later**
- **Genie 作者：** Thuong Vo（SekiroKenjii）
- **合并与维护：** SHADE-glitch

## 许可证

Dock 代码采用 **MIT 许可证**；Genie 派生代码采用 **GPL-2.0-or-later**，合并后的整体以 **GPL-2.0-or-later** 分发。见 [LICENSE](LICENSE)、[LICENSE.GPL-2.0](LICENSE.GPL-2.0) 与 [LICENSES.md](LICENSES.md)。

© vinnytherobot 及贡献者；Genie 引擎 © Thuong Vo（SekiroKenjii）；分支修改与合并 © SHADE-glitch。
