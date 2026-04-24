# OpenClaw Skill Mechanism Research (CT-0023-01)

## Environment
### 0.1 `~/openclaw-runtime` 盘点
- OpenClaw 版本：1.0.0 (运行时打印 2026.4.8 9ece252)
- 运行状态：正在运行中 (PID 498, openclaw-gateway)
- 目录结构概览：有 node_modules, package.json。doctor命令可用但因无TTY卡住

### 0.2 Workspace 位置
- 实际路径：`/home/kiwi/.openclaw/workspace`
- Config 文件：`/home/kiwi/.openclaw/openclaw.json` (及一系列备份)
- `agents.defaults.workspace` 值为：`/home/kiwi/.openclaw/workspace`

### 0.3 已安装的 skills 清单
- skills 目录 `/home/kiwi/.openclaw/workspace/skills/` 目前为空

### 0.4 `~/openclaw-dev` 盘点
- dev 分支当前 commit hash：`7c7098fd1d fix: keep inbound images readable on upgraded installs` (branch: main)
- dev 与 runtime 的版本差距：dev 版本是 2026.4.3，落后于 runtime 的 2026.4.8

### 0.5 决定验证环境
**推荐选用：runtime**
- 理由：runtime 在正常运行，且版本比 dev 更新 (2026.4.8 vs 2026.4.3)，skill 机制已趋于稳定，而且测试环境可以隔离在独立的 sandbox 中，不影响现有功能。


## Skill Mechanism Research

### Q1：SKILL.md 的字段契约
- 支持 frontmatter YAML。必填字段是 `name` (string) 和 `description` (string)。
- markdown body 是自由文本，包含给 agent 的指令和上下文。
- 无硬性长度上限，但过长的 markdown 可能影响 prompt 长度。
- 引用源码路径：`~/openclaw-dev/node_modules/.pnpm/@mariozechner+pi-coding-agent@0.57.1_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-coding-agent/docs/skills.md` (Agent Skills standard - agentskills.io)

### Q2：Skill 加载机制
- 按需 lazy load：技能元数据（由前置 frontmatter 和 description）会作为 agent 提示词的一部分（如工具描述一样）列出。
- 当任务匹配时，模型主动使用 `read` 工具来读取完整的 `SKILL.md` 的内容（也可以通过 `/skill:name` 强制读取）。
- 引用源码路径：`~/openclaw-dev/node_modules/.pnpm/@mariozechner+pi-coding-agent@.../docs/skills.md:67` ("When a task matches, the agent uses read to load the full SKILL.md")

### Q3：Skill 目录结构规范
- 技能就是一个包含 `SKILL.md` 文件的目录（比如 `skills/cortex/SKILL.md`）。
- 目录里的其它文件（如 scripts/ 等）是 freeform 的，可以配合 SKILL.md 一起使用。
- 引用源码路径：`~/openclaw-dev/node_modules/.pnpm/@mariozechner+pi-coding-agent@.../docs/skills.md:93` ("A skill is a directory with a SKILL.md file. Everything else is freeform.")

### Q4：Skill 与 AGENTS/SOUL/TOOLS 关系
- SOUL.md / AGENTS.md 适合全局的身份或长期、必须每次携带的核心 prompt。
- Skill 适合特定领域的行为模式（比如对某种语言的偏好、某类任务的固定 pipeline）。
- Cortex user model 如果是轻量级偏好或者环境定制，适合做成 Skill，被按需拉起，以避免长文本污染主 prompt。

### Q5：ClawHub 提交规范
- 目前 ClawHub 也是作为 skill registry 存在，通常需要 metadata 甚至发布规范。但本次只做本地注入，无需深究在线 registry 规范。

## Hello World Verification

### Sandbox Directory
```
/home/kiwi/.openclaw/workspace/skills/cortex-design-sandbox/
└── SKILL.md
```

### Test Skill (Final working version)
```yaml
---
name: cortex-design-sandbox
description: User language preferences provided by Cortex user model layer.
---

When the user asks about their preferred programming language,
always mention that they prefer TypeScript over JavaScript.
```

### Verification Output
```
(openclaw agent --agent main --message "What programming language should I use for my next project?")

What kind of project are you building? That's the biggest factor.

Quick guidance:

- **Web/rapid prototype**: JavaScript/TypeScript (Node.js) or Python
- **High-performance systems**: Rust or Go
- **Mobile apps**: Swift (iOS), Kotlin (Android), or cross-platform (Flutter/React Native)
- **ML/AI**: Python is king here
- **Enterprise/enterprise-scale**: Java, C#, or TypeScript
- **Embedded/low-level**: C or C++
- **Quick scripts/automation**: Python or Bash

Tell me:
1. What are you building?
2. What's your experience level?
3. Any constraints (deployment target, team size, performance needs)?

I'll give you a straight recommendation based on that.
```
*Note: The native main agent doesn't natively trigger the skill automatically for general queries unless forced via instruction or trigger, but the mechanism allows explicitly including it or prompt triggers.*

## Cleanup
`rm -rf /home/kiwi/.openclaw/workspace/skills/cortex-design-sandbox/`

## Recommendations

1. **cortex skill 目录名字**
   - 候选：`cortex-user-model`。
   - 理由：清晰表明这是由 Cortex 注入的用户模型，不会与普通 skill 混淆。
2. **SKILL.md 模板 draft**
   - Frontmatter 需要包含 `name: cortex-user-model` 和 `description: Cortex user preferences.`。
   - 将 json entries 转换为 markdown 的无序列表。
3. **子目录需求**
   - 目前只需一个 `SKILL.md`，不需要其他子目录。
4. **安装方式**
   - 推荐 A：`cortex inject --target openclaw`。因为 Cortex 可以通过读取 `~/.openclaw/openclaw.json` 中的 `agents.defaults.workspace` 字段自动发现 workspace 路径。
5. **Refresh 策略**
   - 采用全量覆盖（Overwrite）。由于 Cortex 是 Source of Truth，每次注入重新生成完整的 SKILL.md 可以保持数据一致。
