const fs = require('fs');
const path = require('path');

const dlPath = path.join(process.env.HOME, 'projects/ai-project-os/2_projects/cortex/decision_log.md');
let content = fs.readFileSync(dlPath, 'utf8');

const dlContent = `## DL-0023-02 — OpenClaw Injection：USER.md section marker 写入策略

Date: 2026-04-25
Stage: Stage 17
Status: Accepted
Related: CT-0023-03, CT-0023-01-FU3, DL-0023-01

### Context

CT-0023-03 实现 \`cortex inject --target openclaw\`，将 user_model.json
内容注入 OpenClaw 的 USER.md。

核心设计决策：
1. **渲染格式**：自然语言段落（非 bullet / structured section）
   - 与 USER.md 原有内容风格一致
   - LLM 内化遵循通常优于 bullet list
   - 中/英文 content 自动判断对应句式
2. **写入机制**：Section marker（\`<!-- CORTEX_USER_MODEL_BEGIN/END -->\`）
   - Replace 模式：marker 已存在时替换内部内容
   - Append 模式：marker 不存在时追加到文件末尾
   - 残缺 marker 保护：只有一个 marker 时中止，不破坏已有内容
3. **原子写入**：tmp 同目录 + rename，防止写入中断导致文件损坏
4. **生效提示**：inject 后输出 \`systemctl --user restart openclaw-gateway\`

### Decision

1. 自然语言段落是 USER.md 注入的标准渲染格式（不用 bullet）
2. Section marker 是 cortex reserved，用户不应手动在 USER.md 里使用
3. Refresh 策略：全量覆盖 marker 内部，不动 marker 外部
4. 本卡不做 re-inject 自动提醒（用户手动运行 cortex inject）
   未来可在 cortex sync / reflect 写入后追加提示（Stage 18 候选）

### Impact

- \`cortex inject --target openclaw [--workspace <path>] [--dry-run]\` 可用
- USER.md marker 为 cortex reserved，DL-0023-01 injection path 完整实现
- Round-trip 保护（CT-0023-02）与 inject marker 配套，extraction 时自动剥除已注入内容

`;

content = content.replace(
  '# Cortex Decision Log\n\n', 
  '# Cortex Decision Log\n\n' + dlContent
);

fs.writeFileSync(dlPath, content, 'utf8');
