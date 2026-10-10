<p align="right"><a href="README.md">English</a> | <a href="README.zh-CN.md"><b>简体中文</b></a></p>

# MacOS Dock —— 本地维护分支

带放大、动画、避让、键盘导航与 Genie 最小化/还原动画的 macOS 风格 GNOME Shell Dock。

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: MIT + GPL-2.0-or-later](https://img.shields.io/badge/license-MIT%20%2B%20GPL--2.0--or--later-green)
![Based on: MacOSDock + macos-genie](https://img.shields.io/badge/based%20on-MacOSDock%20%2B%20macos--genie-orange)
[![Repository](https://img.shields.io/badge/repository-GitHub-black?logo=github)](https://github.com/SHADE-glitch/macos-dock)

## 📖 项目说明

本仓库是 **vinnytherobot** 的 [**MacOSDock**](https://github.com/vinnytherobot/MacOSDock)（也在 [extensions.gnome.org](https://extensions.gnome.org/extension/10719/macos-dock/)，编号 #10719）的**个人维护分支**，冻结在上游 **v9**，以 UUID `macos-dock@local` 在本地维护。同时合并了 **Thuong Vo（SekiroKenjii）** 的 **macOS Genie** 最小化/还原动画。

本分支**不隶属于**上游作者，也未获其背书。它保留上游功能集，聚焦**启动闪烁、资源泄漏、空闲功耗以及分隔线/显隐逻辑**，维护风格保守、可回滚。

## ✨ 功能特性

- **macOS 风格 Dock** —— 图标尺寸、位置、不透明度、圆角、模糊、背景色与图标质量均可配置。
- **放大效果** —— 基于时间的指数平滑（与帧率无关），带指针死区与可调衰减。
- **窗口预览** —— 悬停显示，缩放比例可配置。
- **避让 / 自动隐藏** —— 仅聚焦时隐藏、探头边缘、探头保持延时、全屏时隐藏。
- **键盘导航** —— `Super` + `1`…`0` 启动、聚焦、切换或最小化前十个应用，并短暂弹出 Dock 让你看得见。
- **运行指示点**、启动跳动、动画时长与显示阈值。
- **媒体控制** —— 通过 MPRIS，可选指示点。
- **分隔线** —— 把收藏项与运行中的非收藏项分开。
- **应用按钮**、运行中应用显示与工作区模式设置。
- **Genie 最小化/还原** —— 窗口从任意 Dock 边缘流进/流出其**真实 Dock 图标**，即合并进来的 macOS Genie 动画。

## 🧰 前置依赖

| 依赖 | 说明 |
|---|---|
| 系统 | Ubuntu（已在 Ubuntu 26.04 验证） |
| GNOME Shell | 48 – 50 |
| 构建工具 | `glib-compile-schemas` |

## 📥 安装

```bash
sudo apt install libglib2.0-bin   # glib-compile-schemas

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

## 🖱️ 使用

启用后，Dock 会出现在配置的屏幕边缘。悬停可放大并显示预览；点击图标启动或聚焦对应应用；右键打开应用菜单。使用 `Super` + 数字键按位置启动应用，每次都会短暂弹出 Dock。

## ⚙️ 偏好设置

打开 **GNOME 设置 → 扩展 → MacOS Dock → 设置**，可配置外观与位置、放大效果、预览、避让/自动隐藏、键盘导航（含弹出 Dock）、媒体控制、运行指示器、分隔线、动画时长与 Genie 最小化/还原动画。

## 📚 设置项说明

扩展读取的每一个键，以及出厂默认值。内容取自
`schemas/org.gnome.shell.extensions.macosdock.gschema.xml`；往 schema 里加键却没在这里加一行，
`test/repo.test.js` 会直接失败。57 个键里偏好窗口绑定了 45 个：十个 `keynav-app-N` 由键盘代码
写入（Super+数字抢的是 shell 自己的快捷键），`keynav-stock-backup` / `keynav-stock-dirty` 是它的
崩溃恢复记账 —— 这 12 个界面上有意没有对应的行。

### Dock 尺寸、外观与位置

| 键 | 默认值 | 作用 |
|---|---|---|
| `icon-size` | `48` | 图标像素尺寸（16–96） |
| `dock-opacity` | `60` | dock 背景不透明度百分比（0–100） |
| `dock-background-color` | `'#1e1e1e'` | dock 背景色（十六进制，如 #1e1e1e） |
| `dock-border-radius` | `16` | dock 圆角像素 |
| `dock-blur-enabled` | `false` | 在 dock 后面加模糊（毛玻璃） |
| `dock-position` | `0` | dock 贴哪条边（0=下 1=左 2=右 3=上） |
| `icon-quality` | `2` | 按原生分辨率 N 倍渲染图标，放大时不发虚（1/2/4） |
| `animation-duration` | `200` | 显示/隐藏动画时长毫秒（0=立即，上限 1000） |
| `bounce-on-launch` | `true` | 新应用启动时图标播放弹跳 |

### 放大

| 键 | 默认值 | 作用 |
|---|---|---|
| `magnification-enabled` | `true` | 指针靠近 dock 时图标是否长大 |
| `magnification-scale` | `1.4` | 光标正下方图标的最大缩放（1.0=不放大） |
| `magnification-falloff` | `100` | 放大波从指针向外延伸的像素距离 |
| `magnification-framerate` | `60` | 放大动画目标帧率 Hz（30/60/120） |

### 指示器与媒体

| 键 | 默认值 | 作用 |
|---|---|---|
| `running-indicators` | `true` | 运行中应用图标下方显示小点 |
| `running-indicator-style` | `0` | 0=每窗口一个点（macOS 风格），1=横向条 |
| `media-indicator` | `true` | 正在播放的媒体应用图标上加音符标记 |
| `media-controls` | `false` | 在右键菜单里显示播放/暂停/上一首/下一首 |

### 应用、窗口与预览

| 键 | 默认值 | 作用 |
|---|---|---|
| `show-applications-button` | `true` | 显示「所有应用」按钮 |
| `apps-button-fix-enabled` | `true` | 让 dock 的 Show Apps 按钮在概览内也进应用网格、并改用品牌图标（与「运行图标修复」彼此独立） |
| `show-running-apps` | `true` | 把非收藏的运行中应用也显示进 dock |
| `dock-workspace-mode` | `0` | 运行中应用按工作区显示（0=全部 1=仅当前） |
| `window-previews` | `true` | 悬停时显示窗口的实时缩略预览 |
| `preview-scale` | `200` | 每张预览缩略图的像素宽度（100–400） |
| `icons-fix-enabled` | `true` | 最小化/切工作区后仍保留非收藏的运行应用图标 |
| `overview-patches-enabled` | `true` | 把概览窗口预览内缩到桌面背景范围内，并在概览底部预留 dock 高度。属 shell 布局修复，与 dock 无关；shell 符号变动时自动退回原生布局 |

### 避让（自动隐藏）与探出

| 键 | 默认值 | 作用 |
|---|---|---|
| `dodge-enabled` | `true` | 只在被聚焦窗口压住 dock 时才隐藏 |
| `dodge-only-focused` | `true` | 仅当前聚焦窗口压住才隐藏（推荐）；关掉则任何窗口压住都隐藏 |
| `show-threshold` | `25` | 距屏幕边多少像素触发 dock 显示 |
| `peek-edge-px` | `5` | 指针要贴边到多少像素以内才探出隐藏的 dock |
| `peek-hold-ms` | `80` | 指针在深区停留多久才探出（0=立即） |
| `hide-in-fullscreen` | `true` | 真正的全屏窗口（视频/游戏）存在时强制隐藏并禁用探出 |

### Super+数字 键盘启动

| 键 | 默认值 | 作用 |
|---|---|---|
| `keynav-enabled` | `true` | Super+1..9 / Super+0 操作第 n 个 dock 应用：未运行则启动，已运行未聚焦则唤起，正聚焦则最小化 |
| `keynav-app-1` | `['<Super>1']` | 激活 dock 里第 1 个应用（默认 Super+1）；键位可改 |
| `keynav-app-2` | `['<Super>2']` | 激活 dock 里第 2 个应用（默认 Super+2）；键位可改 |
| `keynav-app-3` | `['<Super>3']` | 激活 dock 里第 3 个应用（默认 Super+3）；键位可改 |
| `keynav-app-4` | `['<Super>4']` | 激活 dock 里第 4 个应用（默认 Super+4）；键位可改 |
| `keynav-app-5` | `['<Super>5']` | 激活 dock 里第 5 个应用（默认 Super+5）；键位可改 |
| `keynav-app-6` | `['<Super>6']` | 激活 dock 里第 6 个应用（默认 Super+6）；键位可改 |
| `keynav-app-7` | `['<Super>7']` | 激活 dock 里第 7 个应用（默认 Super+7）；键位可改 |
| `keynav-app-8` | `['<Super>8']` | 激活 dock 里第 8 个应用（默认 Super+8）；键位可改 |
| `keynav-app-9` | `['<Super>9']` | 激活 dock 里第 9 个应用（默认 Super+9）；键位可改 |
| `keynav-app-10` | `['<Super>0']` | 激活 dock 里第 10 个应用（默认 Super+0）；键位可改 |
| `keynav-peek-dock` | `true` | 快捷键触发时短暂露出被避让隐藏的 dock（无论它启动/聚焦/切换/最小化） |
| `keynav-peek-duration` | `800` | 快捷键后 dock 保持露出的时长毫秒 |
| `keynav-stock-backup` | `[]` | 内部崩溃恢复备份（原装 switch-to-application-1..9 键位），不面向用户、偏好窗口里从不显示 |
| `keynav-stock-dirty` | `false` | 内部标志：dock 持有已清空的原装键位时为真，让下一次 enable() 能在崩溃后自愈。不面向用户 |

### Genie 动画

| 键 | 默认值 | 作用 |
|---|---|---|
| `genie-enabled` | `true` | 窗口最小化进/从其 dock 图标还原时播放 macOS genie 动画 |
| `genie-peek-hidden-dock` | `true` | dock 被避让隐藏时，最小化/还原过程中短暂露出它，好让你看见窗口飞向哪个图标；关掉则飞向 dock 所在屏幕边 |
| `genie-icon-reaction` | `true` | 窗口落到目标图标（最小化）或离开它（还原）时，图标做一次按压回弹 |
| `genie-minimize-duration` | `560` | 窗口「灌进」图标所需毫秒数 |
| `genie-restore-duration` | `480` | 窗口从图标「流出」所需毫秒数 |
| `genie-curvature` | `0.85` | 0=柔和的 macOS S 形曲线，1=更紧的 KDE 神灯收拢 |
| `genie-lead-fraction` | `0.58` | 动画进行到该比例时近边已到达图标 |
| `genie-trail-fraction` | `0.38` | 动画到该比例时远边才开始移动 |
| `genie-absorb-depth` | `0.85` | 结尾窗口沉进图标多深（按图标深度比例） |
| `genie-tail-fade` | `0.08` | 最后一片窄条淡出所占的动画比例 |
| `genie-mesh-resolution` | `64` | 漏斗方向上的条带上限，实际数量随窗口尺寸自适应（越大曲线越顺） |

## 🛠️ 故障排查

下面每一条命令在写进文档之前都在这台机器上跑过。唯一例外是标注出来的"会改动东西"的那条 —— 本
扩展自己的设置和正在运行的会话都不该由 agent 无人值守地动（见 `AGENTS.md`）。

| 现象 | 先查什么 | 命令 |
|---|---|---|
| dock 根本没出现 | 扩展到底加载了没、处在什么状态 | `gnome-extensions info macos-dock@local`（`ERROR` / `OUT_OF_DATE` 会直接印在这里） |
| 扩展停在 `OUT_OF_DATE`，完全不加载 | `metadata.json` 声明了支持的 shell 大版本，而 shell 只比较**大版本号**（`50.1` 匹配 `"50"`）。没列出的新大版本 = 扩展静默不加载 —— 这是升级流程的第一条 | `grep -A4 shell-version metadata.json` 和 `gnome-shell --version` |
| 改了 `lib/*.js` 却没变化 | 这是预期：`disable`+`enable` 只在**缓存的**模块上重跑 `enable()`。只有注销会重新加载代码 | `npm run test:live` —— 它拒绝为比代码树更旧的 shell 出证明（`stale_code`） |
| 登录后 dock 出现很慢，或图标闪 | 这两件都是启动链问题，各有自己的日志行：`enable() total Xms`、`reload: N icons in Xms`、`startup grace ended early at Xms`、`[dodge] grace released at Xms` | `journalctl --user -b -o cat _PID=$(bash -c 'source test/common.sh; shell_pid') \| grep -a '[macos-dock-local]'` |
| dock 该隐藏时不藏、不该藏时乱藏 | `dodge-enabled`、`dodge-only-focused`、`hide-in-fullscreen`，以及是不是概览在跟它抢（已知签名是：一次 `overview -> show` 在 600 ms 内被 hide 推翻，中间没有任何概览进入） | `npm run test:live` 会把 `overview-flicker` 报成计数；健康开机是 0 |
| dock 放在**副屏**时避让不对 | 边缘与轮询阈值是按 dock 所在显示器算的（D-052），而这台机器只有一块屏，所以只能在伪造布局里证明 | `npm run test:headless` —— `dock-monitor-geometry` |
| genie 不动 | 要么 `genie-enabled` 关了，要么 `_validate()` 拒绝了这版 shell、正在走原生动画 —— 这个判定会打日志，不会闷声发生 | 在 journal 里找 `[genie] enabled` 与 `[genie] disabled — missing/changed private APIs:` |
| 概览预览探出桌面，或底部预留带塌缩 | 两件都在 `overview-patches-enabled` 这个 shell 布局关注点后面；shell 符号改名会带一行 warn 降级回原生 | `npm run test:headless` —— `overview-band`、`overview-window-inset`、`overview-patches` |
| Super+数字没反应，或原装启动器图标坏了 | 先看 `keynav-enabled`，再看崩溃恢复标志 `keynav-stock-dirty` / `keynav-stock-backup` —— 抓键位与还原之间崩掉，正是它们负责自愈的场景 | 读值：`GSETTINGS_SCHEMA_DIR=$PWD/schemas gsettings get org.gnome.shell.extensions.macosdock keynav-stock-dirty` |
| 放大时图标发虚 | `icon-quality`（1/2/4 超采样）用内存换清晰；`magnification-framerate` 用 CPU 换顺滑 | 见上面的设置项说明 |
| 设置被调乱了，想回到默认 | **归用户做，不归 agent 做。** 这是对本扩展自己那套键的递归重置 | `dconf reset -f /org/gnome/shell/extensions/macosdock/` |

这些条目都不需要重启。只有"加载改过的 JavaScript"需要注销，而注销永远由用户自己执行。

## 🧞 Genie 动画

最小化或还原窗口时播放 macOS Genie 动画：窗口被切成条带，经由弯曲的漏斗流进/流出其**真实 Dock 图标**。漏斗轴向跟随 Dock 所在的屏幕边缘，因此上、下、左、右四种 Dock 位置都能正确收束。两个方向都基于窗口的同一份快照运行，实时窗口在动画期间被停放（缩放 ≈ 0），不再逐帧重绘。

条带数量随窗口在漏斗轴向上的尺寸自适应，以网格分辨率设置为上限（默认 64），小窗口省算力、大窗口够顺滑。应用没有可见图标时，按 实时矩形 → 上一次缓存的矩形 → Dock 边缘中心 → 主屏 Dock 边 的回退链处理。

Dock 因避让而隐藏时，会在动画期间短暂**探头（peek）**，让你看清窗口飞去了哪里（可关闭）。Genie 动画进行期间暂停放大效果，避让轮询在指针远离 Dock 后自行停机。工具窗与后台窗沿用系统原生动画。Genie 启动时会校验所需的 Shell 私有 API，缺失则记录警告并退化为系统原生动画。

如果你安装了独立的 `macos-genie@thuongvo.dev` 扩展，请**停用它** —— 本分支已提供相同动画，两者同时启用会争抢同一批窗口。

## 🧪 测试

两个不依赖 GNOME/GI 导入的模块配有单元测试，用纯 Node 即可运行 —— 无需 `gjs`、无依赖、无构建步骤：

```
npm test
```

- `lib/genieGeometry.js` → `test/genieGeometry.test.js`（坐标变换、缓动、Dock 位置表、条带变换契约）
- `lib/signalManager.js` → `test/signalManager.test.js`（连接记账：按 source 断开、容错、幂等清理）
- `test/invariants.mjs` → `test/invariants.test.js`（让 [`INVARIANTS.md`](INVARIANTS.md) 保持"指针表"性质的规则：每行必须指向真实存在的 `D-###`、指向 harness 仍在报告的检查名，且不得抄写正文）

检查分三层运行，因为这个扩展的大部分代码无法在 shell 之外被导入：

| 层 | 命令 | 需要桌面 | 会改动什么 |
|---|---|---|---|
| 1 · 静态 | `npm run test:static` | 否 | 无 |
| 2 · 无头 | `npm run test:headless` | 否（私有合成器） | 无 |
| 3 · 实时 | `npm run test:live` | 是 | 无 —— 只读本次开机的 journal |
| 3 · 实时 A/B | `npm run test:live-trigger` | 是 | 设置项，且必定还原并自证 |

第一层还守着一些别处看不见的仓库不变量：genie 的许可头、两个纯净模块必须不含 `gi://`、面向公开仓库的隐私扫描、schema 与偏好设置的键覆盖、每个 schema 键在两份 README 里都有一行，以及 `INVARIANTS.md` 的每一行仍指向真实条目与仍存在的检查。三层检查、支撑它的实测数字，以及每个 GNOME 版本的回归流程，都写在 [`MAINTENANCE.zh-CN.md`](MAINTENANCE.zh-CN.md)。

修 bug 时请先补一个在**修复前代码上会失败**的回归测试，再让它通过。

## 🆚 相对上游的改动（v9）

本分支在上游 v9 基线（`a2140d0`）之上新增维护提交，并合并了 macOS Genie 最小化/还原动画。逐条提交记录见 git log，这里只做摘要。

- **启动：** 修复登录后整排 Dock 图标闪烁（恢复 `_started` 守卫）；用增量同步取代全量重建；完全不透明从约 T0+1440ms 提前到约 T0+250ms。
- **空闲功耗：** 消除 60Hz 常驻放大唤醒；避让轮询改为自适应间隔（近边缘 120ms，其余 500ms 心跳）。
- **泄漏与崩溃守卫：** 放大轮询、dock 管理器、窗口变更淡出与图标下压回弹均增加已销毁 actor/容器守卫；避让路径不再强制 `opacity = 255`。
- **分隔线：** 修复 `_enforceOrder` 误报（稳态零移动）；分隔线改按动画收敛后的图标集合判定；删线与图标淡出对齐。
- **键盘导航：** 为 stock `Super`+数字快捷键增加崩溃自愈 sentinel；新增 Dock 弹出，动作期间隐藏的 Dock 也可见。
- **放大效果：** 用基于时间的指数平滑替换逐 tick LERP 系数（60/120/144/240Hz 收敛时间一致）；新增第二条唤醒通路，静止指针下方的 Dock 被揭示时立即放大。
- **Genie 合并：** 并入 macOS Genie 动画（`lib/genieGeometry.js`、`lib/genieEngine.js`、`lib/genieController.js`）—— 飞向真实 Dock 图标、遵循配置的 Dock 边缘、私有 Shell API 缺失时退化为原生动画，并保证完成回调恰好一次。
- **Genie 正确性：** 两个方向都基于同一份窗口快照；漏斗轴向与无图标回退路径都由 `dock-position` 推导；尾部条带各自溶解；网格分辨率改为上限（默认 64），条带数量随窗口尺寸自适应。
- **Genie 性能：** `layoutStrips` 每帧零分配（已逐位比对一致，约 2.5× 提速）；动画期间暂停放大，采用引用计数，正常完成、异常或卸载都不会泄漏挂起。
- **Genie 与 mutter 计数：** `_steal()` 先于 `finishFor()` 执行，消除多余的 "Error in minimize/unminimize accounting" 日志；`MODAL_DIALOG` 加入参与动画的窗口类型。
- **无障碍：** 最小化/还原时长通过 `adjustAnimationTime()` 遵循全局"减慢动画"系数，且换算发生在 100–3000ms 的 clamp **之后**。
- **正确性：** 窗口类型判断改用 `Meta.WindowType` 符号；避让监听每个窗口的 position/size/unmanaged 变化，全屏判定改读 mutter 自己的 `Monitor.inFullscreen`。
- **图标淡入：** 增量同步新增的图标在 180ms 内淡入；整表 reload 仍保留单次容器级淡入。
- **指示点刷新：** 每轮刷新只做一次窗口 actor 走查，而非每个图标一次（17 图标的 Dock 即 17 → 1）。

## 🤝 参与贡献

欢迎提交 Issue 与 Pull Request。请保持改动范围聚焦，并针对上述 GNOME Shell 版本进行测试。

## 🙏 致谢与来源说明

本扩展是 **vinnytherobot** 的 **MacOSDock** 的**维护分支**，并**合并**了 **Thuong Vo（SekiroKenjii）** 的 macOS Genie 动画。原始设计与功能均出自其手。

- **Dock 上游：** [vinnytherobot/MacOSDock](https://github.com/vinnytherobot/MacOSDock) —— 许可证 **MIT**
- **Dock 上游作者：** vinnytherobot
- **GNOME 扩展页面：** [#10719](https://extensions.gnome.org/extension/10719/macos-dock/)
- **分支基线：** 上游 **v9**（提交 `a2140d0`）
- **Genie 上游：** [SekiroKenjii/macos-genie](https://github.com/SekiroKenjii/macos-genie) —— 许可证 **GPL-2.0-or-later**
- **Genie 作者：** Thuong Vo（SekiroKenjii）
- **合并与维护：** SHADE-glitch

## ⚖️ 许可证

Dock 代码采用 **MIT 许可证**；Genie 派生代码采用 **GPL-2.0-or-later**，合并后的整体以 **GPL-2.0-or-later** 分发。见 [LICENSE](LICENSE)、[LICENSE.GPL-2.0](LICENSE.GPL-2.0) 与 [LICENSES.md](LICENSES.md)。

© vinnytherobot 及贡献者；Genie 引擎 © Thuong Vo（SekiroKenjii）；分支修改与合并 © SHADE-glitch。
