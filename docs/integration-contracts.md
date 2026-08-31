# 三产品集成契约

状态：冻结用于 Context Continuity `0.2.0-beta.1`。
适用对象：Intent Loop、Context Continuity、Execution Fidelity Guard 与宿主 Agent。

这份契约只有一个目的：避免三插件和宿主各自维护“最终真相”。当前发行只冻结所有权
和 wire shape，不宣称跨仓库实时桥接已经实现。

## 唯一有效状态的所有权

| 组件 | 拥有 | 不拥有 |
| --- | --- | --- |
| Intent Loop | 规范化的当前用户语义意图、`contract_ref`、`contract_version`、实质变更判断与用户消息来源 | 连续性快照、Guard 决策、执行收据、宿主权限与运行状态 |
| Context Continuity | 有损转换事件、恢复阶段、开放承诺、工作对象与版本、完成/证据引用、快照与 handoff 运输 | 已绑定 provider 的意图改写、授权判断、Guard 策略、完整 transcript |
| Execution Fidelity Guard | Hook 动作分类、继续/提醒/询问/阻止判断、自身事件/收据/证据和 Stop 计数 | 意图写入、provider 版本、连续性状态写回、Agent 循环与宿主审批 |
| 宿主 Agent / Harness | 实际工具执行、生命周期投递、UI、沙箱、信任、权限审批和运行时 Goal 状态 | 把平台摘要升级为权威意图，或把 Guard 收据当作用户授权 |

语义目标与运行时 Goal 状态必须分开：Intent Loop 拥有用户意图合同，宿主拥有它实际
创建和执行的 Goal 对象及状态。

最终有效状态按 namespace 投影：

- 存在安全 Intent Loop 绑定时，它是 intent namespace 的唯一 owner；Continuity 只
  引用该合同并拥有 operational/lifecycle namespace。
- 没有绑定时，Continuity 只能用自己的精确用户确认协议维护 standalone intent；这
  是独立模式，不是第二份 Intent Loop 真相。
- Guard 只读判断，Host 只执行与审批。
- 平台摘要、检索拼装、模型记忆、handoff 和子 Agent 输出只是缓存或候选。

## Intent Loop 到 Continuity

未来自动绑定必须同时提供：

- 稳定且不可变的 `contract_ref`；
- 仅在经用户授权的实质变更时严格递增的 `contract_version`；
- provider 规范化投影的 `snapshot_sha256`；
- 最小状态项及其原始 source refs；
- 映射后状态项的规范 `items_digest`。

当前核心已测试版本回退、同版本碰撞和 hash 不一致，但 Codex MCP 与 DSH tools 都不
暴露 provider/token 字段。模型、用户或 Skill 不得自行提供 token，也不得调用内部
方法绕过身份边界。

截至本版本，Intent Loop 仍没有一条同时满足不可变单调 revision、规范 hash、来源
完整且模型不可伪造身份的已发布 producer 通道。因此，同时安装两个插件不会自动形成
共享真相。实时适配器只能运行在模型不可见的受信宿主进程中。

预定最小映射：

| Intent Loop facet | Continuity kind |
| --- | --- |
| outcome | objective |
| hard_constraint | hard_constraint |
| unknown | open_question |
| disagreement | dispute |

`success_signal`、`failure_signal`、`soft_constraint` 与 `tradeoff` 保持
provider-owned reference；未经协议版本迁移不能偷偷变成新的 Continuity kind。

## Continuity 到 Execution Fidelity Guard

本节与
[Execution Fidelity Guard v0.2.0 契约](https://github.com/rrrrrredy/execution-fidelity-guard/blob/v0.2.0/docs/integration-contract.md)
对齐。

Guard 的用户意图输入仍是其冻结的 envelope 加七字段 intent projection。Context
Continuity 不伪装成 intent provider；它提供另一份只读 snapshot shape：

```json
{
  "schema_version": "1.0",
  "contract_ref": "intent:stable-task-id",
  "contract_version": 1,
  "phase": "implementation",
  "open_commitments": ["next:verify-release"],
  "evidence_refs": ["artifact:sha256:..."],
  "captured_at": "2026-08-31T00:00:00.000Z"
}
```

字段规则：

- `schema_version` 是 wire shape 版本，只接受 `1.0`；
- `contract_ref/version` 只引用 Intent owner；
- `phase` 只取当前仍 verified 的 operational phase，否则为 `unknown`；
- `open_commitments` 只包含 open_question/dispute 稳定 ID 和仍 verified 的
  next_action；stale/unverified next_action 不导出为可执行承诺；
- `evidence_refs` 只含当前 verified 的引用，不复制正文；
- `captured_at` 只表示捕获时间，不决定优先级。

Guard v0.2 当前只有文件 provider，没有 live Continuity bridge，也没有 DSH
adapter。Context Continuity 不写入 Guard；Guard 也不写回 Intent Loop 或
Continuity。该 shape 是经过测试的交换边界，不是已上线的自动集成。

## 写回和冲突规则

- Guard 永不写回 Intent Loop 或 Context Continuity。
- Continuity 不通过 Guard 的 deny/ask/receipt 修改用户意图。
- Guard 收据若未来成为 evidence，只能由模型不可见的受信适配器作为候选导入，并保留
  原 `contract_ref/version`；模型不能自行标为 verified。
- 新用户纠正高于旧快照；standalone Continuity 仍要求完整提案的第二次精确确认。
- provider 不可用或契约无效时保持未绑定或最后已验证引用，并标记陈旧风险；不得用
  平台摘要补齐缺口。
- 合同版本、工作对象或高风险承诺不一致且无法从可靠证据修复时，暂停相关高风险动作，
  只问一个必要问题。
- Guard 的 `requires_user` 只有 Intent owner 产生新合同版本后才能解除；聊天回答
  不会被 Guard 自行消费。

## 实时集成退出门槛

市场文案只有同时满足以下条件后才能从“协议边界已对齐”改为“自动集成”：

1. Intent Loop 提供稳定 revision、规范 hash、完整来源和模型不可伪造的 producer。
2. 宿主提供模型不可见的 adapter 身份与凭据边界。
3. Continuity 对真实 provider 完成成功、回退、同版本碰撞、hash 错误和缺失测试。
4. Guard 从真实 Continuity producer 读取 snapshot，验证 exact shape 且无写回。
5. Codex 和 DSH 分别完成组合测试，证明只有一个有效 intent owner。
6. 禁用任一插件时其余宿主仍可 fail-open 工作。
7. 文档明确版本兼容、升级、删除和错误恢复路径。

在此之前，三个项目可以共享协议和测试夹具，不能共享一份由谁都能改写的状态文件。
