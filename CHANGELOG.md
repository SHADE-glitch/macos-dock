# CHANGELOG — macos-dock@local

Personal maintenance fork of [MacOSDock](https://github.com/vinnytherobot) by vinnytherobot, frozen at
upstream **v9** and imported at `a2140d0` (with the genie animation merged in from the Genie
effect). This file records only deviations I introduced after that import.

Coverage: a2140d0..HEAD
Check with `npm run check:log`. Entries are `D-###`, monotonic, never reused.
An entry states what was true **as of its commit**, not current state: old entries are not
re-verified, and aggregate counts live in the checker's output, never in this file.

> **Why the window starts at the baseline and not at the `freeze-2026-09-23` tag.** That tag points
> at `85eb488`, an ordinary separator-line fix, not at a state boundary; anchoring there would have
> silently dropped the whole P1/P2 batch (`0a40055` … `bc924ad`) from the record. The tag is left
> alone — it is a release marker, not a coverage boundary.

> **How these were written.** `Symptom` / `Change` are compressed from commit subjects plus the
> state of the touched file at HEAD; diffs were not re-read one by one. `Evidence` names a test only
> where that suite was re-run in the session that wrote the entry (`test/static-checks.sh`, 5 checks
> pass at adoption); everything else is `L?`. Subjects carrying P1-x / P2-x are audit ids from
> `MAINTENANCE.md` and are kept verbatim so the two can be cross-read.

`kind`: `fix` bug · `perf` measurable degradation only · `taste` my preference, zero obligation ·
`guard` detects drift · `revert` withdraws earlier work · `chore` cleanup owed nothing either way.
Animation *feel* is `taste`, not `fix`: those entries are the ones an upgrade may discard wholesale.

---

### D-001 · 2026-09-22 · revert · v1
Symptom  接管初期做的性能优化与启动时序改动范围超出"冻结维护"该承担的面
Change   整体回退那批改动，按冻结维护标准收紧范围
Evidence L?
Cost     **本仓的范围定论**：后续所有改动都按这条划线。重提同类优化先读 MAINTENANCE §11
Commit   c35f763

### D-002 · 2026-09-22 · fix · v1
Symptom  登录后整排 dock 图标闪烁
Change   恢复 `_started` 启动守卫
Evidence L?
Cost     与 D-011 / D-022 同一条启动揭示链
Commit   85138ac

### D-003 · 2026-09-23 · fix · v1
Symptom  显隐逻辑分散在两处；另有五项启动期与泄漏小问题
Change   合并 dodge 显隐逻辑并修那五项
Evidence L?
Cost     这是一个 wip 提交，内含多件事；单独回滚任何一项都要重新读 diff
Commit   1c7e613

### D-004 · 2026-09-23 · perf · v1
Symptom  P2-8：动画阻塞期 dodge 的 hide 日志连刷
Change   把 hide 日志移到 `_hide()` 守卫之后
Evidence L?
Cost     日志面，不改行为；但它同时是"动画被阻塞"的读数来源
Commit   bc924ad

### D-005 · 2026-09-23 · fix · v1
Symptom  P2-7：dodge 的 `stop()` / `_refreshDodge()` 强制把 opacity 设成 255，打断启动淡入
Change   尊重启动淡入，不再强制赋值
Evidence L?
Cost     与 D-002 同属启动期互相覆盖的一类；两处都要守
Commit   f32f185

### D-006 · 2026-09-23 · fix · v1
Symptom  P2-6：magnification 轮询与 dockManager 在容器已销毁后继续执行
Change   增加容器销毁门卫（仿 dodge 的写法）
Evidence L?
Cost     门卫模式在三个模块里各有一份，改一处要看另两处
Commit   8dc784c

### D-007 · 2026-09-23 · fix · v1
Symptom  P2-9：`_doWindowChange` 淡出的 `onComplete` 回调触碰已销毁 actor
Change   回调里加已销毁守卫
Evidence L?
Cost     只在动画被打断时触发，静态 tier 测不到
Commit   9c24e55

### D-008 · 2026-09-23 · chore · v1
Symptom  P2-12：iconFix 用裸数字判断窗口类型
Change   改用 `Meta.WindowType` 符号（行为不变）
Evidence L0 本轮重跑 `test/static-checks.sh`（19 个 js 全部解析、schema 编译一致）
Cost     无行为变化；可读性改动，升级时既无义务保住也无损失
Commit   e68a6e2

### D-009 · 2026-09-23 · fix · v1
Symptom  P1-1：`installed-changed` / `favorite-apps` 一律走全量重建，settle 之外可见闪烁
Change   全部改走增量同步
Evidence L?
Cost     增量的正确性依赖 D-014 的 `_enforceOrder` 不误报；两条是一对
Commit   0a40055

### D-010 · 2026-09-23 · fix · v1
Symptom  P1-3：预览弹窗不跟随悬停应用切换，或在不该复用时复用
Change   同 app 才复用，退场动画中可复活
Evidence L?
Cost     与概览状态互相引用，改这里要看 D-050
Commit   cd4d56b

### D-011 · 2026-09-23 · perf · v1
Symptom  P1-2：magnification 以 60Hz 常驻唤醒，空闲时也在跑
Change   空闲停表、靠近时重启
Evidence L?
Cost     停表后"靠近"的唤醒通路只有一条时会在 Dock 显现时失灵——正是 D-033 补的第二条
Commit   35e7b59

### D-012 · 2026-09-23 · perf · v1
Symptom  P1-5：dodge 固定 500ms 轮询，隐藏且贴近边缘时响应迟钝
Change   自适应降频：隐藏近边缘 120ms，其余 500ms 心跳
Evidence L?
Cost     两个周期值都是折中，不是最优；改动要重新量
Commit   1b6c0a7

### D-013 · 2026-09-23 · fix · v1
Symptom  P1-4 方案 A：stock 快捷键 schema 被上游改动打崩时整个扩展起不来
Change   加崩溃自愈 sentinel（自有 schema 存备份 + dirty 标记）
Evidence L0 本轮重跑 `test/static-checks.sh`（schema-valid / compiled-fresh：55 keys 三方一致）
Cost     **哨兵类修复**：判据是"能否人为制造一次 dirty"，不是"跑绿"
Commit   2d12d57

### D-014 · 2026-09-23 · fix · v1
Symptom  `_enforceOrder` 误报：索引比较把 separator 与 button 也算进位次
Change   索引比较剔除 separator/button，稳态零移动
Evidence L?
Cost     误报会把增量同步（D-009）拖回全量重建
Commit   b553792

### D-015 · 2026-09-23 · guard · v1
Symptom  分隔线显隐异常无法定位，缺少计数与触发源
Change   分隔线增删打点日志（favs/running 计数 + 触发源）
Evidence L?
Cost     纯观测；它被删掉后那类显隐问题会重新变成只能靠猜
Commit   148ba0f

### D-016 · 2026-09-23 · perf · v1
Symptom  grace 期固定上限，开机后 dock 揭示被无谓拖长
Change   条件化提前结束（floor 400ms + 静默 500ms，cap 1200ms **只早不晚**）
Evidence L?
Cost     "只早不晚"是这条的约束方向；放宽成可晚会重新引入闪烁
Commit   868d2b9

### D-017 · 2026-09-23 · fix · v1
Symptom  分隔线删线与图标淡出不齐：淡出中的图标没被计入，结算时机过早
Change   计入淡出中图标，fade-complete 再结算
Evidence L?
Cost     `freeze-2026-09-23` 标签就落在这笔上；它不是覆盖边界（见表头）
Commit   85eb488

### D-018 · 2026-09-24 · perf · v1
Symptom  dock 首帧被 grace 拖住，完全不透明要到 T0+1440ms
Change   首帧即揭示，grace 收尾改走增量（T0+1440ms → T0+250ms）
Evidence L?
Cost     与 D-016 / D-002 同一条启动揭示链，数字是当时实测
Commit   3c0f611

### D-019 · 2026-09-24 · taste · v1
Symptom  上游没有 genie 最小化动画
Change   引入 genie 动画引擎与几何模块（GPL-2.0-or-later，许可见 LICENSES.md）
Evidence L0 本轮重跑 `test/static-checks.sh`；`genieGeometry.test.js` 覆盖几何纯函数
Cost     **本仓最大的一块外来血统**：许可证是 GPL-2.0-or-later 而非上游的 GPL-3，改这块要先读 LICENSES.md
Commit   c372a51

### D-020 · 2026-09-24 · taste · v1
Symptom  genie 需要"图标方块"而非整个按钮的矩形
Change   新增图标矩形解析器（复用 appId→图标 actor 映射）
Evidence L?
Cost     依赖 appId 映射的稳定性，上游改名会静默退化
Commit   9ff76f4

### D-021 · 2026-09-24 · taste · v1
Symptom  genie 未接进最小化/还原，且完成回调不止一次触发
Change   接入最小化/还原，回调恰好一次
Evidence L?
Cost     "恰好一次"是停放恢复（D-026）的前提
Commit   dc54ac0

### D-022 · 2026-09-24 · taste · v1
Symptom  dodge 在动画期间收不到探头请求；探头时长还会被更短的后续请求提前收起
Change   支持动画期间探头（可关闭），并取最长时长
Evidence L?
Cost     开关是偏好；取最长时长是缺陷修正——同一笔提交里的两件事，若日后要拆再拆
Commit   4a94512 32f1c3f

### D-023 · 2026-09-24 · taste · v1
Symptom  Super+数字触发时 dock 不弹出
Change   触发时弹出 Dock，独立开关与时长
Evidence L?
Cost     新增可配置面（schema 键），回退要连 schema 一起退
Commit   b02cb2c

### D-024 · 2026-09-24 · taste · v1
Symptom  genie 的漏斗轴向、缓动曲线、尾部淡出范围、挤压与吸入深度都需要定形
Change   按 Dock 边推导漏斗轴向；缓动改快起快收；尾部淡出只作用尾段；贴近图标时的挤压/吸入深度定形，收尾改平滑淡出
Evidence L?
Cost     纯观感，**升级时可整块丢弃**；四笔合为一条是因为它们共同构成"这套动效长什么样"这一个决定
Commit   008fe04 70108bd 5a346eb 04a86de

### D-025 · 2026-09-24 · perf · v1
Symptom  genie 每帧新建变换对象
Change   每帧变换零分配
Evidence L?
Cost     与 D-024 的观感调参同批但判据不同
Commit   7b3f41b

### D-026 · 2026-09-24 · taste · v1
Symptom  genie 网格数固定，窗口大小差异下材料密度不一致
Change   网格数随窗口自适应
Evidence L?
Cost     观感参数
Commit   b19a4d0

### D-027 · 2026-09-24 · fix · v1
Symptom  genie 吸收深度的默认值与 schema 声明不一致
Change   对齐默认值与 schema
Evidence L0 本轮重跑 `test/static-checks.sh`（compiled-fresh：编译产物 == XML == shell 读到的）
Cost     schema 与默认值不一致是静默缺陷，只在首次运行暴露
Commit   86cee0e

### D-028 · 2026-09-24 · perf · v1
Symptom  放大平滑按帧数推进，掉帧时速度突变
Change   改为时间基
Evidence L?
Cost     与 D-024 同批但判据不同
Commit   ae1b073

### D-029 · 2026-09-24 · taste · v1
Symptom  genie 动画期间放大效果互相干扰
Change   genie 动画期间暂停放大
Evidence L?
Cost     观感决定
Commit   369e441

### D-030 · 2026-09-24 · perf · v1
Symptom  dodge 静止时仍在轮询
Change   静止时停轮询
Evidence L?
Cost     停轮询后需要唤醒通路，见 D-033
Commit   19cc16f

### D-031 · 2026-09-24 · fix · v1
Symptom  dodge 滑动方向固定，Dock 在左右/上边时轴向错
Change   滑动轴向跟随 Dock 位置
Evidence L?
Cost     多位置配置下才暴露
Commit   e56c3f7

### D-032 · 2026-09-24 · perf · v1
Symptom  genie 还原时源 actor 仍在场景里；还原走逐帧计算
Change   还原走快照并停放源 actor
Evidence L?
Cost     停放与 mutter 计数收支耦合，见 D-035
Commit   1cf8628

### D-033 · 2026-09-24 · taste · v1
Symptom  genie 动画时 dock 图标静止，缺少呼应
Change   图标轻微下压回弹
Evidence L?
Cost     观感；其存活判定后来被 D-036 补守卫
Commit   b6ab9fb

### D-034 · 2026-09-24 · taste · v1
Symptom  增量新增的图标直接硬出现
Change   新增图标淡入
Evidence L?
Cost     观感
Commit   93998f4

### D-035 · 2026-09-24 · fix · v1
Symptom  dodge 捕捉不到窗口拖动与缩放（轮询看不到几何事件）
Change   改为逐窗口几何监听
Evidence L?
Cost     监听器生命周期要与 D-006 的销毁门卫配套
Commit   de39891

### D-036 · 2026-09-24 · fix · v1
Symptom  genie 接管顺序与停放恢复造成 mutter 的 actor 计数下溢
Change   修正接管顺序与恢复路径，消除下溢
Evidence L?
Cost     计数收支必须成对，判据是"每轮动画后计数回到原值"
Commit   72771bb

### D-037 · 2026-09-24 · fix · v1
Symptom  分隔线按未 settled 的图标数判定，产生孤儿分隔线
Change   改按真实图标数判定
Evidence L?
Cost     与 D-015 的打点是同一问题的两面
Commit   b772371

### D-038 · 2026-09-24 · perf · v1
Symptom  运行指示点每轮刷新都各自走查窗口
Change   每轮只做一次窗口走查
Evidence L?
Cost     走查结果共享后，任何一处的写操作都会影响其他处
Commit   c010ce4

### D-039 · 2026-09-24 · fix · v1
Symptom  图标下压的存活判定不容忍 wrapper 已销毁
Change   容忍 wrapper 已销毁
Evidence L?
Cost     GJS 里访问已 dispose 对象是运行时错误，不是静默无效
Commit   1fe7887

### D-040 · 2026-09-24 · fix · v1
Symptom  放大轮询停表后，Dock 显现时不再被唤醒（只有一条唤醒通路）
Change   补第二条唤醒通路（Dock 显现时）
Evidence L?
Cost     通路数量是这类停表逻辑的判据，单通路等于会失灵
Commit   709fe31

### D-041 · 2026-09-25 · fix · v1
Symptom  分隔线在淡出图标尚未消失时被撑出来
Change   按 settled 状态判定，淡出图标不再撑出分隔线
Evidence L?
Cost     与 D-017 / D-037 同一条分隔线判定链，三处一致才对
Commit   508efea

### D-042 · 2026-09-25 · perf · v1
Symptom  dodge 的全屏判定靠猜测，且一直在监听 chrome 窗口
Change   走 mutter 权威状态判定全屏，停止监听 chrome
Evidence L?
Cost     少一类监听也少一类唤醒；回到自判会重新引入误隐藏
Commit   161889d

### D-043 · 2026-09-25 · taste · v1
Symptom  genie 材料沿轴向均匀堆积，视觉上不像被吸进 dock
Change   轴向非均匀堆积，材料向图标口收束
Evidence L?
Cost     纯观感，零义务
Commit   a9b0625

### D-044 · 2026-09-25 · taste · v1
Symptom  genie 时长不遵循无障碍的减速设置
Change   时长遵循 `slow_down_factor`
Evidence L?
Cost     这是"观感"与"无障碍合规"的交叉；丢掉它会成为可访问性缺陷而不是偏好问题
Commit   ec56b03

### D-045 · 2026-09-25 · chore · v1
Symptom  genie 调试期留下的临时诊断探针仍在代码里
Change   清理 genie 临时诊断探针
Evidence 不适用（无行为变化）
Cost     探针残留会让下一次读数失真，必须撤干净并回读
Commit   3051cd9

### D-046 · 2026-09-25 · fix · v1
Symptom  隐藏动画期间的显示请求被直接丢弃
Change   隐藏动画期间的显示请求不再被丢弃
Evidence L?
Cost     与 D-005 / D-031 同在显隐状态机上
Commit   ae2993f

### D-047 · 2026-09-25 · fix · v1
Symptom  开机避让用固定 2 秒宽限，机器快慢不同时要么过长要么不够
Change   改为"窗口静默"判据
Evidence L?
Cost     判据化后依赖 D-015 那类打点才能验证，别再退回常数
Commit   6b66a2a

### D-048 · 2026-09-25 · chore · v1
Symptom  需要一次开机现场证据，dodge 日志默认关闭
Change   临时打开 `DODGE_DEBUG`（仅用于那一次验证）
Evidence L?
Cost     **临时**开关；它被 D-049 撤掉，两者必须成对读
Commit   f93ef54

### D-049 · 2026-09-27 · fix · v1
Symptom  genie 用未 clamp 的 curvature 计算 c1/c2，极端设置下几何崩坏
Change   用 clamp 后的 curvature 计算，并补上本仓第一个测试套件
Evidence L0 本轮重跑 `test/static-checks.sh` 与 `npm test`（genieGeometry / signalManager / repo 套件在列）
Cost     测试与被修的是同一件事，回滚修复会把套件弄红
Commit   f724c38

### D-050 · 2026-09-28 · revert · v1
Symptom  D-048 的临时调试开关不应留在树里
Change   Revert「chore(debug): 临时打开 DODGE_DEBUG」
Evidence L?
Cost     与 D-048 成对。记录一次回退比记录十次成功更有用——这条就是那类"当初为什么收紧"的证据
Commit   5c84880

### D-051 · 2026-10-07 · fix · v1
Symptom  概览退出动画把 dock 弹回（可见性目标未校正）
Change   概览状态改按 `visibleTarget` 校正
Evidence L?
Cost     判据写在 MAINTENANCE §11；签名是"退出动画结束时的一次回弹"
Commit   6863e43

### D-052 · 2026-10-07 · fix · v1
Symptom  边缘判定与轮询阈值都假定 primary 显示器，dock 放副屏时失效
Change   改用 dock 所在显示器的几何
Evidence L?
Cost     多显示器才暴露；单屏验证过的结论对这条不成立
Commit   c45b46f

### D-053 · 2026-10-07 · fix · v1
Symptom  关闭扩展时把 enable 时抓取的概览 dash 值写回，覆盖了用户在会话期间的改动
Change   关闭时按 shell 默认恢复，不再回写抓取值
Evidence L?
Cost     与 D-013 的"备份 + dirty"是同一类恢复语义：恢复的基准应该是默认值，不是我见过的值
Commit   cb8a34a

### D-054 · 2026-10-09 · fix · v1
Symptom  隐藏自带 dash 使其变空，概览底部预留带随之塌缩到主题内边距（36px），低于本 dock 占用高度，dock 顶边侵入窗口选择器/应用网格
Change   `_hideDefaultDash` 给被隐藏的 dash 实例遮蔽 `get_preferred_height`，上报 dock 占用高度；`_showDefaultDash` 里 `delete` 还原
Evidence L1 overview-band
Cost     GNOME 50 的概览底部预留带是 shell 从自带 dash 的 preferred height 推出来的（`overviewControls.js`），隐藏它会让 dash 变空——**隐藏不等于不参与布局**；`_dashSpacer` 在 GNOME 50 已删，旧写法是死代码
Commit   023b739

### D-055 · 2026-10-09 · fix · v1
Symptom  `test/headless-checks.sh` 收尾只 `kill` 了 `dbus-run-session`，它 fork 出的私有 dbus-daemon 与 gnome-shell 被 reparent 到 systemd 后继续存活；一天的运行残留 7 个无头 shell + 18 个私有 dbus-daemon（约 580 MB）
Change   新增 `t2descendants`（先子后父收集，趁 reparent 前 `pgrep -P` 还看得见）与 `t2killtree`（整棵子树 TERM→KILL）；trap 改调 `t2killtree`；`teardown` 由恒 PASS 改为真实断言——快照子树、回收、逐个 `/proc` 证明 pid 已消失
Evidence L1 teardown
Cost     `dbus-run-session` 的子进程不止命令本身，还有它自己的 dbus-daemon；`kill $INNER` 一个都够不着。**判据必须是"快照过的 pid 全部消失"，不能是 `kill` 的返回码**——上一轮正是被返回码骗过（循环报 gone，`ps` 里 7 个全在）
Commit   1f7d0d3

### D-056 · 2026-10-09 · chore · v1
Symptom  被 `SIGKILL` 的 `test/headless-checks.sh` 运行（或主机断电）会把它在 `/tmp/macosdock-t2-*` 的沙箱目录留在原地，之后没有任何东西回收；一次手工清理时已累积 16 个（2.9 MB）
Change   创建 `$T2` 之前加一次启动清扫：回收 `macosdock-t2-*` 中 mtime 超过一小时的目录，有回收就打印一行非 report 的说明
Evidence L1 sandbox
Cost     清扫必须带**年龄闸门**——按名字无差别删会误删并发运行的新沙箱（一次运行 ≤150 s）。它是卫生动作而非断言，所以刻意不发 `report` 行，MAINTENANCE 里"断言 16 项"的数字才不用跟着变
Commit   b71ace1

### D-057 · 2026-10-09 · taste · v1
Symptom  概览里窗口预览探出桌面边缘（左右各 20px、下方 12px），窗口数让内容贴底时最明显（"1 个明显、2 个没有、3 个轻微"）
Change   新增 `lib/overviewLayout.js`：在原型上包裹 `WorkspaceLayout._getWindowSlots`，把桌面背景 `WorkspaceBackground` 的实测矩形当作槽位区传入；`dockManager` 在 enable 挂载、disable 还原；结构探测缺符号即降级原生
Evidence L1 overview-window-inset
Cost     这是 **shell 自身布局**（预览容器占满整个盒子、背景内缩其中），与 dock 无关——dock 开或关都一样，所以上次改 dash 高度（D-054）根本没碰到它。补丁依赖 shell 私有布局，升级改名即降级（一行 warn，不崩）。属视觉偏好：预览可用高度少 12px、宽度少 40px，会整体缩放一点点
Commit   980c4db

### D-058 · 2026-10-09 · chore · v1
Symptom  四类非 dock 关注点（概览布局补丁、genie 窗口动画、全局快捷键、Show Apps 按钮补丁）与 dock 本体混在一起：概览补丁（D-054/D-057）常开且硬编码在 `dockManager` 里，Show Apps 按钮补丁搭在 `icons-fix-enabled` 下——既关不掉、也说不清边界
Change   概览布局补丁抽进新 `lib/overviewPatches.js`（`overview-patches-enabled` 开关；dock 高度经注入的 `getBandMetrics()` 读取，模块不再反向 import DockManager）；Show Apps 按钮补丁从 `iconFix`/`icons-fix-enabled` 解耦为 `apps-button-fix-enabled`（stop 触发 IconManager reload 以恢复原装按钮）；genie/keynav 补边界头注释（本已有独立开关）。每个非 dock 关注点 = 一个模块 + 一个 `*-enabled` + 真 start/stop + 探测→warn-once→降级
Evidence L1 overview-patches, apps-button
Cost     **就地隔离而非拆扩展**：这些件与 dock 有真实耦合（genie 要图标矩形、keynav 要图标顺序、按钮补丁要 dock 的按钮），硬拆要造跨扩展接口、反而更贵。**不要**再把它们捆回 dock 自己的开关下。新增 schema 键必须同步 prefs（repo.test.js 守卫）；`overviewApps` 的 stop 会有一次 dock 重建/闪动（改设置很少见）
Commit   0e15fff

### D-059 · 2026-10-09 · perf · v1
Symptom  一次 motion 事件把 dock 所在显示器解析两遍：`_onPointer` 自己 `_dockMonitor()` 一次，随后 `_pointerFarFromEdge(px,py)` 内部又解析一次；每次都要把 `Main.layoutManager.monitors` 转成新的 JS 数组并线性扫描
Change   `_pointerFarFromEdge(px, py, monitor = null)` —— 已解析出 monitor 的调用方直接传入，不传时走原来的自解析路径；`_shouldPark` 那条不带坐标的调用与 H13 几何用例行为不变
Evidence L1 motion-monitor-resolve（对修复前的代码实测 `calls=2` 红，修复后 `calls=1` 绿）
Cost     调用图上的去重，**没有 L2 毫秒数**：本机注入不了指针。仍值得做的理由是这条路径不限流、且正是"跟手"的判定路径；量化收益继续挂在 §10 的人工清单上
Commit   73c2f55

### D-060 · 2026-10-09 · guard · v1
Symptom  两件事无人断言：motion 路径的重复解析（D-059 修的正是它），以及"禁用之后我们的 chrome actor 是否还留在 `layoutManager._trackedActors` 里"——后者原本只是审计里一条**静态推断**
Change   `test/headless-checks.sh` 加两项：`motion-monitor-resolve`（直接调 `_onPointer` 并统计 `_dockMonitor()` 次数）、`chrome-untracked`（销毁容器 → `disable()` → 问注册表）。破坏性探针必须排在最后——第一次跑时后面的探针拿到 ENV "no dodge instance"，那是仪器问题不是代码问题
Evidence L1 chrome-untracked
Cost     审计里那条"禁用后泄漏 chrome 注册"的 P1 结论**撤回**：实测无残留，原因在 shell 一侧（`Layout._trackActor()` 把 actor 的 `destroy` 连到 `_untrackActor`，已登记 MAINTENANCE §8）。`chrome-untracked` 留作哨兵——哪天 shell 去掉那条自动连接，`dockManager.js:287` 拿 `_container` 是否存活来决定要不要 `removeChrome` 就重新变成真泄漏
Commit   75f034c

### D-061 · 2026-10-09 · fix · v1
Symptom  Show Apps 按钮判断"我在不在应用网格里"用的是裸数字 `v === 2`（shell 的 `ControlsState.APP_GRID`）。改名会降级，**重排**则让它自信地答错且不打一行日志；而它的兜底 `showAppsButton.checked` 正是同文件注释里写明"不再信任"的过期来源
Change   模块加载时从 `ui/overviewControls.js` 解析一次 `ControlsState.APP_GRID`；解析不到就 warn-once 并显式走兜底。`applied` 日志加 `grid=<n>`，把"用的哪个值"变成可读的判据
Evidence L1 grid-state-source（对修复前红：那行日志没有 `grid=`；修复后绿，且与同一轮 shell 自己报出的枚举值相等）
Cost     新增一条对 shell 模块的 import（`overviewControls.js`），属公开导出而非私有字段。日志行格式变了——第三层若有按 `applied (` 取的断言要一起看
Commit   18c4d8b

### D-062 · 2026-10-09 · fix · v1
Symptom  两处概览补丁在检测到自己标志位已置时返回 **noop revert**。该分支只在"上一次 revert 抛错被调用方吞掉"时到达，一旦走到，遮蔽的 `get_preferred_height` 与原型上的 `_getWindowSlots` 包装在剩余会话里再也撤不掉——禁用扩展也不撤
Change   把 revert 提到早退之前构造并两个分支共用（它无状态：删自有属性即还原原型方法）；`overviewLayout` 把原始方法存到原型 `_dockOverviewLayoutOrig`，免得已应用时把自家包装当"原始"存回去。另补一条 warn-once：`WorkspaceLayout._container` 被改名时 `_previewArea()` 只返回 null 静静退回原生布局，而模块头写着"任何缺失都 warn-once"——兑现自己许下的承诺
Evidence L1 patch-revert-idempotent（修复前红：`shadowStillInstalled=true`、`insetStillApplied=true`；修复后绿，且探针收尾重新 apply 成功）
Cost     正常开关路径本来到不了这条分支（`dockManager._startOverviewPatches` 持有 revert 就早退），所以这是**纵深防御**而非当前缺陷；`noop` 变量在两条路径里仍有别的用途
Commit   0380cf9

### D-063 · 2026-10-09 · perf · v1
Symptom  hover tick 每个图标每帧读两遍几何：算 minDist 一趟 `get_position()+get_size()`，缩放又一趟；pivot 校正里 `get_pivot_point()` 为取 [0] 和 [1] 各调一次；`smooth` 闭包每帧新建。实测一帧 6 个图标 = **12 次** position 读取，每次都是一个新 GI 数组
Change   单趟几何 pass 把圆心写进复用的 `_centers` 配对数组，其后两趟只读普通数字；`smooth` 提到模块作用域。pivot 仍在本帧设置、far-away 早退的判据与阈值一字未动
Evidence L1 tick-geometry-reads（修复前红 12/6，修复后绿 6/6）。仪器说明：本机 `global.set_pointer` 不存在，改成遮蔽 `global.get_pointer()` 恰好一帧，并在 `finally` 里还原
Cost   只覆盖"图标数变化时数组残留旧尾巴"这一处语义差异——多出来的数字不会被读到（循环按 children.length bound）。人眼感受仍属 §10 无法自动化的部分
Commit   259fe4f

### D-064 · 2026-10-09 · chore · v1
Symptom  审计把 `dash._dashSpacer` 分支列为"死代码，删"
Change   删前先核：本机 shell 的 `ui/*.js` 里搜不到这个名字（50.1 确实没有），但 `metadata.json` 还声明 48/49，这两个 major 在本机无法运行、无法验证字段是否存在。于是**保留分支**并把事实边界写在代码里：此处惰性，删除需要真机验证过再动
Evidence L0（grep 本机 shell 源）；48/49 一侧为"需人工确认"
Cost     反过来也成立：直接删等于对未验证的 major 做行为改动，违反"稳定性优先"。这条记录的作用是阻止下一轮把同一个"死代码"再删一次
Commit   e067e5c

### D-065 · 2026-10-09 · guard · v1
Symptom  D-061/D-062/D-063 三件事在修之前都没有任何检查能发现
Change   第二层加 `grid-state-source`、`patch-revert-idempotent`、`tick-geometry-reads` 三项；顺带把该层全部 `H` 序号按文件出现顺序重排（此前 H18 排在 H17 前面，且新插入的块撞过号）
Evidence L1 三项各自红→绿见 D-061/D-062/D-063
Cost     `tick-geometry-reads` 依赖遮蔽 `global.get_pointer`——一次只罩一帧、`finally` 还原；留着它会让后续探针读到假指针
Commit   2498a28

### D-066 · 2026-10-09 · guard · v1
Symptom  57 个 schema 键里 README 只点名 2 个；往 schema 加一键不会有任何东西提示文档落后。另：阶段证据目录此前叫 `reports/`（仓库根），与同工作区其它仓的 `docs/reports/` 不一致
Change   第一层新增 `README documents every settings key`——双语 README 各需为每个键写一行（键名以反引号形式出现），先跑红再补表；`reports/` 迁为 `docs/reports/`（忽略规则仍是不带前导斜杠的 `reports/`，任何层级生效；`listFiles()` 按 basename 跳过，一处覆盖两处）；S8 探测路径随之改到 `docs/reports/`，并把"已跟踪计数"这半**挪到**"忽略规则存在"之前——实测 `git check-ignore` 对已在 index 里的路径直接答"未被忽略"，原顺序会把"证据已被 add"误报成"规则缺失"
Evidence L0/L1 红→绿各两次：guard 在表写出前红（`README documents no row for: icon-size, magnification-enabled, …`），写后 75 assertions / 21 suites 绿；S8 在一次性克隆里跑过四态——无规则=红(规则缺失)、有规则=绿、`git add -f docs/reports/STATE.md`=红("1 file(s) … tracked")、撤销 staging=绿
Cost     schema 每加一键要动三处（README 双语各一行；这一半由守卫兜住，描述写没写对兜不住）。README 键表与 `prefs.js` 的 subtitle 是两处并行文案，会分叉——这一点在拍板时已知并选择
Commit   a6a17a1

### D-067 · 2026-10-09 · guard · v1
Symptom  INVARIANTS.md 是人写的指针表：条目被删、检查被改名、或把 `taste` 当成"不得回退"，它都会**继续显示为一张正常的表**。AGENTS.md 规定它"不抄正文"，但没人能机械判断它有没有开始抄
Change   新增 `test/invariants.mjs`（纯 Node）承载规则 6.0–6.7：表非空、四格齐全且无占位符、id 解析到真实条目、自上而下严格递增、`taste` 不得列为不变量、证据列以 L0/L1/L2/L? 开头、证据列里反引号包住的连字符 token 必须是 harness 仍在报告的检查名、正文不得从 CHANGELOG 整段照抄。两个消费者共用同一份实现与同一个条目正则：`check-log.mjs` 作为第 6 项（`--invariants` 单跑它，纯文档改动不必走一遍 commit 窗口），`repo.test.js` 在 `npm test` 里跑同一次校验，所以第一层与 CI 都会抓到过期行
Evidence L0/L1 逐条打红：`test/invariants.test.js` 对每条规则各造一个违规表并断言报出的正是那条规则，另有一个绿色控制组（格式正确的表零报告，`visible`/`lib/dodge.js`/`test:live-trigger` 不被误认成检查名）。真表在一次性克隆里被四种破坏各打红一次——改名后的检查名(6.6)、指向不存在的条目(6.2 连带 6.3)、把 D-057 这个 taste 条目当不变量(6.4)、从 CHANGELOG 整段复制 336 字符(6.7)，每次都恢复并复验绿；`repo.test.js` 走第一层路径同样红 1 / 绿 0
Cost     一条**真红**从这里暴露：6.6 的初版只匹配小写，`tick-geometry-reads` 半改名成 `tick-geometry-readX` 会静默通过，改成大小写与下划线都收。反过来它是有意的宽松——证据列里若把非检查名的词用反引号包住（形如 `some-phrase`），会得到一次假红，代价只是去掉那对反引号。文档里"12 个键没有偏好行"这句话现在由 `EXPECTED_UNBOUND.length === 12` 撑着
Commit   c425a44

### D-068 · 2026-10-09 · chore · v1
Symptom  两处抄进文档的聚合数已经和真实值分叉：`test/check-log.mjs` 头部写"57 个改代码的 commit"（实际 65，且每提交一次就变），`MAINTENANCE.md` §0 写"72 assertions, 20 suites"（实际 95/24，读起来像刚测过的数）。同一类问题本轮已经第二次撞上
Change   两处都改成命令派生：头部不再留数字，交给这次运行打印；§0 改成"`npm test` 自己打印，第一层守下限"。顺带把第一层下限从 72/20 **抬到 95/24**——下限的设计是"加测试不会红"，但长期低于实际值等于给"某个套件不再被收集"留下 23 个断言的容身空间
Evidence L0 复现命令随文写进 §15（`git rev-list --count a2140d0..HEAD -- extension.js lib/ stylesheet.css`；`gresource list … | grep -cE '^/org/gnome/shell/ui/.*\.js$'`）。抬下限这步做了反向验证：一次性克隆里移走 `test/genieGeometry.test.js` → `FAIL coverage dropped to 52/16 (floor 95/24)`，放回来 → `ok 95 assertions in 24 suites`，克隆已删
Cost     以后每次加用例都要在同一次改动里把下限一起抬上去，否则"加了但没抬"会让下次真的丢套件时仍然绿。这条是**约定不是守卫**——没有任何检查能发现"下限设得太低"
Commit   edc7706 e3159da

### D-069 · 2026-10-10 · fix · v1
Symptom  组 B 的 `flag-control` 无条件运行。B3 因 mutter 不肯把焦点给探针窗口而报 ENV 的那一轮，B4 在**同一个坏焦点环境**里跑 flag-off 臂，拿不到 show 就判 `FAIL still suppressed with the setting off — B3's silence was not the fullscreen branch`——措辞是产品回归，实际是仪器
Change   记下 B3 的返回码（`B3_RC`），非 0 时 `flag-control` 直接 ENV 并**跳过** flag-off 这一臂，连带不去写 `hide-in-fullscreen`
Evidence L2 同一天两条路径都真跑过：修复前那次是 `ENV fullscreen-suppresses-show` + `FAIL flag-control`（15 pass / 1 fail）；修复后 rc=6 的那次报 `ENV flag-control — B3 gave no attributable sample (rc=6)`，焦点正常的那次 B3/B4/`fullscreen-reversible` 连成一片 PASS（20 pass / 0 fail / 1 env）
Cost     B3 失败时不再获得 flag-off 的独立信息（少一条证据，但那条证据本来不可归因）；`control` 的延迟判定另有一处环境噪声见 MAINTENANCE §14（登录后头几分钟）
Commit   c5972fc

### D-070 · 2026-10-10 · guard · v1
Symptom  D-061 与 D-062 只有无头层证据：真会话里枚举是否真的解析出来、幂等 revert 之后补丁是否真的重新装上，都没有任何一行日志被断言过
Change   组 A 加 `grid-state-loaded`（`[appsbtn] applied (… grid=<n>)` 必须是整数；`null` = 退回按钮 `checked` → ENV；缺行 → ENV；形状不对 → FAIL），组 B 加 `overview-patches-roundtrip`（真实 `disable→enable` 后必须重新出现 `enabled (inset=ok band=ok)`，并检查 `band skipped` / `overviewlayout disabled` 两条降级）。`preflight` 顺带打印 shell 存活秒数，提醒语只在 <300 s 时出现
Evidence L2 真机：`grid-state-loaded PASS (value 2)`、`overview-patches-roundtrip PASS（toggle 后 0 s 重新装上）`。分支覆盖用抽取原文的方式对四份合成 journal 各执行一次，得到 PASS / ENV / ENV / FAIL；preflight 两分支用桩时钟各跑一次
Cost     `grid-state-loaded` **故意不封顶 0/1/2**——D-061 的存在理由就是不信任字面量，判据不能把它请回来，代价是 shell 把枚举挪到别处时这里只会报形状。第一版 preflight 无条件附上"under ~5 min"的提醒，把 553 s 自己标成可疑，属于检查文案与自己数据打架，已改成条件式
Commit   c5972fc

### D-071 · 2026-10-10 · chore · v1
Symptom  §16 的 witness 步骤规定"每轮记下工作确实做了的证据"，给的证据是扩展自己的日志行（`[dodge] … -> …`、`enable() total`）。关闭的那条臂按构造不打任何标签日志 —— 照这条规则，每一条对照臂都会被自动判成废样，A/B 永远无法完成。规则自己不可执行
Change   见证改为 harness **自己驱动并独立计数**的活动（探针窗口映射/撤销、发出的最小化/还原请求）加上该窗口的 `load1`；扩展日志从此是被测对象，不是见证。§16 的"两条臂"段同时补上"做测量的 agent 也不能在跑"这条前提
Evidence L1 第一次六臂 A/B 实测（同一份代码，`pid=3147`）：A/B 各约 25.6–29.7 s CPU / 60 s，配对差 −1191 / +1020 / −1171 ms（变号），一对臂 RSS +40264 kB 与 dock 无关，6 条臂中 4 条见证为 0 → 按规则**全部丢弃**。`final state=ACTIVE enabled=Yes`，收尾 trap 生效，扩展没被留在关闭状态
Cost     空闲基线仍然不存在，因此 §16 只有流程没有带宽，任何数字都不是阈值；并且 (a) 这项采样**不能由 agent 在会话内部完成**——我一运行就在污染它，只有你在 agent 停下的时候能取。旧样式的 §14 说法（"归用户在空闲会话上跑"）不足以解释为什么这次跑了还是不算，已改写
Commit   2b9cd8a
