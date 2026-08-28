# 使用与安装

## 普通用户流程

1. 运行 `codex plugin marketplace add rrrrrredy/context-continuity --ref v0.1.0`。
2. 运行 `codex plugin add context-continuity@context-continuity`，或在桌面端从该 marketplace 安装并启用 Context Continuity。
3. 打开 `/hooks`，检查待运行命令和来源，只信任当前精确 Hook 定义。
4. 正常工作。普通回合插件保持静默，用户无需维护摘要。
5. 若要让插件权威保存当前目标和约束，可以说“保护当前目标和约束”。Agent 会展示按 claim 分段的可读确认消息；检查 statement、scope、status 和覆盖关系后原样发送一次即可。来源事件与提案哈希单列在末尾，不要求用户阅读紧凑 JSON。该确认绑定当前 task_ref 和 generation，不能被转述、引用或旧消息替代。
6. 发生压缩或重新进入任务时，Agent 从 ledger 恢复有效不变量，并重新推导旧的下一步：
   - 只有可自动修复的差异：修复后继续；
   - 只有低风险不确定性：带标记做只读或可逆工作；
   - 可能改变目标、范围、授权、工作对象、发布、删除、外发或不可逆动作：先问一个必要问题。
7. 对恢复结果有异议时，明确指出“哪条恢复错误、正确内容是什么”。Agent 生成一份可读纠正提案；用户原样确认后，插件写入 correction 和覆盖关系，不改写历史。

仓库包含 Git marketplace 清单。安装会改变 Codex 插件状态；Hooks 必须由用户检查并明确选择是否信任。

## 为什么需要第二次精确确认

Hook 只观察到用户输入的哈希、长度、信号和最多 512 字符脱敏片段；模型可能误读、遗漏或改写自然语言。因此原始提示只能触发候选状态，不能证明模型生成的结构化目标、约束或纠正与用户原意完全相同。

`continuity_prepare_confirmation` 不写状态，只返回一条完整、可读、绑定 generation 的确认消息。用户第二次原样发送后，新 Hook 事件才能作为该结构化提案的用户权威来源。插件只在用户主动保护状态或连续性风险会影响高风险动作时走这一步，不要求每轮确认。

确认类工具只需提交 `id`、`kind`、`statement` 及必要的范围、状态或覆盖字段；插件会在工具边界补上固定的 `user + verified`。这不会绕过二次确认：任意提示、转述或旧 generation 仍会被拒绝。Agent 推断仍必须显式提交来源、置信度和非 verified 的验证状态。

## 查看与控制

用户可以直接要求 Agent：

- “显示当前连续性状态”：读取有效项、来源、验证状态、缺口和当前 generation。
- “保护当前目标和约束”：准备并确认最小用户权威状态。
- “重建连续性状态”：核验 ledger 哈希链并重建投影，不改写语义。
- “导出最小交接”：生成有界、带内容哈希的 capsule；导入方只能先作为候选。
- “关闭/开启这个任务的连续性保护”：第一条请求只生成一次性 challenge，第二条必须原样确认。
- “重置/删除这个任务的连续性状态”：同样需要两阶段精确确认。

challenge 与确认短语同时出现在 MCP 文本和结构化结果中。若宿主丢失首次 prepare 结果，Agent 可以用同一条仍未过期的来源事件重发相同 prepare，旧 challenge 随即失效；不得搜索日志、transcript、缓存、其他任务、插件数据目录或整个 `CODEX_HOME` 来恢复 token。

第二阶段必须把 prepare 返回的完整 `challenge_token` 原样传回，包括字面量 `challenge:` 前缀；只传 UUID 会被拒绝。

`plugins/context-continuity/src/cli.mjs` 是诊断入口，不是普通用户的主要界面。CLI 的 reset/delete/off/on 要求第二个独立的 `confirm_task_ref`，不会把目标参数自动当成确认；reset 将旧目录移入本插件 archive 后建立新状态，delete 删除精确任务目录及其精确匹配的归档。

## 自动工作的范围

- `UserPromptSubmit` 对每条非空提示记录有界、脱敏的来源信号，并向 Agent 提供短 task_ref/source_event_id 绑定；不生成摘要、不调用额外模型。该事件本身不能铸造用户权威状态。
- `PreCompact` 原子保存最小状态；`PostCompact` 记录压缩完成；`SessionStart(source: compact)` 在下一次模型请求前核验并注入恢复投影。
- `SessionStart(source: resume)` 核验恢复状态；`clear` 保留审计历史但使旧有效状态失效。
- 每个 compact、resume 和 SessionEnd 边界都会使旧 `next_action` 变为 stale；Agent 必须结合当前状态重新推导，不能直接执行旧动作。
- `SubagentStart` 注入按优先级裁剪、默认不超过 800 tokens 的 handoff；`SubagentStop` 返回只作未验证候选。
- Hook 或 MCP 故障不让宿主失去基本工作能力。失败后必须把连续性保证视为缺失。
- Hook 未启用或未被信任时，插件不能可靠获得 task_ref、用户来源和压缩生命周期；Agent 不能猜测 `current`。
- off 后生命周期与状态写入为零；只读查看和 export 仍可用。重新开启也需要两阶段确认。

## MCP 公共边界

0.1.0 的公共 Codex MCP 暴露八个工具：get state、prepare confirmation、record state、correct state、snapshot、export handoff、import handoff 和 manage state。它不暴露外部 intent provider 绑定，不接受模型提供的 provider token，也不能让模型把自己的工具判断写成 `verified_evidence`。

外部 Intent Loop 和证据 provider 只有内部协议与测试边界，尚无安全的公开调用身份通道，所以 0.1.0 不宣称实时集成。

## 数据位置与卸载

当前已验证的 Codex 安装环境使用 `CODEX_HOME/plugin-data/context-continuity/v1`，让 Hook 与 MCP 进程共享任务状态；兼容宿主仍可使用 `PLUGIN_DATA` 或显式 `CONTEXT_CONTINUITY_DATA_DIR`。插件默认不复制 transcript、不写长期记忆、不把宿主摘要当事实源。

```powershell
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
```

卸载不会静默删除任务 ledger。若要彻底清除，应先按任务调用 delete，或在核验精确路径后另行删除该插件数据目录。插件删除不会触碰原始对话、项目、宿主记忆或其他插件。

安装与 Hook 信任机制以当前官方 [Codex 插件文档](https://developers.openai.com/plugins/build/plugins) 与 [Hooks 文档](https://learn.chatgpt.com/docs/hooks) 为准。
