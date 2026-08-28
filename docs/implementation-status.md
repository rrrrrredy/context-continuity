# 实现状态

本文件只记录可验证实现，不把协议测试写成产品效果。

## 已实现

- Codex 插件 manifest、默认 Hooks、Skill 和本地 stdio MCP；公共 MCP 为八个有界工具及一个只读 Skill 资源兜底。
- 每任务 append-only 哈希链 ledger、严格 root/event allowlist、generation 并发控制、原子写、单任务锁和读前 8 MiB 限制。
- 最小状态项、来源、有效性、类别、覆盖关系、冲突与验证状态。
- `PreCompact` 快照、`PostCompact` 配对、compact/resume 核验及四级恢复分类。
- `UserPromptSubmit` 增量信号、clear 失效、subagent capsule 与候选式导入。
- 每条非空提示最多保存 512 字符脱敏片段、哈希、长度和信号，仅作来源关联和风险审计。
- 用户权威状态使用完整、可读、generation-bound 的第二次精确确认；自然语言、引用、否定和 Agent 改写不能直接铸造用户权威。
- off/on/reset/delete 全部使用明确请求、一次性 challenge 和第二条精确用户确认；delete 同时删除精确任务及其匹配归档。
- challenge 和确认短语同时出现在 MCP 文本与结构化结果中；同一未过期请求可安全重发，旧 challenge 立即失效，Agent 无需也不得跨任务扫描日志或插件数据。
- 每次 compact、resume 和 SessionEnd 都让旧 next_action 变 stale；恢复投影、持久状态和只读 Guard view 保持一致，只有 verified next_action 会成为 Guard 的开放承诺。
- reset/clear 开始新有效状态时清空旧 snapshot、compaction、restore 与 subagent 生命周期指针；审计历史仍留在 ledger 或归档中。
- 没有压缩快照的 resume 会对比 SessionEnd 与当前工作区指纹；tracked/untracked 有界内容变化会让依赖工作区的完成、证据和下一步陈旧。
- 已消费的用户提示事件不能重复授权；外部 handoff 和子 Agent 输出保持 candidate-only。
- 默认脱敏、三快照保留、有界 MCP 输入/输出、有界 handoff、Hook fail-open 和 continuity corruption fail-closed；成功与错误 MCP 结果都受 24 KiB 线预算约束。
- 宿主 session/turn 标识落盘前转为不可逆哈希；任务、archive、snapshot、lock 与删除路径拒绝符号链接和 Windows junction 越界。
- 公共 MCP 不暴露外部 intent 绑定、provider token 或 verified-evidence 写入；相关内部适配协议只有测试边界，不能由模型调用。
- 一份与 Execution Fidelity Guard v0.1.0 对齐的七字段只读 `execution_guard_view`；Guard 当前不消费它，双方没有 live bridge。
- 30 例协议评估资产、87 项自动化测试和仓库自检。
- 一次独立安装态用户流程已覆盖普通静默、Protect、精确确认落盘、Show 和 Off；最终候选全部首次成功，但显式保护回合仍观察到重复 Skill resource 读取和 30 至 60 秒级等待。
- 真实 Codex 手动/连续自动压缩、安装缓存、宿主发现与安装包 E2E 是 v0.1.0 发布门槛；最终收据按源码树和插件包 SHA-256 绑定，避免拿旧缓存或旧结果验收新代码。

## 刻意未实现

完整 transcript 备份、向量检索、云同步、长期记忆提升、任务规划、工具权限、执行拦截、自动发布、后台清理、UI dashboard 和其他 Agent 适配器。

## 协议存在但未对外启用

- Intent Loop provider 绑定：核心有版本/hash/碰撞测试，但没有模型不可见的安全适配身份，因此公共 MCP 无此工具。
- Verified evidence provider：核心可接受隔离服务凭据，但公共 MCP 不能接收或转发模型提供的 token。
- Continuity-to-Guard snapshot：shape 已冻结并测试，Guard 0.1.0 不加载。

## 尚需真实验证

- 30 任务真实三臂效果与预注册门槛。
- 真实跨进程 `thread/resume` 和真实父子 Agent 往返交接。
- 独立用户长期 dogfood、升级兼容、macOS/Linux 与不同 Codex 版本矩阵。
- Claude Code、Cursor、Gemini CLI 和 WorkBuddy/CodeBuddy 适配器。

生命周期收据、安装包 E2E、宿主只读调用和协议 fixture 都是实现证据，不是“减少返工或目标漂移”的效果结论。
