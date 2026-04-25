import fs from 'node:fs';

const p = '/home/kiwi/projects/ai-project-os/2_projects/cortex/decision_log.md';
let content = fs.readFileSync(p, 'utf8');

// B1
const newDL = `## DL-0023-01 — OpenClaw Extraction Adapter：injection path = USER.md + section marker

Date: 2026-04-25
Stage: Stage 17
Status: Accepted
Related: CT-0023-01, CT-0023-01-FU, CT-0023-01-FU2, CT-0023-01-FU3, CT-0023-02

### Context

Stage 17 目标：让 OpenClaw 成为 Cortex 的第一个 injection target，
验证"跨 AI user model layer"的核心产品命题。

经四轮设计调研（CT-0023-01 / FU / FU2 / FU3），最终确定：
- **Extraction path**（read source）：USER.md + SOUL.md，Phase 1
- **Injection path**（write target，CT-0023-03）：USER.md + section marker

调研路径：
1. CT-0023-01 发现 Skill 是 lazy load（非 always-on），不适合 user model
2. CT-0023-01-FU 发现 OpenClaw 原生有 USER.md（DEFAULT_USER_FILENAME，在 MINIMAL_BOOTSTRAP_ALLOWLIST）
3. CT-0023-01-FU2 锁定 USER.md 源码证据（workspace.ts:34，wx flag 保护不被覆盖）
4. CT-0023-01-FU3 实测验证 always-on（restart systemctl --user restart openclaw-gateway 后生效）

### Decision

1. Extraction（CT-0023-02）：
   - 抓取 USER.md（hint: user-profile）+ SOUL.md（hint: plain）
   - Round-trip 保护：识别并剥除 \`<!-- CORTEX_USER_MODEL_BEGIN/END -->\` marker section
   - workspace 路径：解析 \`~/.openclaw/openclaw.json\` 的 \`agents.defaults.workspace\` 字段
   - Phase 2 候选：IDENTITY.md / AGENTS.md / TOOLS.md / skills（不在本期）

2. Injection（CT-0023-03，待实现）：
   - 写入目标：USER.md 末尾的 \`<!-- CORTEX_USER_MODEL_BEGIN/END -->\` section
   - Refresh 策略：全量覆盖 marker 内部，不动 marker 外部
   - 需要 restart openclaw-gateway 才能生效（UX 约束：inject 后提示用户 restart）

### Rationale

- USER.md 是 OpenClaw 原生 user profile 文件，比 AGENTS.md 和 Skill 更贴合语义
- Skill 是 lazy load（实测失败），AGENTS.md 是环境/行为配置不是用户偏好
- Section marker 在实测中对 LLM 透明（FU3 Step 4 确认）
- wx flag 保护确保 cortex 写入不会被 OpenClaw 自主覆盖

### Impact

- CT-0023-02：extraction adapter 实现（USER.md + SOUL.md Phase 1）
- CT-0023-03：injection 实现（USER.md section marker）
- 未来 adapter 扩展可复用相同的 marker + workspace.json 解析模式

---
`;

content = content.replace('# Cortex Decision Log\n\n', '# Cortex Decision Log\n\n' + newDL);

// B2
const appendB2 = `
- **CT-0023-02 补充（2026-04-25）**：CT-0023-02 新增的 \`cli-sync-openclaw.test.ts\`
  集成测试在 Codex 沙箱环境下存在相同的 subprocess 隔离限制，已在该文件顶部加注释。
  **未来修复方向（Path A）**：将 spawnSync 集成测试迁移为 in-process 函数调用测试，
  彻底消除沙箱兼容性问题。可在独立的"测试架构整理"Stage 统一处理，不阻塞产品主线。`;

content = content.replace(
  '  用例标记为"已知沙箱限制"，不视为新 finding\n- 后续如需修复沙箱兼容性，可独立开卡，不阻塞 Stage 16 主线推进\n',
  '  用例标记为"已知沙箱限制"，不视为新 finding\n- 后续如需修复沙箱兼容性，可独立开卡，不阻塞 Stage 16 主线推进\n' + appendB2 + '\n'
);

fs.writeFileSync(p, content);
