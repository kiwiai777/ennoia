const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

// 1. Add import
content = content.replace(
  "import { extractFromOpenClawWorkspace } from './adapters/openclaw/index.js';",
  "import { extractFromOpenClawWorkspace, injectToOpenClaw } from './adapters/openclaw/index.js';"
);

// 2. Change cmdInject signature and add target/workspace/dryRun parameters
content = content.replace(
  "export function cmdInject(args: string[]): void {",
  "export async function cmdInject(args: string[]): Promise<void> {\n  let target: string | undefined;\n  let workspace: string | undefined;\n  let dryRun = false;"
);

// 3. Add parsing for the new parameters
content = content.replace(
  "for (let i = 0; i < args.length; i++) {",
  "for (let i = 0; i < args.length; i++) {\n    const arg = args[i];\n    if (arg === '--target') {\n      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {\n        console.error('错误：--target 缺少参数值。示例：--target openclaw');\n        process.exit(1);\n      }\n      target = args[i + 1];\n      i++;\n      continue;\n    } else if (arg === '--workspace') {\n      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {\n        console.error('错误：--workspace 缺少参数值。');\n        process.exit(1);\n      }\n      workspace = args[i + 1];\n      i++;\n      continue;\n    } else if (arg === '--dry-run') {\n      dryRun = true;\n      continue;\n    }"
);

// 4. Fix duplicate "const arg = args[i];" that our previous replacement creates
content = content.replace(
  "continue;\n    }\n    const arg = args[i];",
  "continue;\n    }"
);

// 5. Add openclaw injection path
content = content.replace(
  "const context = selectRuntimeContext(model, {",
  "if (target === 'openclaw') {\n    await injectToOpenClaw({ workspacePath: workspace, dryRun });\n    return;\n  }\n\n  const context = selectRuntimeContext(model, {"
);

// 6. Fix main loop invocation
content = content.replace(
  "case 'inject':\n      cmdInject(rest);",
  "case 'inject':\n      await cmdInject(rest);"
);

// 7. Update usage - doing this safely
content = content.replace(
  "console.log('  cortex inject [--agent <id>] [--format text|json]');",
  "console.log('  cortex inject --target openclaw [--workspace <path>] [--dry-run]');\n  console.log('  cortex inject [--agent <id>] [--format text|json]');"
);

fs.writeFileSync('src/index.ts', content, 'utf8');
