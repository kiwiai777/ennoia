const fs = require('fs');
const path = require('path');

const dlPath = path.join(process.env.HOME, 'projects/ai-project-os/2_projects/cortex/decision_log.md');
let content = fs.readFileSync(dlPath, 'utf8');

content = content.replace(
  '- **CT-0023-02 补充（2026-04-25）**：CT-0023-02 新增的 `cli-sync-openclaw.test.ts`\n  集成测试在 Codex 沙箱环境下存在相同的 subprocess 隔离限制，已在该文件顶部加注释。\n  **未来修复方向（Path A）**：将 spawnSync 集成测试迁移为 in-process 函数调用测试，\n  彻底消除沙箱兼容性问题。可在独立的"测试架构整理"Stage 统一处理，不阻塞产品主线。',
  '- **CT-0023-02 补充（2026-04-25）**：CT-0023-02 新增的 `cli-sync-openclaw.test.ts`\n  集成测试在 Codex 沙箱环境下存在相同的 subprocess 隔离限制，已在该文件顶部加注释。\n  **未来修复方向（Path A）**：将 spawnSync 集成测试迁移为 in-process 函数调用测试，\n  彻底消除沙箱兼容性问题。可在独立的"测试架构整理"Stage 统一处理，不阻塞产品主线。\n- **CT-0023-03 补充（2026-04-25）**：CT-0023-03 新增的 `cli-inject-openclaw.test.ts`\n  集成测试在 Codex 沙箱环境下存在相同的 subprocess 隔离限制，已在该文件顶部加注释。\n  产品行为（USER.md marker 写入）已通过 fixture 独立写入测试验证正确。'
);

fs.writeFileSync(dlPath, content, 'utf8');
