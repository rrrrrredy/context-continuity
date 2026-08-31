# 实现状态

版本：`0.2.0-beta.1`

## 已实现

### 共享核心

- 追加式任务 ledger、哈希链、严格 schema、原子写入、generation 控制、来源、覆盖、
  冲突、验证状态和当前有效投影。
- 有界压缩快照、恢复等价检查、旧 `next_action` 强制失效、resume、clear、
  handoff 和子 Agent 候选。
- 用户权威状态的完整可读提案、一次性第二确认和来源事件单次消费。
- 8 MiB ledger、三个 512 KiB 快照、128 个有效项、256 KiB handoff 与模型上下文
  预算等硬上限。
- 凭据脱敏、宿主 ID 哈希、路径 realpath containment、symlink/junction 防护、两阶段
  reset/delete 和删除后字节扫描。
- 一个只读、七字段 Continuity-to-Guard projection；没有写回。

### Codex

- 插件 manifest、Git marketplace、默认 Hooks、Skill、本地 stdio MCP 与八个有界工具。
- `PreCompact`、`PostCompact`、compact/resume/clear `SessionStart`、
  `UserPromptSubmit`、Subagent 与 SessionEnd 闭环。
- 真实手动压缩、连续自动压缩、字节一致安装缓存、宿主只读发现和安装包 E2E 收据。
- 88 个核心测试、Hook/MCP smoke、30 案例协议 fixture 和仓库验证器。

### DeepSeek Harness

- 与核心共用状态和恢复规则的 Cordis 插件适配器及 `dsh.bundle.patch`。
- native tools，并由宿主绑定 task、cwd 与可信 user source，相关字段不暴露给模型。
- `agent/inbox/inserted`、compaction start/end、resume、父子 Agent 候选和
  awaited `agent/pre-step` 恢复；summary 内容明确忽略且不写入状态。
- 发布版 `0.1.1-rc.2` Cordis、AgentRegistry、Session、SystemPrompt 与
  ToolRuntime 集成测试。
- 7 个适配/集成测试、隔离 tarball 安装收据和发布版 Host API 生命周期收据。

### macOS

- 同一份代码和包，没有 Mac fork。
- 已配置 GitHub Actions `macos-latest` Node 20/22 完整核心、DSH、仓库、Hook、
  MCP、协议评估与依赖审计矩阵；公开绿灯是发布门槛。
- 跨平台 data-root 和路径测试，安装/卸载与证据边界文档。

## 刻意未实现

- 完整对话归档、长期记忆、向量检索、任务管理器、规划器或第二套 Harness。
- 每轮模型摘要、后台常驻进程、远端账户同步、跨任务画像。
- 由模型提供 provider token、verified-evidence token、task/cwd/source identity。
- 直接修改宿主摘要、阻止宿主压缩、接管权限审批或执行工具。
- 自动删除 30 天前状态。
- 实时三插件 bridge 或 Guard 写回。

## 协议存在但未实时启用

- Intent provider：核心测试覆盖版本回退、同版本碰撞和 hash 不一致；公共表面无安全
  provider 身份隔离，所以不开放绑定。
- Continuity-to-Guard：shape 已冻结并测试；Execution Fidelity Guard v0.2 当前没有
  live Continuity bridge，也没有 DSH adapter。
- 同时安装 Intent Loop、Context Continuity 和 Guard 不会自动形成三套或一套共享真相。

## 尚需真实验证

- 冻结的 30 任务三臂产品效果评估。
- 真实 Mac Codex 宿主上的手动与自动压缩生命周期。
- 完整 DSH CLI profile add/remove 与 DSH 引擎生成的自动压缩。
- 长期独立用户 dogfood、升级矩阵和更多 Codex/DSH 版本。
- Intent Loop 暴露满足单调 revision、规范 hash 与受信身份边界的 producer 后的真实
  三产品组合测试。

生命周期、安装包和 Host API 收据是机制证据，不等于已经证明减少返工、目标漂移或
恢复时间。
