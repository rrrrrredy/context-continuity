# 使用与安装

## 最简单的理解

它像一张由插件自动维护的“任务防忘卡”。Agent 遇到上下文压缩、重新进入任务或
交接时，会先核对目标、硬约束、用户纠正、当前工作对象和完成状态，再重新判断下一步。

普通回合不用手工写摘要。插件只在连续性风险可能改变高风险动作时打扰用户。

## Codex 用户流程

### 安装

macOS、Linux 和 Windows 使用同样的命令：

```sh
codex plugin marketplace add rrrrrredy/context-continuity --ref v0.2.0-beta.1
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

关闭、开启、重置和删除都要确认两次。第二次必须把插件显示的完整确认文本原样发回；
这段文本只能用于当前任务和当前状态，旧确认不能复用。

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
把 `<profile>` 换成真实 profile：

```sh
dsh plugin --profile <profile> add github:rrrrrredy/context-continuity#v0.2.0-beta.1
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
- ledger 损坏：不恢复，也不继续写入该损坏状态。
- 宿主摘要与 ledger 不一致：摘要只作不可信缓存。

## 公共接口边界

Codex MCP 和 DSH native tools 暴露同一组八个有界操作：get state、prepare
confirmation、record state、correct state、snapshot、export handoff、import
handoff 和 manage state。

公共接口不接受 intent provider token 或 verified-evidence token，也不能让模型把
自身判断写成 `verified_evidence`。Intent Loop 与 Execution Fidelity Guard 只有
冻结的只读边界，`0.2.0-beta.1` 不宣称实时三插件集成。

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
只有插件无法运行时才手工处理目录；先打印并核对解析后的精确路径，不要直接复制一个
假定路径去删除。

macOS / Linux 查看默认解析路径：

```sh
printf '%s\n' "${CODEX_HOME:-$HOME/.codex}/plugin-data/context-continuity/v1"
printf '%s\n' "${DSH_HOME:-$HOME/.dsh}/plugin-data/context-continuity/v1"
```

Windows PowerShell：

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
