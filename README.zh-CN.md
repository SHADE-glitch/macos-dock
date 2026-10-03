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

检查分三层运行，因为这个扩展的大部分代码无法在 shell 之外被导入：

| 层 | 命令 | 需要桌面 | 会改动什么 |
|---|---|---|---|
| 1 · 静态 | `npm run test:static` | 否 | 无 |
| 2 · 无头 | `npm run test:headless` | 否（私有合成器） | 无 |
| 3 · 实时 | `npm run test:live` | 是 | 无 —— 只读本次开机的 journal |
| 3 · 实时 A/B | `npm run test:live-trigger` | 是 | 设置项，且必定还原并自证 |

第一层还守着一些别处看不见的仓库不变量：genie 的许可头、两个纯净模块必须不含 `gi://`、面向公开仓库的隐私扫描，以及 schema 与偏好设置的键覆盖。三层检查、支撑它的实测数字，以及每个 GNOME 版本的回归流程，都写在 [`MAINTENANCE.zh-CN.md`](MAINTENANCE.zh-CN.md)。

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
