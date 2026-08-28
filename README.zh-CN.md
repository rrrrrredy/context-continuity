# Context Continuity 上下文连续性

Context Continuity 是一个本地优先的 Codex 插件。它帮助长期任务在上下文压缩、
会话恢复、clear 或子 Agent 交接后，仍沿着同一个目标、约束、用户纠正、工作对象、
已验证进度和未解决分歧继续。

它不是聊天备份、完整记忆、用户画像、任务管理器、权限系统或第二套 Harness。

## 为什么需要它

平台摘要可以读起来很顺，却悄悄漏掉用户纠正、复活旧决定、抹平分歧，或者让 Agent
在错误文件版本上继续。插件保存一份很小、带来源的任务投影，并在有损上下文转换前后
核验。宿主摘要和外部交接只作为候选，不作为事实来源。

## 当前状态

`0.1.0` 是可选择安装的 Codex 公开 Beta：

- 已在 Windows 的 `codex-cli 0.150.0-alpha.8` 核验；
- 源码包和安装缓存包都必须通过真实手动压缩与连续自动压缩发布门槛；
- Hooks、MCP、Skill 兜底、持久化、脱敏、有界响应、精确用户确认、单任务删除和
  卸载路径都有自动化或安装包检查；
- 30 例评估协议已经冻结，但真实任务三臂效果评估尚未完成，所以本 Beta 不宣称
  已测得返工、目标漂移或恢复时间下降；
- 一次独立安装态短流程已通过普通静默、Protect、精确落盘、Show 和 Off；它也
  观察到重复 Skill 读取与 30 至 60 秒级显式保护回合，因此当前仍定位为可选 Beta。

## 从 GitHub 安装

要求：支持插件的 Codex、Node.js 20 或更新版本，以及查看本地 Hooks 的权限。

```powershell
codex plugin marketplace add rrrrrredy/context-continuity --ref v0.1.0
codex plugin add context-continuity@context-continuity
```

安装后打开 `/hooks`，检查命令，只信任当前精确 Hook 定义。然后开启新任务或重新
进入要保护的任务即可。用户不需要手工维护摘要。

```powershell
codex plugin list --json
codex mcp get context_continuity --json
```

MCP 命名空间使用下划线，产品名和插件名使用连字符。

## 用户什么时候会感受到它

- 普通工作：不刷状态，不调用额外模型。
- 当稳定目标、约束、纠正或其他关键主张需要用户权威时：Agent 展示一条可读、
  绑定当前 generation 的完整提案，请用户原样发送。只在用户明确要求保护状态，
  或连续性风险会影响高风险动作时出现，不会每轮确认。
- 压缩前：Hook 在本地写入最小快照。
- 压缩或恢复后：从 ledger 恢复已验证不变量；旧的下一步总是先标记为陈旧，结合
  当前目标、约束、工作对象和证据重新推导。低风险不确定性带标记继续；可能改变
  范围、授权、发布、删除、外发或其他不可逆动作时，只问一个必要问题。
- 用户纠正：确认后的新项覆盖旧项，但保留来源、分歧和覆盖关系。

可以直接对 Agent 说：

- “显示当前连续性状态。”
- “保护当前目标和约束。”
- “刚才恢复的目标错了，正确的是……”
- “导出这个子任务的最小交接。”
- “关闭这个任务的连续性保护。”
- “删除这个任务的连续性状态。”

off、on、reset 和 delete 都需要一条明确匹配的用户请求，再要求用户原样发送一次性
确认短语。诊断 CLI 则要求两次提供完全相同、带命名空间的 `task_ref`。插件拒绝
`current` 之类猜测别名。
如果 prepare 结果丢失，同一条尚未过期的请求可以重发并生成新的 challenge，旧值立即
失效；Agent 不得扫描日志、transcript、缓存、其他任务、插件数据或整个 `CODEX_HOME`
来恢复 token。

## 数据和保证边界

- 每任务一个严格校验、追加式、带哈希链的 ledger；并发写入不使用最后写入覆盖。
- 来源、时间、有效性、权威、验证、覆盖、分歧和不确定性保持显式。
- 普通自然语言不能直接生成规范化的“用户权威状态”。用户必须对完整、可读提案做
  第二次精确确认；Agent 改写只能作为未验证推断。
- 每条非空提示最多保存 512 字符脱敏片段及哈希和长度，用于来源关联与风险审计，
  不是语义证明；不复制完整 transcript。
- 每次有损转换都让旧下一步失效，必须重新推导；高风险动作不确定时先问用户。
- 给执行防偏插件的只读视图只导出已验证的下一步；stale 或 unverified 动作保留审计
  记录，但不再作为可执行承诺。
- 子 Agent 结果和外部 handoff 只作为候选。
- 工作区核验包括有界的 tracked/untracked 内容哈希，不只看 Git HEAD 或 dirty 标记。
- 公开 MCP 只有八个有界工具，不暴露 provider 凭据，也不能让模型自行铸造已验证证据。
  跨产品协议已对齐，但 0.1.0 不宣称实时集成。
- 所有 MCP 成功与错误响应都限制在 24 KiB 内；宿主 session/turn 标识只保存不可逆哈希。
- 任务、快照、归档、锁和删除路径会拒绝符号链接与 Windows junction，避免越出插件
  数据根读写。
- 默认恢复上下文不超过约 800 tokens，硬上限 1500；无网络调用、遥测、向量库或云服务。
- Hook 故障时 Codex 继续工作，但该次转换不再拥有连续性保证；ledger 损坏只让连续性
  恢复拒绝继续，不阻断宿主的低风险工作。

默认数据位于 `CODEX_HOME/plugin-data/context-continuity/v1`，按任务哈希隔离并只保留
最近三个快照。详见[完整调研与 PRD](docs/prd.md)、[产品契约](docs/product-contract.md)、
[三产品集成契约](docs/integration-contracts.md)、[隐私与删除](docs/privacy.md)和
[发布证据](docs/release-readiness.md)。

## 卸载

```powershell
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
```

卸载不会悄悄删除任务 ledger。若要彻底删除数据，应先让插件按任务删除，或在核验准确
路径后另行删除 `CODEX_HOME/plugin-data/context-continuity`。

本项目使用 Apache License 2.0：允许商业和私有使用，包含明确专利授权，并要求保留
许可证声明。
