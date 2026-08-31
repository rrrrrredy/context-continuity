# 隐私、存储与删除

## 默认存什么

- 每个任务一个本地 `ledger.json`，包含最小状态项、来源引用、时间、覆盖关系、验证
  状态和生命周期事件。
- 最多保留最近三个压缩快照。
- 每条非空用户提示只保存 SHA-256、字符数和检测信号，用于来源关联与精确确认。
- 只有检测到目标、约束、纠正、授权、重置或分歧等连续性风险时，才额外保存最多
  512 字符的脱敏片段；普通提示和仅用于一次性管理确认的提示不保存正文片段。
- 子 Agent 结果只保存哈希和最多 512 字符的脱敏候选片段，不直接进入有效状态。
- 工作区只保存规范路径、Git HEAD 及有界 tracked/untracked 内容哈希，不复制项目文件。
- 宿主 session、turn、item 和 subagent 标识只以有界哈希形式落盘。

提示观察只能证明消息来源，不能证明模型生成的结构化语义与用户原意一致。用户权威
状态仍需第二次精确确认完整提案。

## 明确不存

完整 transcript、隐藏推理、完整工具输出、凭据、访问令牌、私钥和默认长期记忆。
常见 token、Authorization header、私钥块和密码式字段在落盘前脱敏。

脱敏是纵深防御，不是秘密扫描器。用户不应把凭据写进目标、约束或状态字段。提示哈希
没有加盐，无法抵抗低熵短句的离线字典推断，因此不能当作保密存储。

Codex 公共 MCP 与 DSH native tools 都不接受外部 intent provider token 或
verified-evidence token。DSH session log 也不写入插件私有未知事件。

## 位置与保留

Codex 默认：

```text
$CODEX_HOME/plugin-data/context-continuity/v1
```

DeepSeek Harness 默认：

```text
$DSH_HOME/plugin-data/context-continuity/v1
```

直接运行源码、测试或托管部署时，可用 `CONTEXT_CONTINUITY_DATA_DIR` 指向明确
本地目录，并具有最高优先级。Codex 安装环境若清理 MCP 环境变量，只在入口真实位于
`CODEX_HOME/plugins/cache/` 下时从该受限结构推导同一数据目录。未获得持久目录
时标记 `volatile_data_root`，恢复按高风险处理。

硬上限为每任务 2,000 个事件、8 MiB ledger、三个快照、单快照 512 KiB、128 个当前
有效项；单次状态更新最多 64 项，handoff 最多 128 项且不超过 256 KiB。达到上限时
拒绝本次连续性写入并 fail-open 宿主，不会扩大摘要或暗中删历史腾空间。

30 天是建议清理期，不做后台自动删除，避免宿主缺少可靠任务结束语义时误删仍需恢复
的数据。

## 用户控制

- get state / show：查看状态、来源、验证状态、缺口和 generation。
- off/on：按任务停用或启用，要求明确请求、一次性 challenge 和第二条精确确认。
- rebuild：核验 ledger 哈希链并重建投影，不改写语义。
- reset/delete：先生成一次性 challenge，再要求第二条精确确认。
- 诊断 CLI reset/delete：要求独立的 `confirm_task_ref` 与命名空间 task_ref 完全
  一致。

reset 把旧任务目录移入本插件本地 archive 后初始化新状态。delete 只作用于哈希映射
后的精确任务目录，并同时核验词法路径与 realpath 边界。插件不会删除原始对话、项目
文件、宿主记忆或其他插件数据。

卸载 Codex 插件或 DSH profile 插件不会静默删除 ledger。用户需要先按任务 delete，
或核对解析后的 `CODEX_HOME` / `DSH_HOME`，再删除精确
`plugin-data/context-continuity` 目录。

## 与长期记忆隔离

连续性 ledger 是任务内状态，不是长期记忆候选库。任何长期记忆系统若读取它，必须
重新核验来源、有效期和适用范围。单次压缩摘要、未验证 Agent 推断或 imported handoff
不得自动提升为长期记忆。
