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
