# 使用与安装

## 最简单的理解

它像一张由插件自动维护的“任务防忘卡”。Agent 遇到上下文压缩、重新进入任务或
交接时，会先核对目标、硬约束、用户纠正、当前工作对象和完成状态，再重新判断下一步。

普通回合不用手工写摘要。插件只在连续性风险可能改变高风险动作时打扰用户。

## Codex 用户流程

### 安装

macOS、Linux 和 Windows 使用同样的命令：

```sh
codex plugin marketplace add rrrrrredy/context-continuity --ref v0.2.0-beta.2
codex plugin add context-continuity@context-continuity
```

随后重启或重新进入任务，打开 `/hooks`，检查实际安装缓存中的命令，只信任确认过
的精确定义。安装会改变 Codex 插件状态，Hook 信任始终由用户决定。

安装成功时，`codex plugin list --json` 能找到
`context-continuity@context-continuity`，`/hooks` 能看到并信任七组 Hook：
`SessionStart`、`UserPromptSubmit`、`PreCompact`、`PostCompact`、
`SubagentStart`、`SubagentStop` 和 `SessionEnd`。任何 `node not found`
都表示保护尚未生效。再按根 README 的 60 秒无文件修改测试完成一次真实状态确认。

### 日常使用

1. 正常工作。普通提示只做确定性信号检查，不生成摘要，也不额外调用模型。
2. 需要权威保存时，说“保护当前目标和约束”。
3. Agent 会列出准备保存的目标、约束等内容，并给出一段精确确认文本。
4. 内容正确就把确认文本原样发回；不正确就直接指出哪一条要改。
5. 压缩或恢复后，插件会核对仍有效的内容，并要求重新判断旧的下一步。
6. 恢复有误时，说“这条恢复错了，正确内容是……”。确认后会保留旧记录和更正
   关系，方便审计。

可直接使用的说法：

- “显示当前连续性状态。”
- “保护当前目标和约束。”
- “重建连续性状态。”
- “导出最小交接。”
- “关闭/开启这个任务的连续性保护。”
- “重置/删除这个任务的连续性状态。”

| 操作 | 会发生什么 | 不会发生什么 |
| --- | --- | --- |
| 关闭 | 停止为该任务新增自动连续性写入；旧状态仍可查看和导出 | 不删除 ledger |
| 重置 | 清空当前有效投影并开始新 generation，同时保留追加式历史；诊断 CLI 会归档旧任务目录 | 不删除项目文件或原始对话 |
| 删除 | 删除当前任务的 Continuity 状态及匹配的 Continuity 归档 | 不删除项目文件、原始对话、宿主记忆或其他任务 |

关闭、开启、重置和删除都要确认两次。第二次必须把插件显示的完整确认文本原样发回。
这段文本只对当前任务、当前 generation 和当前一次操作有效，旧确认不能复用。

### 自动生命周期

- `UserPromptSubmit` 记录哈希、长度和信号；仅风险信号保留脱敏片段。
- `PreCompact` 原子保存最小状态。
- `PostCompact` 记录边界完成。
- `SessionStart(source: compact)` 在下一次模型请求前核验并注入恢复投影。
- `SessionStart(source: resume)` 核验恢复状态；`clear` 使旧有效状态失效。
- `SubagentStart` 注入有界 handoff；`SubagentStop` 只产生未验证候选。
- compact、resume、handoff 和 SessionEnd 都会让旧 `next_action` 失效。

Hook 未启用、未信任或运行失败时，Codex 继续工作，但该边界不再有连续性保证。

## DeepSeek Harness 用户流程

要求 DeepSeek Harness `0.1.1-rc.2`、Node.js 20 或更新版本与 `pnpm`。
`<profile>` 是 `$DSH_HOME/profiles/<name>` 下一个可运行组合的名字。可使用已有
profile，也可给预览测试单独取名；官方的首次
`dsh plugin --profile <name> add ...` 会初始化它。创建和加载规则见
[官方 profile/plugin 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。

```sh
dsh plugin --profile <profile> add github:rrrrrredy/context-continuity#v0.2.0-beta.2
dsh --profile <profile> --dump-config
```

输出必须出现 `id` 与 `name` 都为 `context-continuity` 的 layer/service。
随后启动 profile：

```sh
dsh --profile <profile>
```

启动后可以直接说：

- “显示当前连续性状态。”
- “保护当前目标和约束。”
- “这条恢复错了，正确内容是……”
- “删除这个任务的连续性状态。”

profile 运行时，插件使用相同状态模型和八个操作：

- `agent/inbox/inserted` 绑定可信用户来源；
- 观察到 `compaction/start` 后，把最小 ledger 快照排入当前会话队列；
- `compaction/end` 成功后才恢复；
- `agent/pre-step` 在当前消息之前注入有界投影；
- resume 和父子 Agent 交接进入相同核验闭环。

DSH 工具参数不能自行提供 task、cwd 或 user source；适配器从宿主会话绑定。DSH
session log 不写入插件私有未知事件。

当前已验证发布版 Host API 生命周期和隔离安装包。完整 DSH CLI profile add 以及
DSH 引擎自动触发压缩尚无本地发布收据，详见
[能力记录](platform/deepseek-harness-capability-2026-08-31.md)。

## 为什么需要第二次精确确认

Hook 或 DSH 观察点只能证明“用户发过一条消息”，不能证明模型生成的结构化目标与
用户原意完全相同。第一条消息只能触发候选；第二条精确确认把完整、可读、绑定当前
task/generation 的提案升级为用户权威状态。

Agent 推断必须带来源、置信度和非 verified 状态。任意转述、引用、旧消息或模型生成
的 source ID 都不能代替确认。

## 恢复判断

- 可靠证据足以恢复：自动修复并继续。
- 不影响当前动作的低风险不确定性：标记后继续只读或可逆工作。
- 可能改变目标、范围、授权、工作对象、发布、删除、外发或不可逆动作：暂停相关动作，
  只问一个必要问题。
- 宿主摘要与 ledger 不一致：摘要只作不可信缓存。

| 故障 | 用户看到的状态 | 处置 |
| --- | --- | --- |
| Node 或 Hook 启动失败 | Codex 可继续运行，但该边界没有连续性保护 | 确认 Node.js 20+ 在宿主进程 PATH 中，重启 Codex，检查 `/hooks`，再跑 60 秒 smoke test |
| 恢复内容错误 | 受影响的高风险动作应暂停 | 直接说明正确内容，检查纠正提案，再发送第二次精确确认 |
| ledger 哈希损坏 | 不恢复，也不继续写入损坏状态 | 先保留损坏数据；`rebuild` 只能核验并重建有效 ledger 的投影，不能修复哈希不一致 |
| DSH layer 缺失 | DSH 继续运行，但适配器未生效 | 重新加入固定 tag，重启 profile，并用 `dsh --profile <profile> --dump-config` 核验 |

ledger 损坏时，如果精确 task_ref 与实际数据目录都已独立确认，可使用安装包内的诊断
CLI 做按任务删除；`task_ref` 和 `confirm_task_ref` 必须完全相同。它会删除该任务
及匹配的 Continuity 归档。任一路径或引用不确定时，保持数据原样并提交 issue，不要
猜测目录、改写 ledger 或删除整个插件数据根。

## 公共接口边界

Codex MCP 和 DSH native tools 暴露同一组八个有界操作：get state、prepare
confirmation、record state、correct state、snapshot、export handoff、import
handoff 和 manage state。

公共接口不接受 intent provider token 或 verified-evidence token，也不能让模型把
自身判断写成 `verified_evidence`。

用最简单的话区分：Context Continuity 负责在有损转换前后保存、搬运和核验任务状态；
Execution Fidelity Guard 负责根据当前状态判断待执行动作与完成声明。两者只有冻结的
只读协议边界，没有实时桥接。Continuity 的 DSH 适配器面向 Harness
`0.1.1-rc.2`，另一个 Guard DSH 适配器面向 `0.1.2-alpha.2`，不要把它们当成
能在同一 profile 中自动协同的一对组件。

## 数据位置与卸载

Codex 默认：

```text
$CODEX_HOME/plugin-data/context-continuity/v1
```

DeepSeek Harness 默认：

```text
$DSH_HOME/plugin-data/context-continuity/v1
```

隔离测试或托管运行可设置 `CONTEXT_CONTINUITY_DATA_DIR`。插件默认不复制
transcript、不写长期记忆，也不把宿主摘要当事实源。

Codex 卸载：

```sh
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
```

DSH 卸载：

```sh
dsh plugin --profile <profile> remove context-continuity
```

卸载不静默删除 ledger。若需彻底清除，先在仍能运行插件时说“删除这个任务的连续性
状态”，把第二次精确确认原样发回，再用“显示当前连续性状态”确认该任务已经消失。
只有插件无法运行时才手工处理目录。

下面的命令只打印默认目录候选，不保证是插件运行时实际使用的路径。
`CONTEXT_CONTINUITY_DATA_DIR`、自定义 `CODEX_HOME` / `DSH_HOME`、Desktop
进程环境和安装缓存推导都可能改变实际位置。删除前必须从运行时配置或已检查的安装命令
独立核对实际目录，不能直接拿候选路径执行删除。

macOS / Linux 打印默认目录候选：

```sh
printf '%s\n' "${CODEX_HOME:-$HOME/.codex}/plugin-data/context-continuity/v1"
printf '%s\n' "${DSH_HOME:-$HOME/.dsh}/plugin-data/context-continuity/v1"
```

Windows PowerShell 打印默认目录候选：

```powershell
$ccCodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
Join-Path $ccCodexRoot "plugin-data\context-continuity\v1"
$ccDshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
Join-Path $ccDshRoot "plugin-data\context-continuity\v1"
```

插件只管理自己的 `plugin-data/context-continuity`，不会触碰原始对话、项目文件、
宿主记忆或其他插件。

Codex 的安装与 Hook 信任机制以当前官方
[插件文档](https://developers.openai.com/plugins/build/plugins)和
[Hooks 文档](https://learn.chatgpt.com/docs/hooks)为准。
