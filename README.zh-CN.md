# Context Continuity 上下文连续性

[English](README.md) · [发布证据](docs/release-readiness.md) · [隐私与删除](docs/privacy.md)

Context Continuity 会保存长期 Agent 任务中最不能丢的少量信息，并在压缩、恢复或
交接后核对它们，让 Agent 从正确的位置继续。

Codex 和 DeepSeek Harness 共用同一套核心、状态格式和恢复规则，支持 Windows、
macOS 与 Linux，不维护容易分叉的 Mac 特供版。

## 它解决什么

Agent 在压缩后可能还能流畅回答，却已经忘了真正目标、硬约束、用户纠正、决定理由、
当前文件或版本，也可能把旧的下一步当成仍然有效。宿主摘要和记忆仍可参考，但不应
直接成为任务事实。

插件保存一份有界的任务状态投影，每条内容带来源、时间、有效状态、覆盖关系、冲突和
验证状态。它不会复制完整对话，不做长期记忆，不接管规划，也不替宿主授予权限。

## 当前状态

`0.2.0-beta.2` 是发布候选。只有同名公开 tag 和 GitHub prerelease 已存在后，
它才成为固定公开预发行版，下面的安装命令也才有效。

| 宿主 / 平台 | 支持程度 |
| --- | --- |
| Codex | Beta 发布候选；测试 Windows 主机已有真实手动压缩和连续自动压缩生命周期收据 |
| DeepSeek Harness | 开发者预览候选，固定兼容 `0.1.1-rc.2`；已验证发布版 Host API 生命周期和隔离安装包 |
| Windows | 完整测试矩阵和真实 Codex 生命周期证据 |
| macOS | 发布门槛：核心、Hook、MCP、打包、评估和 DSH 适配测试必须在 `macos-latest` 通过；真实 Mac Codex 自动压缩尚未验证 |
| Linux | 发布门槛：核心、Hook、MCP、打包、评估和 DSH 适配测试必须在 `ubuntu-latest` 通过 |

三臂真实任务效果评估尚未完成。当前证据可以说明机制和失败边界可验证，还不能宣称已
量化减少返工或目标漂移。

## 安装到 Codex

要求：支持插件与 Hooks 的 Codex、Node.js 20 或更新版本，并能检查本地 Hook。

macOS、Linux 和 Windows 使用同样的命令：

```sh
codex plugin marketplace add rrrrrredy/context-continuity --ref v0.2.0-beta.2
codex plugin add context-continuity@context-continuity
```

安装后：

1. 重启或重新进入 Codex 任务。
2. 打开 `/hooks`。
3. 检查安装缓存中的精确命令，只信任确认过的定义。
4. 正常工作。普通回合保持静默，也不会额外调用模型。

检查是否安装成功：

```sh
codex plugin list --json
```

`codex plugin list --json` 的输出里必须能找到
`context-continuity@context-continuity`。在 `/hooks` 中核对并信任安装缓存里的
`SessionStart`、`UserPromptSubmit`、`PreCompact`、`PostCompact`、
`SubagentStart`、`SubagentStop` 和 `SessionEnd` 七组 Hook。遇到
`node not found` 就说明保护尚未生效。

在一次可丢弃的任务里做 60 秒无文件修改测试：

1. 说：“保护这个目标：只在本地完成测试。硬约束：不要修改文件。”
2. 检查 Agent 给出的状态提案，把它要求的精确确认文本原样发回。
3. 说：“显示当前连续性状态。”
4. 只有目标和约束都显示为 `verified`，且没有文件被修改，才算安装成功。

Mac 的证据边界见
[macOS 支持说明](docs/platform/macos-support-2026-08-31.md)。

## 安装到 DeepSeek Harness

要求：DeepSeek Harness `0.1.1-rc.2`、Node.js 20 或更新版本，以及 `pnpm`。
`<profile>` 是 `$DSH_HOME/profiles/<name>` 下一个可运行组合的名字。可使用已有
profile，也可给预览测试单独取名；官方的首次
`dsh plugin --profile <name> add ...` 会初始化它。详见
[官方 profile/plugin 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。

```sh
dsh plugin --profile <profile> add github:rrrrrredy/context-continuity#v0.2.0-beta.2
dsh --profile <profile> --dump-config
```

配置输出必须出现 `id` 与 `name` 都为 `context-continuity` 的 layer/service。
随后这样启动 profile：

```sh
dsh --profile <profile>
```

profile 启动后也可以使用上面的自然语言测试。

如果安装时该 profile 已在运行，先重启它的进程，再做上面的测试。DSH 的 bundle
patch 会加入适配器，不需要另一套状态格式。
详见[适配器使用说明](adapters/deepseek-harness/README.md)和
[能力核验记录](docs/platform/deepseek-harness-capability-2026-08-31.md)。

Context Continuity 和 Execution Fidelity Guard 是两个独立产品：

| 产品 | 职责 |
| --- | --- |
| Context Continuity | 在有损上下文转换前后保存并核验任务状态 |
| Execution Fidelity Guard | 根据当前状态判断待执行动作与完成声明 |

两者目前没有实时桥接。本仓库的 DSH 适配器面向 Harness `0.1.1-rc.2`；另一个
Guard DSH 适配器面向 `0.1.2-alpha.2`。不要把它们当成能在同一 profile 中自动
协同的一对组件。

## 用户会看到什么

大部分时间什么都看不到。

发生有损上下文转换时，插件会：

1. 只保存当前仍有效的任务不变量；
2. 记录这次转换是否完成；
3. 在下一次模型步骤前恢复有界状态；
4. 保留未解决冲突，不强行拼成共识；
5. 把旧 `next_action` 标成失效，要求重新推导。

可靠证据足以修复差异时自动恢复；不影响当前动作的低风险不确定性会被标记，并允许
继续只读或可逆工作；可能改变目标、范围、授权、工作对象、发布、删除或其他不可逆
动作时，只询问一个必要问题。

技术小白可以直接说：

- “显示当前连续性状态。”
- “保护当前目标和约束。”
- “这条恢复错了，正确内容是……”
- “导出最小交接。”
- “关闭这个任务的连续性保护。”
- “删除这个任务的连续性状态。”

| 操作 | 确切效果 |
| --- | --- |
| 关闭 | 停止为该任务新增自动连续性写入；旧状态仍可查看和导出 |
| 重置 | 清空当前有效投影并开始新 generation，同时保留追加式历史；诊断 CLI 会归档旧任务目录 |
| 删除 | 只删除当前任务的 Continuity 状态及对应 Continuity 归档，不删除项目文件、原始对话、宿主记忆或其他任务 |

关闭、开启、重置和删除都要求可读的第二次精确确认。
需要写入用户权威状态时，插件会给出一段可读的精确确认内容。用户检查后原样确认，
模型转述或旧消息不能代替确认。

## 数据与保证边界

- 本地、按任务隔离的追加式 ledger，带哈希链核验。
- 最多保留最近三个压缩快照。
- 恢复投影默认 800 tokens，上限 1,500 tokens。
- 不复制完整 transcript、隐藏推理或完整工具输出。
- 平台摘要、检索结果、handoff 和子 Agent 输出只作为缓存或候选。
- 每次有损转换都让旧动作游标失效。
- Hook 或适配器故障时宿主继续运行，但该边界没有连续性保证。
- ledger 损坏时不会恢复或继续写入。
- 与其他插件的协议是只读、单一状态所有者；同时安装不等于自动集成。

Codex 默认数据目录是
`$CODEX_HOME/plugin-data/context-continuity/v1`；DSH 默认是
`$DSH_HOME/plugin-data/context-continuity/v1`。隔离测试或托管环境可显式设置
`CONTEXT_CONTINUITY_DATA_DIR`。

| 故障 | 安全处置 |
| --- | --- |
| Node 或 Hook 启动失败 | 保护未生效。把 Node.js 20+ 加入宿主进程 PATH，重启，检查 `/hooks`，再跑一次 smoke test |
| 恢复内容错误 | 提交纠正并做第二次精确确认；纠正生效前暂停受影响的高风险动作 |
| ledger 哈希损坏 | 保留损坏数据。`rebuild` 只能核验并重建有效 ledger 的投影，不能修复哈希不一致；只有独立确认精确 task_ref 和实际数据目录后，才使用按任务诊断删除 |
| DSH layer 缺失 | 保护未生效。重新加入固定 tag，重启 profile，再用 `--dump-config` 核验 |

[使用指南](docs/usage.md#数据位置与卸载)中的默认路径命令只打印候选值，不保证是
运行时实际路径。手工删除前必须核对覆盖变量和安装缓存推导。

## 已有证据

仓库发布门槛包含：

- 91 个核心测试和 7 个 DSH 适配/集成测试；
- 真实 Codex 手动压缩与连续自动压缩收据；
- 字节一致的安装缓存生命周期收据；
- 安装态宿主只读发现收据；
- DSH 隔离 tarball 安装收据；
- DSH 发布版 Host API 生命周期收据；
- Hook、MCP、仓库、协议评估、依赖审计与多系统 CI。

收据绑定当前源码树和插件包 SHA-256。协议 fixture 的结果不会被包装成产品效果。

## 本地开发

```sh
npm ci
npm test
npm run test:dsh
npm run smoke:hooks
npm run smoke:mcp
npm run eval:protocol
npm run verify:dsh:package
npm run verify:dsh:lifecycle
npm run validate
npm audit --audit-level=high
```

`plugins/context-continuity/` 是 Codex 安装包；根包同时包含 DeepSeek Harness
适配器和 bundle patch。

## 更新与卸载

Codex 升级到 `<new-tag>`，本地 ledger 会保留：

```sh
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
codex plugin marketplace add rrrrrredy/context-continuity --ref <new-tag>
codex plugin add context-continuity@context-continuity
```

DeepSeek Harness 升级到 `<new-tag>`：

```sh
dsh plugin --profile <profile> remove context-continuity
dsh plugin --profile <profile> add github:rrrrrredy/context-continuity#<new-tag>
```

只卸载 Codex，不删除 ledger：

```sh
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
```

只卸载 DSH，不删除 ledger：

```sh
dsh plugin --profile <profile> remove context-continuity
```

卸载不会悄悄删掉任务 ledger。需要彻底清理时，先说“删除这个任务的连续性状态”，
把第二次精确确认原样发回，并核对该任务状态已经消失。只有插件无法运行时才手工
定位运行时配置和安装缓存推导出的实际数据目录；不要把默认路径候选当成精确值。
检查目标后再删除 `plugin-data/context-continuity`；详见
[隐私与删除](docs/privacy.md)。

## 许可证

Apache License 2.0，允许商业和私有使用，具体以许可证条款为准。可在
[GitHub Issues](https://github.com/rrrrrredy/context-continuity/issues)
提交可复现问题。
