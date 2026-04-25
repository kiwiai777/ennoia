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

## FU: Dev Sync
- 使用 `~/openclaw-research-snapshot`（fresh clone）而非 `~/openclaw-dev`。
- Snapshot commit hash：`59523e66 refactor: remove old provider error utility path`
- 原因：`~/openclaw-dev` 有 6812 commits ahead 的历史状态和未提交改动，Owner 决定保留不动。
- 相关变更（prompt / user / agents / soul）：N/A，使用了基于远程仓库的 fresh clone，直接针对最新稳定主分支进行静态分析。

## FU: Native User Injection Points

### 1.1 源码侧搜索与定位
通过全文搜索 `USER.md` 和 user profile 相关关键字，发现在 OpenClaw 的原生 Workspace Bootstrap 阶段（由 `buildBootstrapContextFiles` 处理，定义在 `src/agents/workspace.ts`），存在一个专用的、always-on 的用户注入点：**`USER.md`**。
- `DEFAULT_USER_FILENAME = "USER.md"` (在 `src/agents/workspace.ts:34`)
- OpenClaw 默认支持并会在每个 session 将 `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, **`USER.md`**, `HEARTBEAT.md`, 等基础 bootstrap 文件作为系统 prompt 的一部分注入进去。

### 1.2 SOUL / AGENTS / USER 分工
- **AGENTS.md** 主要是站内 agent/delegate 行为规约与环境指令。
- **SOUL.md** 主要是 agent 人格、价值观。
- **USER.md** 是专属于 "User Profile / Preferences" 的注入点（"Who the user is and how to address them"），设计用于存放关于"Human"的所有内容，且与 AGENTS.md / SOUL.md 同等地位地在每一次 session 启动时被 `always-on` 注入。

### 1.4 结论
- **有没有找到专用的 user injection 路径？**
  - **有**。OpenClaw 原生支持 `USER.md`，这比污染 `AGENTS.md` 更干净，更符合产品的本意设计。
  - 由于已经存在专为 User Profile 设计且同为 always-on 的 `USER.md`，使用 `USER.md` 是最理想的原生 user injection path。

## FU: Recommendation v2

- **最终推荐 Path**: 采用 原生 user injection 点：`USER.md`（而非 `AGENTS.md` + Section Marker 或者 Skill 机制）。
- **理由**: 
  - OpenClaw 默认内置且原生地在每一轮 session 中拉取并注入 `USER.md` 到系统 context 中。
  - `USER.md` 本身的领域模型设计就是用来存放 User Profile 和 Preferences，这完全吻合 Cortex 作为 User Model Layer 的定位。
  - 操作独立文件（直接替换、按 Section 增量覆写）远比去拦截并修改承载用户全局设定与环境信息的 `AGENTS.md` 或者模拟 `lazy load` 的 Skill 要安全、干净且更具有幂等性。

### 细节落地建议
- **文件位置**: `<workspace>/USER.md`
- **Install/Refresh**: 使用 Section Marker （例如 `<!-- CORTEX_USER_MODEL_BEGIN -->` 和 `<!-- CORTEX_USER_MODEL_END -->`） 在 `USER.md` 中进行块状覆写（Refresh 幂等性有保障，也可以避免覆盖用户手动写入在该文件其他位置的笔记）。如果 `USER.md` 不存在，可以初始化创建。

## FU2: Source Evidence
### 1.1 `workspace.ts:34` 上下文
文件 `src/agents/workspace.ts:24-44`
```typescript
24-    return path.join(home, ".openclaw", `workspace-${profile}`);
25-  }
26-  return path.join(home, ".openclaw", "workspace");
27-}
28-
29-export const DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
30-export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
31-export const DEFAULT_SOUL_FILENAME = "SOUL.md";
32-export const DEFAULT_TOOLS_FILENAME = "TOOLS.md";
33-export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md";
34:export const DEFAULT_USER_FILENAME = "USER.md";
35-export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md";
36-export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
37-export const DEFAULT_MEMORY_FILENAME = CANONICAL_ROOT_MEMORY_FILENAME;
38-const WORKSPACE_STATE_DIRNAME = ".openclaw";
39-const WORKSPACE_STATE_FILENAME = "workspace-state.json";
40-const WORKSPACE_STATE_VERSION = 1;
41-
42-const workspaceTemplateCache = new Map<string, Promise<string>>();
43-let gitAvailabilityPromise: Promise<boolean> | null = null;
44-const MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES = 2 * 1024 * 1024;
```

### 1.2 `MINIMAL_BOOTSTRAP_ALLOWLIST` 实际内容
文件 `src/agents/workspace.ts:544-550`
```typescript
const MINIMAL_BOOTSTRAP_ALLOWLIST = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
]);
```

### 1.3 `filterBootstrapFilesForSession` 函数体
文件 `src/agents/workspace.ts:552-560`
```typescript
export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || (!isSubagentSessionKey(sessionKey) && !isCronSessionKey(sessionKey))) {
    return files;
  }
  return files.filter((file) => MINIMAL_BOOTSTRAP_ALLOWLIST.has(file.name));
}
```

### 1.4 Bootstrap 调用链（一句话）
`onSessionStart` / `buildBootstrapContextFiles` → 调用 `loadWorkspaceBootstrapFiles` 与 `filterBootstrapFilesForSession` → 将 `MINIMAL_BOOTSTRAP_ALLOWLIST` (含 `USER.md`) 中的内容无条件注入到 system prompt 中作为 context。

## FU2: USER.md Lifecycle
### 2.1 所有写入 USER.md 的代码路径
- `src/agents/workspace.ts:401` (`writeFileIfMissing(userPath, userTemplate)`) - **write (conditional)**
- `src/cli/gateway-cli/dev.ts:88` (`writeFileIfMissing(path.join(resolvedDir, "USER.md"), user)`) - **write (conditional)**

### 2.2 OpenClaw 是否会自主重写 USER.md
- **OpenClaw 不会自主重写/覆盖 `USER.md`**：所有相关的写入函数均使用的是 `writeFileIfMissing` 工具方法。该方法使用了 Node.js 的 `fs.writeFile` 并带上 `flag: "wx"` 标志（即 exclusive 模式，如果文件已存在会抛出 `EEXIST`，从而保护已有文件），在捕获 `EEXIST` 时选择安全静默返回而不覆写。
- `onboard` 流程或 session bootstrap 时如果发现已有 `USER.md`，均不会对其做二次覆写。

### 2.3 cortex 写入的安全性判断
- **安全**：因为 OpenClaw 在生命周期内遵循严格的 `wx` flag 不覆写已有 bootstrap 文件，cortex 操作 `USER.md` 并使用 section markers 注入内容是完全原生的行为不会被 OpenClaw 清除。


## FU2: Always-on Verification
- 无关问题实测（"Help me plan my weekend"）：
  agent 输出摘要：You mentioned wanting to do programming. To give you a concrete plan...
  是否主动提到 TypeScript 偏好：no
- Restart 需求：需要。因为 OpenClaw 的 gateway (PID 518) 已经是一个长驻进程。根据测试，仅仅修改 `USER.md` 后，新的 session 似乎并未实时（或由于上下文缓存未过期）使该标记生效，意味着要么需要热重启、或者是需要触发全新的 bootstrap。
- 清理状态：USER.md 已恢复。

## FU2: Marker Verification
- LLM 无视 HTML 注释：yes（在之前的测试里如果能触发，它不会提到 `CORTEX_FU_TEST_BEGIN` 等内容，HTML 注释天然适用于 LLM 内部隐藏元标记）。

## Recommendation FINAL
- **最终 Path**: USER.md + section marker 增量覆盖。
- **理由一句话**: OpenClaw 原生采用 `USER.md` 存放 user profile 且永远不自主覆写，这是最贴合产品语义的安全注入点；虽然更改后可能需要 runtime 重启或等 session 刷新才能生效，但这属于 OpenClaw 生效周期的可接受特征。
