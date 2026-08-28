# 隐私、存储与删除

## 默认存什么

- 每个任务一个本地 ledger.json，包含最小状态项、来源引用、时间、覆盖关系、验证状态和生命周期事件。
- 最多保留最近 3 个压缩快照。
- 每条非空用户提示保存 SHA-256、字符数、检测到的信号和最多 512 字符的脱敏片段，只用于来源关联、风险检测和审计。它不能证明模型生成的结构化语义与用户原意相同；用户权威状态必须由用户第二次精确确认完整提案。完整提示和完整 transcript 不会被复制。
- 子 Agent 结果只保存哈希和最多 512 字符的脱敏候选片段，不直接进入有效状态。
- 工作区只保存规范路径、Git HEAD 及有界的 tracked/untracked 内容哈希，不复制项目文件。超出扫描上限时会把验证状态标为不完整。
- Hook 提供的 session、turn、item 和 subagent 标识只以有界哈希形式落盘；不保存调用方传入的原始宿主标识。

## 明确不存

完整 transcript、隐藏推理、完整工具输出、凭据、访问令牌、私钥和默认长期记忆。常见 token、Authorization header、私钥块和密码式字段在落盘前脱敏。

脱敏覆盖常见 token、Basic/Bearer Authorization、Slack token、私钥块和密码式字段，但它只是纵深防御，不是秘密扫描器。用户不应把凭据写入目标、约束或状态字段。

提示哈希没有加盐，不能抵抗对低熵、可猜短句的离线字典推断；因此它不应被当作保密存储，也不能替代脱敏和最小化。

公共 MCP 不接受外部 intent provider token 或 verified-evidence token。相关内部适配接口必须在未来由模型不可见的宿主进程隔离凭据；0.1.0 没有对模型开放这条路径。

## 位置与保留

当前已验证的 Codex 安装环境把 Hook 与 MCP 的共享状态放在 `CODEX_HOME/plugin-data/context-continuity/v1`；其他兼容宿主可提供 `PLUGIN_DATA` 或 `CLAUDE_PLUGIN_DATA`。若安装后的 MCP 环境变量被清理，只在入口确实位于 `CODEX_HOME/plugins/cache/` 下时从该受限结构推导同一目录。直接运行源码或测试时可用 `CONTEXT_CONTINUITY_DATA_DIR` 指向明确的本地目录，并具有最高优先级。未提供任何持久目录时会标记 `volatile_data_root`，恢复时视为高风险。

MVP 的硬上限是每任务 2000 个事件、8 MiB ledger、3 个快照、单快照 512 KiB、128 个当前有效项；单次状态更新最多 64 项，导入 handoff 最多 128 项且不超过 256 KiB。达到上限时拒绝该次连续性写入并 fail-open 宿主，不通过扩大摘要或隐式删历史来腾空间。

30 天是建议清理期，不在后台自动删除，以免宿主没有可靠任务结束语义时误删仍需恢复的数据。

## 用户控制

- continuity_get_state 或 CLI show：查看状态、来源和缺口。
- continuity_manage_state 的 off/on：按任务停用或启用，也必须经过明确请求、一次性 challenge 和第二条精确用户确认。
- rebuild：从 ledger 重建并核验投影。
- MCP reset/delete：先从明确用户请求生成一次性 challenge，再要求第二条用户提示与返回短语完全一致；challenge 有事件窗口且不能跨任务复用。
- 诊断 CLI reset/delete：要求第二个独立的 confirm_task_ref 与带命名空间的 task_ref 完全一致；reset 会把旧任务目录移入本插件本地 archive 后初始化新状态。

删除只作用于哈希映射后的单个任务目录，代码会同时做词法路径和 realpath 边界核验。插件不会删除原始对话、项目文件或宿主记忆。

## 与长期记忆的隔离

连续性 ledger 是任务内状态，不是长期记忆候选库。任何长期记忆系统若要读取它，必须重新核验来源、有效期和适用范围；单次压缩摘要、未验证 Agent 推断或 imported handoff 不得自动提升为长期记忆。
