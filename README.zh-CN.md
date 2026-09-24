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
- **放大效果** —— LERP 平滑缩放，带指针死区与可配置衰减。
- **窗口预览** —— 悬停显示，缩放比例可调。
- **避让 / 自动隐藏** —— 仅聚焦时隐藏、贴边窥探（peek）、窥探保持延迟、全屏时隐藏。
- **键盘导航** —— `Super` + `1` … `0` 启动或聚焦前十个应用。
- **运行指示器**、启动弹跳、动画时长与显示阈值。
- **媒体控制**（MPRIS），可选指示器。
- **分隔线** —— 将收藏应用与正在运行的非收藏应用分开。
- **应用按钮**、运行应用展示与工作区模式设置。
- **Genie 最小化/还原动画** —— 窗口流进/流出其**真实 Dock 图标**，合并自 macOS Genie。

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

启用后，Dock 会出现在配置的屏幕边缘。悬停可放大并显示预览；点击图标启动或聚焦对应应用；右键打开应用菜单。使用 `Super` + 数字键按位置启动应用。

## 偏好设置

打开 **GNOME 设置 → 扩展 → MacOS Dock → 设置**，可配置外观与位置、放大效果、预览、避让/自动隐藏、键盘导航、媒体控制、运行指示器、分隔线、动画时长与 Genie 最小化/还原动画。

## Genie 动画

最小化或还原窗口时会播放 macOS Genie 动画：窗口被切成条带，经由弯曲的漏斗流进/流出其**真实 Dock 图标**。动画目标是纯图标方块（不含运行指示点），在动画开始时对图标当前放大后的位置取一次快照；当应用没有可见图标时按回退链处理（实时矩形 → 上一次缓存的矩形 → Dock 中心 → 主屏底部居中）。

Dock 因避让而隐藏时，会在动画期间短暂**探头（peek）**，让你看清窗口飞去了哪里；该行为可关闭，关闭后窗口改为飞向主屏底边并保持图标的水平位置。工具窗与后台窗沿用系统原生动画。Genie 仅在 Dock 启用时生效，启动时会校验所需的 Shell 私有 API，缺失则大声记录警告并退化为系统原生动画。

如果你安装了独立的 `macos-genie@thuongvo.dev` 扩展，请**停用它** —— 本分支已提供相同动画，两者同时启用会争抢同一批窗口。

## 相对上游的改动（v9）

本分支在上游 v9 基线（`a2140d0`）之上新增若干维护提交，并合并了 macOS Genie 最小化/还原动画：

- **启动 / 闪烁：** 恢复 `_started` 启动守卫，修复登录后整排 Dock 图标闪烁；对 `installed-changed` 与 `favorite-apps` 一律增量同步，根除 settle 之外的全量重建闪烁；合并避让/显隐模块；回退过宽的性能/时序改动以收紧范围。
- **资源泄漏与崩溃守卫：** 放大轮询与 dock 管理器增加容器销毁门卫；窗口变更淡出 `onComplete` 增加已销毁 actor 守卫；避让 `stop()`/`_refreshDodge()` 尊重启动淡入，不再强制 `opacity = 255`；避让隐藏日志移到 `_hide()` 守卫之后。
- **性能 / 空闲功耗：** 放大效果空闲停表、靠近时重启，消除 60Hz 常驻唤醒；避让轮询自适应降频（近边缘 120ms，其余 500ms 心跳）。
- **预览：** 预览弹窗跟随悬停应用切换，同一应用复用弹窗，退场动画中可复活。
- **键盘导航：** 为 stock 快捷键增加**崩溃自愈 sentinel** —— 在扩展自有 schema 中保存备份与 dirty 标记。
- **分隔线：** 修复 `_enforceOrder` 误报（索引比较剔除分隔线/按钮，稳态零移动）；新增分隔线增删打点日志；分隔线删线与图标淡出对齐；grace 条件化提前结束（下限 400ms + 静默 500ms，上限 1200ms）。
- **正确性：** 窗口类型判断改用 `Meta.WindowType` 符号。
- **Genie 合并：** 并入 macOS Genie 最小化/还原动画（`lib/genieGeometry.js`、`lib/genieEngine.js`、`lib/genieController.js`）—— 飞向真实 Dock 图标，快照实时放大位置，按缓存矩形回退链处理，可选对避让隐藏的 Dock 探头，启动时校验 Shell 私有 API（缺失则退化原生动画），并保证完成回调恰好一次。

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
