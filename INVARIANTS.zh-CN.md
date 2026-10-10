<p align="right"><a href="INVARIANTS.md">English</a> | <a href="INVARIANTS.zh-CN.md"><b>简体中文</b></a></p>

# 不变量

已在真实 shell 上验证过、**不得**回退的修复。本文件是一份指针清单，不是第二份拷贝：机制、测量
与推理都住在 [`CHANGELOG.md`](CHANGELOG.md)（`D-###`）与 [`MAINTENANCE.zh-CN.md`](MAINTENANCE.zh-CN.md)
§11 里（英文版见 [`MAINTENANCE.md`](MAINTENANCE.md)）。若本清单与那两个文件冲突，以它们为准，
本文件即为过期。

| Id | 规则 | 证据层级 | 回退它的代价 |
|---|---|---|---|
| D-002 | 在图标揭示链里保留 `_started` 守卫 | L? —— 早于层级约定，且没有任何检查覆盖它 | 登录后整块 dock 的图标闪烁会回来 |
| D-051 | dodge 从 `Main.overview.visibleTarget` 而不是 `visible` 对账 overview 状态 | L2，实测 300 ms 内闪烁特征从 40 → 0 | 退出 overview 动画期间 dock 会重新弹出来 |
| D-052 | 边缘与轮询阈值是按 **dock 所在的那块显示器** 量的 | L1，构造的双显示器堆叠布局（H13） | dock 放在副屏时 dodge 会静默失效 |
| D-053 | disable 时把 overview 的 dash 还原为 shell 的默认值，绝不还原成 enable 时抓的快照 | L2 | 布局中途抓的快照会让扩展关闭后 overview 没有 dash |
| D-054 | overview 底部条带从 dock 的占用高度里预留 | L1（`overview-band`） | 比主题内边距更高的 dock 会压住窗口选择器 / 应用网格 |
| D-059 | 一次指针事件 **只解析一次** dock 所在显示器 | L1（`motion-monitor-resolve`，2 次调用即红） | 把扩展里最热的那条路径重新拆回两次 GI 数组转换 |
| D-061 | 网格状态来自 shell 的 `ControlsState`，绝不用字面量 `2` | L1（`grid-state-source`）+ L2（`grid-state-loaded`） | 枚举一旦重编号，网格检测会自信地判错且无声 |
| D-062 | 对已应用的补丁，还原必须是 **真实且幂等** 的 | L1（`patch-revert-idempotent`）+ L2（`overview-patches-roundtrip`） | 被吞掉的还原错误会让补丁残留整个会话 |
| D-063 | 放大 tick 是单趟的 | L1（`tick-geometry-reads`，每帧 12 → 6 次读） | hover 路径上翻倍的分配流量 |
| D-064 | `dash._dashSpacer` 虽然 50.1 上是惰性的，仍然保留 | L0 + 在 48/49 上未测 | 删掉它是在一个已声明支持的 major 上的未验证行为变更 |
| D-072 | `overview-flicker` 判的是"shell 显示后又自我否定"的一次显示 —— 绝不是裸的 hide→show 对 | L1（`overview-flicker`，fixture 在 `test/flicker.test.js`） | 这个对形状也正是真实进入 overview 会写的，于是每次真实进入都会变成误报回归 |

关于这份清单本身的两条规则：

- **`kind: taste` 的条目不是不变量。** Genie 的漏斗手感（`AXIAL_BUNCH`）与预览内缩（D-057）是偏好：
  一次升级可以整体丢弃它们。它们记在 `CHANGELOG.md`，不在这里。
- **撤回的条目归 MAINTENANCE §11，不在这里。** "别再提"的条目（dodge 把隐藏态心跳当省 CPU、
  genie 的拖尾 ease-in）是"决定不改"，与"永不回退这个修复"是相反性质的断言。
