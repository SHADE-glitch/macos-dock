<p align="right"><a href="MAINTENANCE.md">English</a> | <a href="MAINTENANCE.zh-CN.md"><b>简体中文</b></a></p>

# 维护手册

本文件是跨 GNOME 版本保住这个 fork 的**流程**。[`AGENTS.md`](AGENTS.md) 写的是**规则**（什么绝
不能做），这里写的是**怎么判断一次改动是否安全**，两者不重复。

## 0. 三十秒速查

| 问题 | 答案 |
|---|---|
| 跑完所有可无人值守的检查 | `npm run test:static`，再 `npm run test:live` |
| 跑私有的一次性合成器 | `npm run test:headless`（约 60 秒） |
| 跑会开真实窗口的实时 A/B | `npm run test:live-trigger`（需要空闲会话） |
| 纯单元测试覆盖 | `npm test` —— 数字由它自己打印（`# tests` / `# suites`）；第一层守的是**下限 95/24**，不需要桌面 |
| 支配一切的那条事实 | `disable`+`enable` **不会**重新加载改过的 JS，只有注销再登录才会 |
| 代码在哪 | 全在 `lib/` —— 数字用 `wc -l lib/*.js` 现取；无构建步骤、无依赖 |

## 1. 范围与基本前提

- 这里说的"测试"只有三种含义，因为大部分代码无法在 shell 之外被导入：对仓库文本的守卫、
  一次私有的无头合成器、以及实时会话自己打出的日志行。
- 扩展那些**无条件**输出的日志行就是第二、三层的判据，其地位等同于函数签名：改名或加门控
  会悄无声息地抽掉覆盖率，所以 `test/repo.test.js` 守着被读取的那几行。
- 分不清"回归"还是"这台机器当时在忙"的断言一律报 `ENV`，绝不报 `PASS`。

## 2. 三层一览

| 层 | 文件 | 需要桌面 | 会改动什么 | 典型耗时 | npm script |
|---|---|---|---|---|---|
| 1 静态 | `test/repo.test.js`、`test/static-checks.sh` | 否 | 无 | 约 5 秒 | `test:static` |
| 2 无头 | `test/headless-checks.sh` | 否（私有 shell） | 无（memory 后端） | 约 60 秒 | `test:headless` |
| 3 实时 A | `test/live-checks.sh` | 是 | 无 | 约 10 秒 | `test:live` |
| 3 实时 B | 同上，加 `--trigger` | 是 | 设置项，且必定还原并自证 | 约 120 秒 | `test:live-trigger` |

`test/run-all.sh` 负责汇总；退出码 `0` 无 FAIL、`1` 有 FAIL、`77` 全是 ENV、`2` 用法或前置
缺失。每一层也都能单独运行。
**命名。** 本文的 第一层 / 第二层 / 第三层（`Tier 1/2/3`）在 `CHANGELOG.md` 与其余四个扩展仓库里
统一写作 **`L0` / `L1` / `L2`**：`Tier 1 = L0`（离线静态）、`Tier 2 = L1`（一次性无头壳）、
`Tier 3 = L2`（真机会话）。层级按"结论需要什么环境"定义，不按跑它的工具定义。


## 3. 第一层：离线静态检查

`test/repo.test.js`（跑在 `npm test` 里）加上 `test/static-checks.sh` 的 shell 侧检查（按文件
顺序编号为 `S1`…）。每条守卫的存在理由都是"它失败时其他检查全都看不见"：

| 守卫 | 守住的规则 | 失败意味着什么 |
|---|---|---|
| 纯净模块不得有 GI 或 `resource://` 导入 | `AGENTS.md` 硬规则 | 所有人的 `npm test` 挂掉，包括没有 GNOME 的评审者 |
| genie 的 SPDX 与署名行；GPL 文件集合等于 `LICENSES.md` | 公开仓库的许可义务 | 是法律风险，不是格式问题 |
| `DODGE_DEBUG` 必须是 `false` | dodge 的 `_dbg`/`hide-trigger` 会打印真实窗口标题 | journal 开始收集私人标题，日后任何一次日志粘贴都会泄露 |
| schema 键集减去 `prefs.js` 键集恰好等于钉住的 12 个名字（十个 `keynav-app-N` + `keynav-stock-backup`/`-dirty`） | 设置面完整性 | 新键没有偏好设置行是静默功能缺口；有行没键会让偏好窗口抛异常 |
| 每个 schema 键都以反引号形式出现在**两份** README 里 | 设置说明是用户唯一能知道某个键存在的地方 | 往 schema 加了键却哪儿都没写（守卫只证明有这一行，不证明描述写对了） |
| `INVARIANTS.md` 每一行都能解析（`test/invariants.mjs`，规则 6.0–6.7 写在文件头） | 这份指针表是"这个东西能不能回退"的唯一快答 | 某条不变量指向被删掉的条目、被改名的检查，或指向一个口味级偏好 —— 同一个校验器也可用 `npm run check:log --invariants` 单独跑 |
| `metadata.json` 的 uuid / schema id / 纯数字 `shell-version` | 加载期接线 | schema id 写错会让扩展在登录时进 ERROR |
| 双语对 `##` 数量相等且首行是语言切换器 | 文档约定 | 两个文件已经漂移 |
| markdown 里不得有任务 checkbox | 本仓四个 fork 的共同约定 | 提交进仓库的文档读起来像未完成的活 |
| 无已解析的临时路径、wayland 槽名、主机/用户/邮箱 | 这个仓库是公开的 | 提交了只在这台机器上有意义的指纹 |
| harness 的 grep 必须锚定 `[macos-dock-local]`，或带 `ANCHOR-EXCEPTION` | 一次宽松的 `macos-dock` 匹配曾从剪贴板管理器历史里捞出 847 行 | 某个检查其实在读别人的日志 |
| 匹配 `*.test.js` 的文件不得导入 GI；GI 探针保持自己的文件名 | `npm test` 必须能用纯 Node 跑 | 把 `probe-window.js` 改名进 glob 会毁掉每一次运行 |
| `package.json` 无依赖、无 `node_modules` | "无构建步骤"这条故事线 | 测试不再能离线运行 |

shell 侧：工具链存在性（缺失 → ENV）、单测下限（95 断言 / 24 套件 —— 是下限，加测试永远不会失败；每
次加用例时在同一次改动里把下限一起抬上去，这样"某个套件不再被收集"会直接报红）、对**全部** tracked `.js` 跑 `node --check`、对 harness 跑 `bash -n`、
`glib-compile-schemas --strict --dry-run`、编译产物新鲜度、`gjs -c 'true'` 冒烟、`docs/reports/`
确被忽略且其中没有任何文件被跟踪，最后断言这一轮没有把工作树弄脏。

对所有 GI 绑定文件跑 `node --check` 是全仓性价比最高的一项：`package.json` 里是
`type: module`，所以 `lib/dodge.js` 的语法错误只能在这里被发现 —— 否则要等到注销后看到扩展
进 ERROR。

## 4. 第二层：无头 shell

`test/headless-checks.sh` 在干净房间里拉起一个私有合成器；下面这张表就是它断言的全部内容，
具体项数由 `test/run-all.sh` 在每轮跑出来（抄进这里的数字第一次加检查就会过期）。下面每一行
隔离都是必需的，不是装饰：

```
GSETTINGS_BACKEND=memory        没有 dconf 客户端：读返回 schema 默认值，写全部被丢弃
XDG_DATA_HOME=$T2               shell 只扫这个目录，于是符号链接进来的本 fork 是唯一被加载
                                的扩展；否则用户的全部扩展都会在里面启动，污染每一条判据
XDG_CONFIG_HOME/XDG_CACHE_HOME  不会有任何东西落到真实的 ~/.config 或 ~/.cache
GSETTINGS_SCHEMA_DIR=$REPO/schemas  设置 schema 是扩展自带的
gnome-shell --headless --unsafe-mode --wayland-display=wayland-$UNIQ --virtual-monitor=1280x800
```

- 绝不在本目录跑 `gnome-extensions install` 或 `pack`（跟随符号链接，会清空源码）。也绝不
  在 memory 后端下跑 `gnome-extensions enable`：那是**另一个进程**，它的写入随它一起消失，
  真 shell 永远看不到，就绪轮询会空转到超时。改为从 Eval 内部调用
  `_callExtensionInit(uuid)` 再 `_callExtensionEnable(uuid)`，它还会跑
  `_loadExtensionStylesheet`，因此比 `stateObj.enable()` 更接近真实登录。
- 提供 `org.gnome.Shell.Eval` 的是 `--unsafe-mode`。这个构建里**没有** `--devkit` 选项，
  GNOME 50 也彻底删掉了 `org.gnome.desktop.interface unsafe-mode` 这个 gsettings 键；
  `--nested` 同样已经没了。若某个版本改了参数，harness 会连同 shell 自己的报错一起报 ENV，
  由人工去复核 `gnome-shell --help`。
- `--wayland-display` 必须唯一：否则 mutter 去抢 `wayland-0`、锁不上，失败会级联成
  `AddMatch(): The connection is closed`、`StartServiceByName for
  org.gnome.SessionManager` 和 `free(): invalid pointer`，看起来像 shell 的 bug。本轮的
  lockfile 与 socket 由 trap 删除，`$T2` 之外不碰任何东西。
- 送进 Eval 的代码从**文件**读，结果也写回**文件**：Eval 的返回值是 ASCII 转义过的噪声。
  Eval 以 classic script 运行，所以 `imports.gi.*` 可用、`imports.ui.*` 不可用，
  `ui/main.js` 必须用 `await import('resource:///…')`。这里的 Eval 里
  `imports.gi.Config` 没有 typelib —— 所以逐个符号独立探测，别让一处抛错吞掉其余答案。
- 就绪的判据是 `extensionManager.lookup(uuid).stateObj` 存在，不是 `gnome-extensions info`
  报 ACTIVE。`state 6` 表示只有 metadata，extension.js 还没被导入。
- 无头**能**证明的：跑到 ACTIVE、genie 的 `_validate()` 对**这个** shell 构建的结果、图标表
  枚举出内容、dodge 起来了、以及没有任何错误块指向本扩展。**不能**证明的：任何
  map/minimize/restore 动画路径 —— 把计数器挂到真实例上、即使加 `--force-animations` 也仍是
  0。不要在这一层加动画断言。
- 无头数字与真机**不可比**（本机实测：`enable()` 无头 25 ms vs 真机 30 ms，而隔壁 fork 同
  一段工作是 5355 ms vs 757 ms）。所以第二层只断存在性，不断阈值。
- 错误计数按路径限定：只有错误块栈里出现 `macos-dock@local/` 才算到本 fork 头上，因为一次
  裸无头启动本身就会打约 90 条与 fork 无关的 shell 内部 "already disposed"。
- 最后一项（`dock-monitor-geometry`）覆盖的是**单屏机器上永远看不见**的一类问题：它在运行
  中的 shell 里伪造出上下堆叠的两块显示器、并把 `primaryMonitor` 指向远处那块，然后断言
  dodge 的边缘几何跟的是 dock 自己所在的屏。已做过先红后绿：换回旧的
  `primaryMonitor` 写法时它报 `pickedPrimaryInstead=true`、`farFromEdgeAtDockEdge=true`
  —— 也就是贴在 dock 边缘的指针被判成"离得远"，于是轮询会错误停表、peek 触发区跑到另一块
  屏上。
- `overview-band` 守的是**只有隐藏自带 dash 之后才出现**的一类问题。GNOME 50 从自带 dash 的
  preferred height 推导概览底部预留带（`overviewControls.js` `vfunc_allocate`），即使 dash
  被隐藏也照算；隐藏它会让 dash 变空、该高度塌缩成主题内边距（36px），于是比该内边距高的
  dock 会压住窗口选择器/应用网格。该检查断言预留带（dash preferred height + shell 自身的
  spacing）不小于 dock 的占用高度。已做过先红后绿：改前 `band=51 < dock=70`，改后
  `band=85 >= dock=70`（无头显示器、icon-size 默认 48）。
- `overview-window-inset` 守的是**只有 dock 在概览里可见时才出现**的一类问题。shell 用
  `WorkspaceLayout._getWindowSlots` 布局窗口预览，喂给它的是整个 window-picker 盒子，而桌面
  背景是内缩在这个盒子里的（主题：左右 20px、上下 12px）——于是预览会探出桌面边缘，窗口数让
  内容贴底时最明显。`lib/overviewLayout.js` 包住这个私有方法、改为传入背景矩形；该检查是
  **存在性**判据（与 `genie-apis` 同类），断言包装器打出了 `[overviewlayout] enabled`、且没有
  那行 `disabled — missing/changed private APIs` 降级日志。它证明的是包装器成功接上了这个
  shell 的私有面，而不是像素——像素靠肉眼确认（见 §10）。
- 收尾回收的是**整棵子树**，不只是 `dbus-run-session`。该进程会 fork 出两个子进程——私有的
  `dbus-daemon` 和命令本身（`gnome-shell`）——只杀它会让这两个被 reparent 到 systemd 后继续
  存活：一天的运行留下了 7 个无头 shell + 18 个私有 dbus-daemon（约 580 MB）。`t2killtree`
  先子后父地走一遍（趁还没 reparent、`pgrep -P` 还看得见），TERM→KILL，`teardown` 检查再
  证明快照里的每个 pid 都已消失。
- 创建沙箱之前会先做一次**陈旧沙箱清扫**。`t2cleanup` 在每次正常退出时都会删掉 `$T2`，但被
  `SIGKILL` 的运行（或主机断电）会把它留在 `/tmp/macosdock-t2-*`，之后再没有任何东西回收它——
  在这套清扫出现之前已累积了 16 个（2.9 MB）。只回收超过一小时的目录，所以并发运行的新沙箱
  绝不会被碰到。它是卫生动作而非断言：不产生 report 行，所以上面那张表不因为它多一行。

## 5. 第三层：实时会话（无指针）

`test/live-checks.sh` 分被动组和触发组。

**A 组**只读本次开机已经写好的 journal。任何时候都安全，不改动任何东西：会话 shell 身份、
陈旧代码闸门、journal 可读性、开机清单（只给数值，绝不给原始行）、开机不变量、两条哨兵。

- **陈旧代码闸门**比较最新 tracked `.js` 的 mtime 与正在运行的 shell 启动时间。shell 早于
  改动时直接拒绝跑 B 组：否则每条实时断言认证的都是没被加载的代码。这是本仓最容易自欺的
  一条。
- **`pgrep -x gnome-shell` 不够。** 这台机器上别的 agent 会话会跑
  `gnome-shell --headless`，选中它就等于去读一个与会话毫无关系的合成器的日志。`common.sh`
  会剔除命令行含 `--headless` 的进程。
- **开机不变量**是开机抽动的永久回归检查：任何 `-> hide` 的时间戳都不得早于 dodge 的
  `grace released at`。
- **隐私哨兵**：journal 里出现 `hide-trigger` 就说明 `DODGE_DEBUG` 被打开、真实窗口标题正在
  被记录。
- **锚定卫生**统计那些提到了本 fork 但**没有**标签、且带错误字样的行数 —— 那些是锚定 grep
  看不见的、针对扩展的抱怨。只打印计数：未打标签的行里可能有标题。

**B 组**是无指针 A/B：同一条窗口时间线跑两遍，唯一差别就是被测的那个开关；读数是 dodge 自己
的 `uncovered -> show` 会不会出现：

1. 对照组（`nofs`）：最大化压住 dock → dock 隐藏；一个不重叠的小窗口拿到焦点 → `uncovered
   -> show` **必须**出现（实测 16–39 ms）。
2. 实验组（`fullscreen`）：同上再加 `fullscreen()`。以探针自己的 `small-present` STEP 时间戳
   为锚点的沉默窗内，show 与 peek **都不许**出现。
3. 可逆性：全屏窗口销毁后 show **必须**回来（实测 8–20 ms）。没有这一步，沉默什么都证明不
   了。
4. 开关确认：把 `hide-in-fullscreen` 关掉后，*同一条*全屏时间线里 show 会回来 —— 正是这一步
   让第 2 步的沉默归因于设置而不是归因于那一刻。
5. genie 重新校验：把 `genie-enabled` 关一再开回，就能在不注销的情况下对实时 shell 重跑
   `_validate()`（`dockManager` 监听 `changed::genie-enabled` → `_refreshGenie()` →
   `_startGenie()`）。
6. 分隔线判据（有非收藏应用在跑时才有意义）。

三条是用真实失败换来的规矩：

- **锚点必须是探针自己的 STEP 时间戳，不能是"现在"。** dock 可能在焦点变化落地的瞬间就迁移；
  从"激活调用返回之后"开始测量，会把一次真实发生的 show 读成"没有 show"。这个坑在修好之前
  造成过两次误报 FAIL。
- **断言焦点之前先用 `xprop` 确认焦点。** 新窗口通常自己就能拿到焦点，但也常常不能；
  `xdotool windowactivate --sync` 加上读取 `_NET_WM_STATE_FOCUSED`，能把"没有 show"从一个
  错误结论变成一次诚实的 ENV。
- **样本窗内出现无关的 dock 活动就作废重采，不算失败。** dodge 让正在进行的 genie 动画优先
  于全屏强制隐藏（`_check` 里 `_animPeek` 排在最前），所以窗内任何一次最小化都会合法地打出
  show。B 组最多重采三次，连续三次违规才判回归。

B 组的设置协议，全部在 `common.sh` 里强制执行：

- 只有一个写入口 `set_key`，它拒绝任何
  `org.gnome.shell.extensions.macosdock` 之外的名字，并额外拒绝 `keynav-*`（那些键会接管并
  备份真实的系统快捷键）和 `dodge-enabled`（它唯一的失败模式是把用户留在一个永不避让的 dock
  上）。
- 跑前 `dconf dump`，跑完还原，再 dump 一次并**逐字节比对**；任何漂移都是最高级 FAIL 并列
  出键名。原本未显式设置的键用 `dconf reset` 处理而不是写回值 —— 把它留在显式设置状态本身就
  是污染。
- 绝不 `dconf reset -f`：这位用户的子树里有两个来自 v9 命名的孤儿键
  （`auto-hide`、`enable-keyboard-nav`），属于用户数据。
- harness 绝不 `gnome-extensions disable`/`enable` —— 那会 round-trip keynav。
- 重定向 `XDG_CONFIG_HOME` **不能**隔离写入：`gsettings`/`dconf` 是 D-Bus 客户端，由已经在
  跑的 dconf-service 服务，用的是真实路径。所以要靠快照与还原，不是靠环境变量。

## 6. 读报告：PASS / FAIL / ENV

- `PASS` —— 断言在这台机器、这个时刻成立。
- `FAIL` —— 是回归，或者是一条在这台机器上根本无法满足的断言；消息会说明是哪一种，代码注释
  会说明这条检查的存在理由。
- `ENV` —— 这台机器或这个会话今天答不了这个问题。**永远不是通过。** 每条 ENV 都会点名它的
  探测原因（锁屏、鼠标在动、shell 早于改动、参数变了、工具缺失），并且都有写明的可答方式。
- 一轮全是 ENV 的运行退出 `77`，以免被误读成干净通过。

## 7. 每个 GNOME 版本的回归流程

1. 升级**之前**先把新的主版本号加进 `metadata.json` 的 `shell-version`。shell 的
   `_isOutOfDate` 是 `some(v => v.startsWith(major))`，所以未列出的主版本会让扩展变成
   `OUT_OF_DATE` 并且根本不加载 —— 没有报错、没有日志，dock 就是不见了。别用 `"5"` 这种通配
   来"修"：`startsWith` 会连 52–59 一起声称支持。
2. `npm test` 与 `npm run test:static`。
3. `npm run test:headless`。`genie-apis` 就是发布日对 genie 的判决：私有符号若变了，它会
   点名是哪一个。降级路径本来就是设计的一部分 —— `_validate()` 失败会打一条很响的警告并让
   原生动画接管，所以那类回归是外观问题，从不阻塞发布。
4. 注销再登录，然后 `npm run test:live`。A 组读开机数据：宽限毫秒数每个版本都会漂，所以只断
   区间不断具体值（同一份代码实测过的放行时刻：3673 ms、6106 ms、2450 ms 静默路径）。
5. 在**空闲**会话上跑一次 `npm run test:live-trigger`，覆盖全屏分支。
6. 想不注销再查一次 genie，用 `genie-enabled` 开关（B 组第 5 步），不要重启。
7. 若 `genie-apis` 点名了某个符号，该看的地方是 `genieController._validate()` 与
   `genieEngine.validateRuntime()`。

## 8. 真正的破坏面

GNOME 更新能拿走的东西，全在这里：

- `Main.wm._minimizing`、`Main.wm._unminimizing` —— genie 把 actor 从 shell 自家的动画列表里
  取走，靠的就是这两个私有符号；`_validate()` 探测它们，缺失时 genie 退回原生动画。
- `WorkspaceLayout.prototype._getWindowSlots` —— 概览窗口预览内缩（D-057）包住了这个私有布局
  方法，改为喂它桌面背景的矩形。它还依赖 `Workspace` 的子结构：`Workspace._container`（预览
  容器，其 layout manager 即 `WorkspaceLayout`）与它的 `workspace-background` 兄弟。其中任一
  被改名都会降级回原生布局、只打一行 warn——绝不崩。
- `Main.overview.dash.get_preferred_height` —— 概览底部预留带（D-054）在 stock dash 实例上遮蔽
  它；现在住在 `lib/overviewPatches.js`、由 `overview-patches-enabled` 开关控制（D-058）。这是
  挂在活动 actor 上的自有属性、用 `delete` 移除。shell 改名会降级回原生高度（预留带塌缩、高的
  dock 可能压住概览），但不会崩——安装前先探测、且整体 try/catch，与 dock 的唯一耦合是注入的
  `getBandMetrics()` provider。
- `dash._dashSpacer`（`dockManager.js:661`、`:682`）—— **在本机装的 50.1 里根本不存在**：shell 的
  `dash.js` 乃至其它任何 `ui/*.js` 都搜不到这个名字。启用与禁用两条路径都用 `if (dashSpacer)` 兜着
  读它，所以这是一次永久静默 no-op，而不是升级带来的破坏。它属死重量：删不删是个决定，任何检查都
  不会因此变红。
- `Main.overview._overview.controls._stateAdjustment`（`overviewApps.js:59`），并把网格状态硬编码成
  裸数字 `2`（`:61`）。改名会降级到 `showAppsButton.checked` 兜底（try/catch，不崩）—— 而那个兜底
  恰恰是代码注释里明说"不再信任"的过期来源。要是枚举被**重排**而不是删除，这个判断会答错且一行日志
  都不打。全仓唯一一个能"静默答错"的依赖。
- `Main.uiGroup`（`iconManager.js:1262`）—— 公开，但 shell 自己的 `main.js` 把它标为"在其它代码改完
  之前先让它们继续跑"的向后兼容别名，这使它成为此处最不持久的公开依赖。
- 是行为上限而非改名风险：shell 把概览 dash 夹在 `box.height * DASH_MAX_HEIGHT_RATIO`（0.16）以内，
  并且取 `Math.min(dashHeight, maxDashHeight)`（`overviewControls.js:23,174-178`）。所以只要 dock 高度
  超过约工作区的 16%，概览预留带就会被夹住，`get_preferred_height` 返回多少都没用。相关且尚未定论：
  `Dash` 定义了 `vfunc_get_preferred_height`（`dash.js:82`），而我们的覆盖是挂在
  `get_preferred_height` 上的自有属性 —— C 侧分配路径究竟问的是哪一个，这里没有查清；预留带哪天不再
  跟随 dock 高度，先从这条查。
- 一条**没人写下来的行为依赖**，靠实测而非阅读才发现：shell 的 `Layout._trackActor()` 把 chrome
  actor 自己的 `destroy` 连到 `_untrackActor`（`layout.js:962-965`）。所以即使
  `dockManager.js:287` 在容器先被销毁时跳过 `removeChrome`（`:74` 把 `_container` 置空），
  `layoutManager._trackedActors` 里也不会留着我们的 actor。已在私有 shell 里量过：destroy →
  `disable()` → 再问注册表，actor 不在了（第二层 `chrome-untracked`）。今天这不是泄漏；它是
  "哪天 shell 去掉这条自动连接，`:287` 那个条件就变成真泄漏"的原因，而 `_findActor()` 每次布局
  查询都要扫这个数组。那条检查是哨兵，不是修法。
- `global.window_manager.connect`、`completed_minimize`、`completed_unminimize` —— 公开，但
  历史上被重塑过。
- `genieEngine.validateRuntime()`：`global.window_group.add_child`、`Clutter.Timeline`、
  `Clutter.Clone`、`Graphene.Matrix`。
- 公开但会变的形状：`Main.layoutManager.monitors`（以及 `monitor.inFullscreen`）、
  `global.get_window_actors()`、`Meta.Window.is_fullscreen` / `get_frame_rect()`、
  `Shell.BlurEffect`，以及 dodge 在 `start()` 里接的那一组 `global.display` 信号。同样公开、但
  升级可以安静改变的承重面还有：`Main.wm.addKeybinding` / `removeKeybinding`
  （`hotkeyNav.js:83,98,117` —— 参数形状**以及**由 uuid 派生的绑定名）、
  `PopupMenu.PopupMenuManager` / `PopupMenu` / `PopupMenuItem` 的构造函数签名
  （`iconManager.js:185,1256,1284`）、`Main.modalCount`（`dodge.js:571` 那条"概览占用"探针）、
  `global.window_group.get_children()`（`genieEngine.js:58`，按名字扫整个 actor 组）。
- 不构成风险：其余所有下划线名字（`actor._genieSquash`、`actor._dockRemovalPending`、
  `wrapper._dockFixDestroyId`）都是我们挂在别人对象上的自家记账字段，升级不会让它们失效。

## 9. 日志行与它证明的事实

| 日志行（`文件:行`） | 证明 | 不证明 | 层 |
|---|---|---|---|
| `[macos-dock-local] enable() total Xms`（`dockManager.js:226`） | 整条 enable 链跑完了 | 任何可比的速度 | 2、3A |
| `[icons] reload: N icons in Xms (reason=startup)`（`iconManager.js:560`） | 收藏与运行中应用被枚举出来，`N>0` | 视觉是否正确 | 2、3A |
| `[icons] startup grace ended early at Xms` / `reason=startup-grace-end`（`iconManager.js:221`） | 图标宽限已结束、更新已恢复 | 走早退还是走上限不重要 | 2、3A |
| `[dodge] started (onlyFocused=…, watching N windows)`（`dodge.js:595`） | dodge 接好了线并建了轮询 | 它之后能否判对 | 2、3A |
| `[dodge] grace released at Xms (window quiet Yms)`（`dodge.js:1000`） | 第一次允许隐藏的时刻；`quiet 0ms` 表示走的是上限 | 之后是否真的隐藏 | 3A |
| `[dodge] {overlap,uncovered,overview,fullscreen} -> {hide,show}`（`dodge.js:1197,1243`） | 每一次真实迁移，reason 点名分支 | dock 的位置或 opacity | 2、3A、3B |
| 一次 hide 之后约 300ms 内又出现 `overview -> show` | 不是好事：那一轮 tick 抢在概览退出动画里把刚收起的 dock 又弹了出来。A 组以 `overview-flicker` 计数，健康的开机应为 0（有 bug 的那版实测 40） | —— | 3A |
| `[dodge] peek show (edge=N)` | 指针揭示路径可用（只有真指针能触发） | 全屏相关的事，除非与 B 组配对 | 3A |
| `[icons] +separator at=N (…)` / `-separator (…)`（`iconManager.js:1358,694,737`） | 分隔线状态变化及原因 | 有没有抖动（需要看这一对） | 3A、3B |
| `[genie] enabled`（`genieController.js:62`） | `_validate()` 接受了这个 shell 构建 | 动画好不好看 | 2、3A、3B |
| `[genie] disabled — missing/changed private APIs: …`（`genieController.js:43`） | 某个符号变了；行里会点名 | 崩溃 —— 降级是有效的 | 2、3A、3B |
| `[genie] effect ended without completing mutter:`（`genieController.js:393`） | 恰好一次的完成闩锁被绕过 | —— 它就是为这件事存在 | 永久警告 |
| `[appsbtn] applied (icon=…, label=none, grid=<n>)` (`overviewApps.js:257`) | 网格判断在**这台 shell 上**解析到的 `ControlsState` 值 —— 第二层把 `<n>` 与 shell 自己报出的数字比对；第三层的 `grid-state-loaded` 断言真实会话确实解析出了一个整数（`null` = 退回按钮的 `checked`，报 ENV） | 点击是否落到正确状态（要真实指针，只能第三层） | 2、3A |
| `[overviewpatches] enabled (inset=ok band=ok|skipped)` (`overviewPatches.js:76`) | 两个补丁在这台 shell 上都装上了；第三层的 `overview-patches-roundtrip` 在一次真实 `disable→enable` 之后重读这行 —— 这是唯一能看出 D-062 的 revert 真把遮蔽放开的途径 | 真实桌面上概览的几何（那是 `overview-band`，第二层） | 2、3B |
| `_dbg` 输出、`hide-trigger` | 什么都不是：受 `DODGE_DEBUG=false` 门控、只在隐藏态打、每秒限一条，而且**打印窗口标题** | —— | 永不作为判据 |

## 10. 本机无法自动化的事情与原因

以下每一条都被直接试验过并且不可行，不要再花时间重试。

- **截图 / 视觉验证。** `org.gnome.Shell.Screenshot.Screenshot` 与 `.ScreenshotArea` 都回
  `AccessDenied: Screenshot is not allowed`；`gnome-screenshot`、`grim` 未安装。genie 漏斗
  好不好看就是人眼的事，没有例外。
- **指针输入。** `xdotool mousemove` 只移动 XWayland 内部的指针，mutter 不认（在 dock 底边
  按住 14 个位置得到 0 次 `peek show`，而同几分钟内用户的真鼠标得到 6 次）。`/dev/uinput`
  是 `0600 root:root`，也没有 EI/Ember 注入 portal（只有 `InputCapture`）。任何依赖指针位置
  的东西（peek、悬停放大、tooltip）都无法从会话内部触发。键盘侧的 `windowactivate` 走
  client message 是**有效**的，B 组用的就是它。
- **用窗口状态量动画时长。** `_NET_WM_STATE_HIDDEN` 在 `minimize()` 后 10–40 ms 就翻转，
  `_NET_WM_STATE_FULLSCREEN` 约 91 ms，因为 mutter 在请求时刻就发布状态，而 560 ms 的 actor
  动画还在跑。轮询窗口状态只能证明状态机，永远证明不了动画长度。
- **无头动画。** mutter 在那里根本不跑 map/minimize 路径。
- **实时会话的 `org.gnome.Shell.Eval`。** 需要 unsafe 模式，而它已经无法开启（对应 gsettings
  键已删除）。实时内省永远只能靠一条临时日志加一次注销。
- **实时会话里 dock actor 的几何/opacity** —— 没有 Eval 就观测不到，日志行是唯一通道。
- **把 `disable`+`enable` 当重载。** 它会重跑 `stop()` 和 `enable()`，所以是做开销对比的好
  办法，但 ES module 缓存意味着改过的代码永远不会加载。

## 11. 已有定论（需要新数据才能重开）

- dodge 的边缘判据一律用 **dock 自己所在的显示器**（`_dockMonitor()`，由 dock 矩形解析，
  解析不到才退回 primary），不是 `Main.layoutManager.primaryMonitor`。peek 触发区、"离边
  远不远"的收回判据、快/慢轮询的选择都读它。单屏时 primary 就是那块屏 —— 这正是它藏到接了
  第二块屏并设为主屏之前都不见的原因。
- dodge 的概览状态一律以 `Main.overview.visibleTarget` 校正，**不要读
  `visible`**：shell 自己的注释把 `visible` 定义为"正在进入、在概览里、正在退出"，所以在
  退出动画那约 200ms 里它仍是 true，会和 `hiding` 信号对着干（信号在退出的第一帧就已经把
  dock 收起）。一次开机实测到 40 组 300ms 内的 hide → `overview -> show`，就是"收起、弹
  一下、再收起"。进入方向不受影响：`_animateVisible()` 同时置两个标志，所以没有给显示增加
  任何延迟。
- 概览底部预留带按**自带 dash** 的 preferred height 计算（`overviewControls.js`
  `vfunc_allocate`），即使 dash 被隐藏也照算。隐藏自带 dash 会让它变空、该高度塌缩成主题
  内边距（36px），比该内边距高的本 dock 于是压住窗口选择器/应用网格。所以预留带遮蔽经 dash 的
  `get_preferred_height` 上报 dock 的占用高度，shell 便预留 `占用 + spacing`。它现在住在
  `lib/overviewPatches.js`（D-058），只通过注入的 `getBandMetrics()` provider 读 dock 高度。
  **不要**用"恢复自带 dash"来修：填充过的 dash 预留得远比 dock 需要的多。
- 非 dock 关注点一律**就地隔离**、单扩展单 uuid（D-058）：每个都是一个 `lib/` 模块，带边界头注释、
  自己的 `*-enabled` 设置与 `dockManager` 里**真正的** start/stop，以及探测→warn-once→降级。概览
  布局补丁（预留带 D-054 + 内缩 D-057）就是这样一个关注点，由 `overview-patches-enabled` 控制；
  Show Apps 按钮补丁（`lib/overviewApps.js`）从 `icons-fix-enabled` 解耦、改由
  `apps-button-fix-enabled` 控制（它的 stop 会触发 IconManager `reload`，因为该补丁替换了按钮原装的
  press 处理器）。genie 与 keynav 本已符合此标准。**不要**把这些再捆回 dock 自己的开关下。
- 概览的窗口预览被布局在一个**占满整个 window-picker 盒子**的容器里，而桌面背景是内缩在这个
  盒子里的（GNOME 50.1 实测：左右 20px、上下 12px）——于是预览会探出桌面边缘，窗口数让内容
  贴底时最明显（你报的"1 个明显、2 个没有、3 个轻微"）。这是**shell 自身的布局，与 dock 无关**：
  dock 开或关它都一样，这也是上次改 dash 高度（D-054）没碰到它的原因。修法
  （`lib/overviewLayout.js`，D-057）是包住私有的 `WorkspaceLayout._getWindowSlots`、把背景矩形
  传给它。内缩量从实时 allocation 读取、绝不硬编码，所以能跟随主题/显示器变化。只有 shell
  版本改动这个私有方法时才需重开（包装器会降级回原生、只打一行 warn）。
- 带着全屏窗口退出概览时，那条隐藏的理由是 `overlap` 而不是 `fullscreen`，因为 shell 自己
  在概览期间把 `monitor.inFullscreen` 清掉了。两条分支的结果都是隐藏，用户看不出区别；不要
  为了这个标签去加时序猜测 —— 那正是本 fork 避开的固定延时式 hack。
- 启动避让宽限是**可重新武装的闸门**，不是一次性计时器：下限 2000 ms、窗口事件静默 500 ms
  放行、硬上限 6000 ms（`dodge.js:65-67`）。把它锁成一次性会在稀疏事件开机上失败（仿真：1
  次隐藏 vs 0 次）。两条出口都有真实开机证据。
- `_noteWindowEvent()` 里那句条件 `_wake()` 是承重的。少了它，轮询会在下限处停表，闸门重新
  武装后没人再评估，dock 会**永远**不再避让。
- 打戳发生在 `doTick()` **之前**，所以"本该触发这次隐藏的那个事件"会先把闸门关上。这个顺序
  就是修复本身，不是细节。
- genie：`_steal()` 必须先于 `finishFor()`，且 `record.finish()` 只恢复它自己停放过的 actor
  —— 否则 Clutter 移除隐式过渡时会发 `stopped`，把 shell 的 `completed_minimize` 触发第二次。
- `AXIAL_BUNCH` 是漏斗唯一的手感旋钮。觉得不对就调这个常数；不要重构，也不要动
  `leadFrac`/`trailFrac` 的默认值（那两个是量过的）。
- 分隔线可见性由**settled** 图标集推导（跳过 `_dockRemovalPending`），因为淡出中的图标在
  `onComplete` 之前仍留在 `_icons`，否则会在 dock 收缩前 200 ms 先撑起一条分隔线。
- SPDX 定为 `GPL-2.0-or-later`：genie 上游自己的 `README.md` 就是这么写的，那是作者的授权
  选择。不要收紧。
- 已撤回、不要再以"省开销"为由重开：dodge 隐藏态心跳（实测 556 → 524 → 518 ticks，低于噪声），
  以及 genie 尾缘加 ease-in（实测约 3 帧内就有可见速度）。
- `dockManager.js` 里的 `dash._dashSpacer` 在 50.1 上是**惰性的，但仍然保留**（D-064）：本机 shell
  源码里搜不到这个字段，可 48/49 既已声明又跑不了，删掉等于对一个声称支持的版本做未验证的行为改动。
  只有在 48/49 上确认它真的不存在之后才可以删 —— **不要**把"在 50 上是死代码"当成许可。
- 放大 tick 的单趟读取是被**测出来**的，不是口味：D-063 之前 6 个图标每帧 12 次 position 读取，
  之后 6 次（`tick-geometry-reads`）。谁再把那个循环拆成两趟，就是在重新引入被计数的那件事。
- 密集开机时 dock 会故意最多约 6 秒不避让。那是选定的上限，不是 bug。要调只调
  `STARTUP_GRACE_CAP_MS`。

## 12. Schema、设置与编译产物

- 键的数量由第一层 `compiled-fresh` 打印（它比对 编译产物 == XML == shell 实际读到的），抄进
  这里只会过期 —— 本机当前是 57 个，是随 D-058 的两个开关长出来的。`prefs.js` 绑定其中 45 个；
  没绑的 12 个在守卫里是按名字钉住的（键盘代码从 shell 抢来的十个 `keynav-app-N`，加上它自己的
  崩溃恢复记账 `keynav-stock-backup` / `keynav-stock-dirty`）—— 注意 `keynav-enabled` 和两个
  `keynav-peek-*` **是**绑定的，所以"除 `keynav-*` 之外的全部键"并不是这条规则。第一层精确断言
  这个集合差，所以新键不可能悄悄绕过偏好窗口；两份 README 也必须逐键各有一行。
- `schemas/gschemas.compiled` 是**被跟踪的二进制**。改过 XML 之后必须
  `glib-compile-schemas schemas/` 重新生成 —— shell 是从编译产物读默认值的，产物过期就意味
  着运行时默认值和 XML 写的不一样。`static-checks.sh` 的 S6 会重编译到临时目录比对：可复现
  时逐字节一致（本机就是这样），否则退回比较两边暴露出的键集合。
- 启动时序常数是**代码常量而不是设置**（`dodge.js:65-67`、`iconManager.js:28,32,33`）。要改
  就得改代码并注销重登。
- 不带 `GSETTINGS_SCHEMA_DIR=<repo>/schemas` 时，`gsettings` CLI 连这个 schema 都看不见。

## 13. 公开仓库的隐私规则

- 提交正文可以引用**标签与数字**，绝不引用原始 journal 行，绝不引用窗口标题。先例：
  `f93ef54` 为一次开机验证打开 `DODGE_DEBUG`，`5c84880` 回退 —— 这两条正文里都引了真实标题，
  而它们现在已经公开了。请改写成"某个邮件客户端窗口""一个自启项"。
- `hide-trigger` 与任何 `DODGE_DEBUG = true` 都不得进提交。第一层那条 `DODGE_DEBUG` 守卫和
  A 组的哨兵就是为了把这件事变成机械检查。
- tracked 文件里不得有已解析的临时路径、wayland 槽名、主机名、用户名或邮箱。第一层的机器
  指纹守卫专查这一点，并且不会把查到的内容打印出来。
- 报告输出只有值：计数、抽出来的数字，绝不打印消息正文。
- 阶段证据（`PROFILE`/`AUDIT`/`PLAN`/`VERIFY`/`STATE`/`REVIEW-PACK`）放在 `docs/reports/`，它被 git
  忽略 —— 第一层按这个顺序测两半：先数其中有没有被跟踪的文件，**再**验忽略规则存在。顺序不是随便
  排的：`git check-ignore` 对已经进 index 的路径会回答"未被忽略"，先测规则就会把一份被 `add -f` 的
  证据误判成"规则缺失"。规则写的是不带前导斜杠的 `reports/`，所以它在任何层级都生效。journal
  原文、窗口标题、已解析路径**只能出现在那里**；tracked 文件和
  commit 正文照上面那条"只有值"的标准，不享受 `docs/reports/` 的豁免。
- 证据目录留在 `$TMPDIR` 下、mode 700、结束时删除；`--keep` 是给人本地看的，不是用来提交的。

## 14. 已知不修 / 待确认

- `metadata.json` 声明支持 48 和 49，而**这两版本机从没跑过**。关于 48/49 的一切说法都是从 50.1
  推断来的（见 §15）。要关掉这条得有一台 48/49 的机器或镜像，再多读代码读不出来。
- §16 的空闲基线**仍不存在**。两次尝试都被这套方法自己的规则判成废样：早先那一个样本取于机器正忙
  时（60 秒 27.5 秒 CPU，量的其实是别的活）；2026-10-10 的六臂 A/B 则是**在"做测量的 agent 自己
  占着一个核"的状态下取的** —— 两条臂都约 27 秒/60 秒、配对差值变号（−1.2 s、+1.0 s、−1.2 s）、
  40 MB 的 RSS 漂移与 dock 无关、6 条臂里 4 条没有可见证的活动。一次有效的采样需要：(a) 没有 agent
  进程在驱动这台机器，因此**不能由我在会话内部完成**；(b) 两条臂里都有由 harness 驱动、且被独立计数
  的活动。在那之前 §16 只是"有流程、没有带宽"，里面任何数字都不构成阈值。
- B 组的释放确认依赖合成器是否让探针窗口持有焦点；拿不到时该检查报 ENV。在空闲会话上跑就能
  得到答案。
- **登录后头几分钟内 B 组不可信。** 2026-10-10 在同一份代码上实测：对着开机 1.5 分钟的 shell，
  `control` 花了约 3 秒并 FAIL；20 分钟后对着同一份构建是 26 ms。自启动抖动（窗口事件、
  `installed-changed` 重载）正是 dodge 轮询在反应的东西。`preflight` 现在把 shell 的存活时长
  打进结果行，好让延迟判定能被归因。同一次会话里 mutter 拒绝给焦点的情况又出现了一次 —— 这
  就是 `flag-control` 改为以 B3 为前提、而不是直接报 FAIL 的原因（见 D-069）。
- genie 的**视觉**正确性在这台机器上不可验证（无截图、无注入），只有结构性覆盖：无头与实时
  各跑一次 `_validate()`，加上真实的两次最小化与两次还原期间八条失败日志和那条永久的
  `end-without-complete` 闩锁全程静默。
- `_onPointer` 里指针触发的 peek 抑制只是"由构造证明"（同一个谓词，且在 hold 能触发之前求值），
  从未被观测到，因为指针输入不可用。
- `gschemas.compiled` 的字节可复现性只在这台机器、这个 glib 版本上确认过。
- A 组的 `overview-flicker` 计数描述的是**本次开机跑的那份代码**，不是工作树上的代码：
  它读的 journal 是注销之前的旧代码写的。修复没被加载之前，它会把旧开机的 40 次报成 `ENV`，
  这是正确行为、不是通过 —— 真正的验证要一次注销加一次复现，然后这个数必须是 0。
- 第一层的用例数是下限，所以"改个套件名"也能让覆盖率倒退。


## 15. GNOME 兼容矩阵

有两列，而且它们不是一回事：`metadata.json` **声明**了什么，以及这台机器上**实测**过什么。
把两者写成一列，就是一个 fork 开始发行"从没测过的支持"的方式。

| Shell | 已声明 | 本机实测 | 该版本上本 fork 依赖的事实 |
|---|---|---|---|
| 45–47 | 否 | 否 | 不支持。ES 模块改写、`Meta.get_window_actors()` 形状、`St`/`Clutter` 版本都在 48 之前动过，这里没有任何东西面向它们。 |
| 48、49 | **是** | **否** | 未测。已知的一处差异是 `dash._dashSpacer`：50.1 里不存在（所以 `dockManager.js` 那个分支在本机是惰性的），而 48/49 上有没有该字段**无法验证** —— 这正是 D-064 保留分支而不是删掉它的原因。除这条之外，关于 48/49 的一切说法都只是从 50.1 出发的推断。 |
| 50.1（mutter-18、gjs 1.88） | 是 | **是，出货目标** | `Main.overview.visibleTarget` 存在（dodge 的概览校正读它，并留 `visible` 兜底）。`ControlsState = {HIDDEN:0, WINDOW_PICKER:1, APP_GRID:2}`，且 fork 现在从模块解析它而不再硬编码 `2`（D-061）。`dash._dashSpacer` 不存在。`Layout._trackActor()` 在 `destroy` 时自动摘除登记（`layout.js:962-965`），见 §8。概览把 dash 夹在 `box.height * DASH_MAX_HEIGHT_RATIO` = 0.16 内（`overviewControls.js:23,174-178`）。`Main.uiGroup` 是官方写明向后兼容的别名。shell 的 JS 以 GResource 存在 `/usr/lib/gnome-shell/libshell-18.so` 里（111 个 `ui/*.js`，重取命令：
`gresource list /usr/lib/gnome-shell/libshell-18.so | grep -cE '^/org/gnome/shell/ui/.*\.js$'`），**不在** `/usr/share/gnome-shell`。 |
| 51 及以后 | — | — | 见下面的流程。预期库名会变（`libshell-19.so`），那会让本文件里所有查源码的命令失效。 |

**新 major 出现时**（完整流程在 §7，这里是与版本相关的部分）：

1. **升级之前**先把新 major 加进 `metadata.json`。`extensionSystem.js` 用 `v.startsWith(major)`
   判定 `_isOutOfDate`，没列出的 major 意味着扩展静默根本不加载 —— 那你调试的就是一个从没跑起来
   的东西。
2. 找到 shell 源码：`ls /usr/lib/gnome-shell/libshell-*.so`，然后
   `gresource list <那个文件> | grep '/ui/'`。不要沿用上一行的数字。
3. 对着抽出来的文件逐个复核 §8，按这个顺序（它们每一个在本 fork 历史上都至少动过一次）：
   `Main.wm._minimizing`/`_unminimizing`、`WorkspaceLayout.prototype._getWindowSlots`、
   `Main.overview.dash.get_preferred_height`、`ControlsState`、`Layout._trackActor` 的 destroy 连接。
4. 在**新 shell 上**先跑第一层再跑第二层 —— `test:headless` 是唯一真正探测私有符号的地方，
   而且它不需要注销。
5. 第三层仍然是"用户实际感觉到什么"的裁判，而它是三层里唯一会读你正在使用的会话的那一层，
   不能无人值守地动。

## 16. 固定度量方法：空闲 CPU、内存与泄漏

之所以把 witness（见证）步骤写进流程，是因为"机器正忙时取一个样本"毫无价值：写这一节期间取的
一次 60 秒读数显示会话 shell **60 秒内吃了 27.5 秒 CPU（单核的 45.8%）** —— 那是机器上的其它
工作，与 dock 无关。合格的问题从来不是"多少毫秒"，而是"开着它比关掉多消耗多少"。

**两条臂。** 同一时间轴上做 A/B，只有一个变量：扩展开 / 关。`disable`+`enable` 确实会在缓存的
类上重跑 `stop()`/`enable()`，所以即使它永远加载不到改过的代码，作为"切换臂"的手段是有效的。
每条臂期间会话必须别无所动：不键入、不播视频、没有 agent 在跑构建，每臂至少 60 秒，重复两轮。
**也不能有 agent 在做测量本身** —— 当 agent 运行时占住一个核（`load1` 4–6）时，两条臂都读到约
27 秒 / 60 秒的 shell CPU，绝对数字因此毫无价值；只有配对差值有意义，而这个差值先要能盖过逐轮
变号的噪声（有负载的第一次尝试：每 60 秒 −1.2 s、+1.0 s、−1.2 s）。

```sh
# 取 pid：绝不能盲目 pgrep -x gnome-shell —— 别的 agent 会跑 --headless 的 shell
pid=$(bash -c 'source test/common.sh; shell_pid'); HZ=$(getconf CLK_TCK)
cpu(){ awk -v h="$HZ" '{print ($14+$15)/h}' "/proc/$pid/stat"; }   # CPU 秒
rss(){ awk '/VmRSS/{print $2}' /proc/$pid/status; }                # kB
fds(){ ls "/proc/$pid/fd" | wc -l; }
t0=$(cpu); r0=$(rss); f0=$(fds); sleep 60; t1=$(cpu); r1=$(rss); f1=$(fds)
python3 -c "print('每分钟 CPU 毫秒=%.0f RSS 变化 kB=%s fd 变化=%s' % (($t1-$t0)*1000, $r1-$r0, $f1-$f0))"
```

**内存采样点。** 固定三个，顺序永远是：登录后 settle 之后、N 次 `enable`/`disable` 循环之后、
N 次最小化/还原之后，全部对第一个点取差值。**基线出来之前不要凭空写阈值**：合格区间来自第一次
实测，而不是来自文档 —— 没被某次运行打印出来的 `MAINTENANCE` 数字就是猜测。

**见证步骤（最常被跳过的那一步），而且我第一版写错了。** 如果这期间什么都没发生过，一条平的 RSS
曲线证明不了任何事，所以每轮都要记下"工作确实做了"的证据。但这个证据**不能**用扩展自己的日志行：
关闭的那条臂按构造就不打任何日志，用日志当见证就等于把每一条对照臂都判成废样，A/B 永远做不成。
见证应该是 harness **自己驱动并独立计数**的动作 —— 探针窗口的映射/撤销、发出的最小化/还原请求，
外加这段时间窗口内整机的 `load1`。2026-10-10 按旧规矩的第一次尝试：6 条臂里有 4 条零条标签日志
（两条因为扩展关着，两条因为压根没发生事），有一对臂的 RSS 因为与 dock 无关的原因涨了 40 MB，
配对 CPU 差值来回变号（每 60 秒 −1.2 s、+1.0 s、−1.2 s）—— 也就是与 0 不可区分。见证计数为 0 的
样本要**丢弃**，而不是报成"干净" —— 与 §1 那条同一个规矩：
分不清"回归"和"机器当时在忙"的断言一律是 `ENV`。

**actor / source 泄漏。** RSS 之外还要数"本该被释放的东西"：`global.get_window_actors().length`，
以及只在私有 shell 里数的 `Main.layoutManager._trackedActors.length`（一次 enable/disable 循环前后各
一次；第二层的 `chrome-untracked` 就是这件事的正式断言）。fd 计数能抓到 RSS 掩盖掉的 D-Bus 与
文件描述符泄漏。

**这里量不到的东西。** hover 手感、genie 的视觉质量，以及任何需要真实指针的事情：指针注入不可用
（`/dev/uinput` 是 `0600 root:root`，XTEST 的 warp 到不了合成器的光标，没有 EI/Ember portal），
截图是 `AccessDenied`。对这些，诚实的替代指标是**每帧计数** —— `tick-geometry-reads` 能证明每帧的
工作量确实变小了 —— 而"看起来对不对"这个问题仍然归用户（§10）。
