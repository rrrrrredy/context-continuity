# 三产品集成契约

状态：冻结用于 Context Continuity 0.1.0。
适用对象：Intent Loop、Context Continuity、Execution Fidelity Guard 与宿主 Agent。

这份契约防止三个插件和宿主各自维护一套“最终真相”。0.1.0 冻结所有权和 wire shape；除 Context Continuity 自己导出的只读投影外，不宣称跨仓库实时桥接已经实现。

## 唯一有效状态的所有权

| 组件 | 拥有 | 不拥有 |
| --- | --- | --- |
| Intent Loop | 规范化的当前用户意图、`contract_ref`、`contract_version`、实质变更判断和用户消息来源 | 连续性快照、Guard 决策、执行收据、宿主权限 |
| Context Continuity | 有损转换事件、恢复阶段、开放承诺、工作对象与版本、完成证据引用、快照与 handoff 运输 | 在已绑定 provider 时重新解释意图、授权决策、Guard 策略、完整 transcript |
| Execution Fidelity Guard | 规范化 Hook 事件、动作分类、继续/提醒/询问/阻止判断、最小证据与收据 | 意图写入、provider 版本、连续性状态写回、Agent 循环、宿主审批 |
| 宿主 Agent | 工具执行、Hook 投递、会话生命周期、用户交互、沙箱、信任和权限审批 | 把平台摘要变成权威意图，或把 Guard 收据当成用户授权 |

最终有效状态按 namespace 投影，不由某个摘要文件决定：

- 有 Intent Loop 的安全绑定时，Intent Loop 是 intent namespace 的唯一 owner；Continuity 只引用该合同并拥有 operational/lifecycle namespace。
- 没有绑定时，Continuity 只能用自己的精确用户确认协议维护 standalone intent；这不是 Intent Loop 的副本。
- Guard 和 Host 都不拥有上述语义状态。Guard 只读判断，Host 只执行与审批。
- 平台摘要、检索拼装、模型记忆、handoff 和子 Agent 输出只是缓存或候选。

## Intent Loop 到 Continuity

未来自动绑定必须同时提供：

- 稳定且不可变的 `contract_ref`；
- 对实质性、经用户授权的意图变更严格递增的 `contract_version`；
- provider 规范化投影的 `snapshot_sha256`；
- 映射后的最小状态项及来源；
- 映射后状态项的规范 `items_digest`。

0.1.0 的核心保留并测试了版本回退、同版本碰撞和哈希不一致的内部适配协议，但公共 Codex MCP 不暴露绑定工具或 provider/token 字段。原因不是缺少数据结构，而是当前插件调用路径不能可靠地把 provider 身份和凭据隔离在模型之外。模型、用户或 Skill 不得自行提供 token，也不得调用内部服务方法绕过该边界。

Intent Loop 当前发行候选也没有暴露一份同时满足上述不可变单调 revision、规范 hash 和最小映射的公开 producer 文档。因此，同时安装两个插件不会自动形成共享真相。实时适配器只能在宿主提供模型不可见的受信进程后启用。

预定最小映射：

| Intent Loop facet | Continuity kind |
| --- | --- |
| outcome | objective |
| hard_constraint | hard_constraint |
| unknown | open_question |
| disagreement | dispute |

`success_signal`、`failure_signal`、`soft_constraint` 和 `tradeoff` 保持 provider-owned reference；只有经过独立协议扩展和迁移测试后才能成为新的 Continuity kind。

## Continuity 到 Execution Fidelity Guard

本节与 [Execution Fidelity Guard v0.1.0 冻结契约](https://github.com/rrrrrredy/execution-fidelity-guard/blob/v0.1.0/docs/integration-contract.md) 对齐。

Guard 当前读取 Intent Loop/TaskContractLite provider 的 envelope 加七字段意图 projection。Context Continuity 不伪装成这个 provider。它只导出另一份预留的只读 snapshot：

~~~json
{
  "schema_version": "1.0",
  "contract_ref": "intent:stable-task-id",
  "contract_version": 1,
  "phase": "implementation",
  "open_commitments": ["next:verify-release"],
  "evidence_refs": ["artifact:sha256:..."],
  "captured_at": "2026-08-28T00:00:00.000Z"
}
~~~

字段语义：

- `schema_version` 是 wire shape 版本，0.1.0 只接受 `1.0`；
- `contract_ref` 与 `contract_version` 只引用意图 owner 的合同身份；
- `phase` 只取当前仍为 verified 的 operational phase；否则为 `unknown`；
- `open_commitments` 包含 open_question 和 dispute 的稳定 ID，以及当前仍为 verified 的 next_action；stale/unverified next_action 不导出为可执行承诺；
- `evidence_refs` 只含当前仍为 verified 的证据引用，不复制正文，不包含 stale/unverified 证据；
- `captured_at` 是捕获时间，不参与覆盖优先级。

该结构与 Guard 的 `continuity-snapshot.schema.json` 对齐。Guard 0.1.0 不加载它，Context Continuity 也不会写入 Guard；这是已测试 shape 的 interchange boundary，不是 live bridge。Guard 明确不向 Intent Loop 或 Continuity 写回任何状态。

## 写回和冲突规则

- Guard 永不写回 Intent Loop 或 Context Continuity。
- Continuity 不通过 Guard 的 deny/ask/receipt 修改用户意图。
- Guard 收据若未来成为 evidence，只能由模型不可见的受信适配器以候选证据导入，并保留原 `contract_ref/version`；模型不能自行标记 verified。
- 新用户纠正高于旧快照，但 standalone Continuity 必须先生成完整提案并由用户第二次精确确认；自然语言、模型转述或旧 prompt event 不能直接铸造用户权威。
- provider 不可用或契约无效时保持未绑定或最后已验证引用，并显式标记陈旧风险；不得用平台摘要补齐缺口。
- 合同版本、工作对象或高风险承诺不一致且无法从可靠证据修复时，暂停相关高风险动作并只问一个必要问题。
- Guard 的 `requires_user` 只有意图 owner 产生新合同版本后才能解锁；聊天中的回答不会被 Guard 自行消费。

## 集成退出门槛

实时桥接只有同时满足以下条件才可从“未实现”改为“支持”：

1. Intent Loop 提供稳定 revision、规范 hash、来源完整且可只读验证的 producer 文档；
2. 宿主提供模型不可见的 adapter 身份与凭据边界，Continuity 不通过公共 MCP 接收 token；
3. Continuity 对真实 provider 完成成功、回退、同版本碰撞、hash 错误和 provider 缺失测试；
4. Guard 从真实 Continuity producer 读取上述七字段 snapshot，且验证无写回；
5. 三插件组合测试证明只有一个有效 intent owner，禁用任一插件时其余宿主仍可 fail-open 工作；
6. 文档明确版本兼容、升级、删除和错误恢复路径。

在这些门槛完成前，市场文案只能说“协议边界已对齐”，不能说“三插件已自动集成”。
