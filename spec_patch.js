import fs from 'node:fs';

const p = '/home/kiwi/projects/ai-project-os/2_projects/cortex/docs/spec/CT-0023-02-openclaw-extraction-adapter.md';
const content = `# CT-0023-02 — OpenClaw Extraction Adapter

## 目的

实现 \`cortex sync --from openclaw [<workspace>]\` 的 extraction 侧，
从 OpenClaw workspace 的 USER.md 和 SOUL.md 中提取 user model 候选。

## API

\`\`\`typescript
extractFromOpenClawWorkspace(rootPath?: string): Promise<ExtractionCandidate[]>
\`\`\`

- \`rootPath\` 省略时自动从 \`~/.openclaw/openclaw.json\` 读取 \`agents.defaults.workspace\`
- 返回 \`ExtractionCandidate[]\`，可直接传给写入层

## 抓取范围（Phase 1）

| 文件 | hint | 说明 |
|------|------|------|
| USER.md | user-profile | OpenClaw 原生 user profile，always-on 注入 |
| SOUL.md | plain | Agent 人格设定，反映用户对 AI 风格的偏好 |

Phase 2 候选（不在本 spec）：IDENTITY.md / AGENTS.md / TOOLS.md / skills/*.md

## Round-trip 保护

extraction 时主动剥除 \`<!-- CORTEX_USER_MODEL_BEGIN -->\` 到
\`<!-- CORTEX_USER_MODEL_END -->\` 之间的内容（含 marker 行本身），
防止 cortex 自己注入的内容被重复提取。

**该 marker 为 cortex reserved**，用户不应在 USER.md 里手动使用。

边界 case 处理：
- 缺 END marker → 不剥除任何内容 + stderr warning
- 多对 marker → 全部剥除（状态机实现，非正则）
- 嵌套 marker（BEGIN-BEGIN-END）→ 不剥除 + stderr warning

## Workspace 路径解析

1. 优先使用显式传入的 rootPath
2. 否则读取 \`~/.openclaw/openclaw.json\` 的 \`agents.defaults.workspace\` 字段
3. 配置文件不存在或字段缺失时 throw（附 helpful message）

## 安全预算

继承 CT-0022-01 的限制：
- 单文件：100KB
- 总字符：500KB

## 新增 hint

\`user-profile\`：用于 USER.md，extraction 走 markdown extractor 的 user-profile 分支，
识别 section 下的 bullet items 和普通段落，输出 \`goal | preference | constraint\` kind 候选。

## 测试覆盖

- \`src/__tests__/adapters/openclaw-scan.test.ts\`
- \`src/__tests__/adapters/openclaw-marker.test.ts\`
- \`src/__tests__/adapters/openclaw-workspace.test.ts\`
- \`src/__tests__/cli-sync-openclaw.test.ts\`

已知限制：集成测试（cli-sync-openclaw.test.ts）在 Codex 沙箱环境有 subprocess 隔离问题。
本地 348/0，产品行为已手工 dry-run 验证。详见 DL-0022-02。

## 非目标（本 spec 不覆盖）

- Injection（写入 USER.md）→ CT-0023-03
- Phase 2 文件（IDENTITY/AGENTS/TOOLS/skills）
- LLM 增强提取（deterministic 优先）
- OpenClaw workspace 自动发现（配置文件解析已覆盖主路径）
`;

fs.writeFileSync(p, content);
