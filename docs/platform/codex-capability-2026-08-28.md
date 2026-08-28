# Codex 能力核验基线

核验日期：2026-08-28
本地基线：codex-cli 0.150.0-alpha.8

## 已确认的官方能力

| 能力 | 官方状态 | 本插件用法 |
| --- | --- | --- |
| 插件打包 Skills、MCP、Hooks | 原生支持 | plugin.json、.mcp.json、hooks.json |
| PreCompact | 原生事件，可在 manual/auto 压缩前运行 | 原子写最小快照 |
| PostCompact | 原生事件 | 记录转换完成及快照配对 |
| SessionStart(source: compact) | 原生事件，在 compact 后下一次模型请求前运行 | 核验并注入最小恢复上下文 |
| SessionStart(source: resume/clear) | 原生事件 | resume 核验；clear 使当前状态失效 |
| UserPromptSubmit | 原生事件，可添加上下文 | 每条非空提示记录有界脱敏来源并给出短 task/source 绑定；变化信号只决定是否更新有效投影 |
| SubagentStart/Stop | 原生事件 | 输出最小 capsule；返回结果只作候选 |
| SessionEnd(reason: other) | 原生事件，只对主线程运行 | 记录 advisory 结束事件；不清理或提升长期记忆 |
| App Server thread/compact/start | 原生方法 | 驱动真实手动压缩验证 |
| App Server contextCompaction item | 可观察 started/completed | 记录真实压缩证据 |
| thread/read、thread/resume、thread/fork | 原生方法 | 外部验证器可检查恢复和交接 |

直接来源：

- [Codex 插件结构](https://developers.openai.com/plugins/build/plugins)
- [Codex Hooks 事件与输入输出](https://learn.chatgpt.com/docs/hooks)
- [Codex App Server 协议](https://learn.chatgpt.com/docs/app-server)
- [插件 MCP server](https://developers.openai.com/plugins/build/mcp-server)

## 可可靠实现

- 在 Codex 触发 manual/auto PreCompact 时，于宿主压缩开始前保存状态。
- 在 PostCompact 和 compact SessionStart 中配对转换并恢复。
- 使用当前安装环境可验证的 `CODEX_HOME/plugin-data/context-continuity/v1` 共享 Hook/MCP 状态；Hook 仍使用 `PLUGIN_ROOT` 定位只读插件代码。
- 通过 App Server 启动手动压缩并观察 contextCompaction item。
- Hook 异常时 fail-open，宿主 Agent 继续运行。

## 替代方案与限制

- 插件不控制宿主如何生成摘要，也不把摘要当唯一事实来源。
- Hook 能看到稳定的生命周期字段；transcript_path 被官方标为不稳定，本插件不读取它。
- 没有可靠后事件的平台适配器只能通过转换 epoch、会话标识和 projection digest 推断变化；这不是 Codex MVP 的默认路径。
- 已在当前基线通过降低隔离验证线程的自动压缩阈值，真实触发两次连续 auto compaction；该结果只证明当前构建的生命周期闭环，不能外推到其他 Codex 版本，也不证明产品效果。
- Hooks 需要用户信任。发布验证会临时安装本地或公开 tag 包，但不写入持久 Hook trust；最终交付前必须卸载 marketplace、插件缓存和本次测试产生的数据。
- 当前安装环境的 bundled MCP 不依赖 `${PLUGIN_ROOT}` 参数展开或 `PLUGIN_DATA` 注入；它以插件根目录为 `cwd` 启动相对入口，并优先由 `CODEX_HOME` 解析共享数据目录。环境被清理时，只接受入口位于 `CODEX_HOME/plugins/cache/` 的受限布局推断。这是当前构建的实测兼容约束，不外推为所有未来版本的官方保证。
- MCP namespace 使用 `context_continuity`，避免当前宿主对连字符 namespace 的不稳定暴露；MCP 同时只读提供实际 bundled Skill 文件，供 Windows 沙箱无法直接读取安装缓存时兜底。
- App Server 的 JSON-RPC 生命周期适合验证与宿主集成，不应成为第二套任务 Harness。

## 当前构建的真实证据

- `validation/real-manual.json`：一次 `thread/compact/start`，观察到 `contextCompaction` started/completed，并与 `PreCompact:manual`、`PostCompact:manual`、`SessionStart:compact` 对齐。
- `validation/real-auto.json`：同一隔离线程内至少两次真实自动压缩，每次都观察完整 Hook 闭环；旧 next_action 按设计变为 stale，恢复分类为 `continue_with_markers`，低风险工作可继续但不能直接执行旧动作。
- 验证线程通过 thread-scoped config 注入待测 Hooks，并仅在该线程绕过 Hook trust、关闭已安装插件；没有持久化安装、信任或全局配置变化。

## 生命周期事件是触发器，不是事实

PreCompact 只能证明压缩即将发生；PostCompact 只能证明宿主报告完成；SessionStart(compact) 只提供恢复注入点。任务目标、授权和完成状态仍必须来自带来源的用户事件或当前证据。
