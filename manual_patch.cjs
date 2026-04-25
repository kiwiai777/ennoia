const fs = require('fs');

let content = fs.readFileSync('src/index.ts', 'utf8');

// 1. Add import
if (!content.includes('injectToOpenClaw')) {
  content = content.replace(
    "import { extractFromOpenClawWorkspace } from './adapters/openclaw/index.js';",
    "import { extractFromOpenClawWorkspace, injectToOpenClaw } from './adapters/openclaw/index.js';"
  );
}

// 2. Change cmdInject signature
content = content.replace(
  "export function cmdInject(args: string[]): void {",
  "export async function cmdInject(args: string[]): Promise<void> {"
);

// 3. Add variables
content = content.replace(
  "  let withObservation = false;",
  "  let withObservation = false;\n  let target: string | undefined;\n  let workspace: string | undefined;\n  let dryRun = false;"
);

// 4. Add args parsing
content = content.replace(
  "    if (arg === '--agent') {",
  "    if (arg === '--target') {\n      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {\n        console.error('错误：--target 缺少参数值。示例：--target openclaw');\n        process.exit(1);\n      }\n      target = args[i + 1];\n      i++;\n    } else if (arg === '--workspace') {\n      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {\n        console.error('错误：--workspace 缺少参数值。');\n        process.exit(1);\n      }\n      workspace = args[i + 1];\n      i++;\n    } else if (arg === '--dry-run') {\n      dryRun = true;\n    } else if (arg === '--agent') {"
);

// 5. Add openclaw invocation
content = content.replace(
  "  const context = selectRuntimeContext(model, {",
  "  if (target === 'openclaw') {\n    await injectToOpenClaw({ workspacePath: workspace, dryRun });\n    return;\n  }\n\n  const context = selectRuntimeContext(model, {"
);

// 6. Fix switch statement
content = content.replace(
  "    case 'inject':\n      cmdInject(rest);\n      break;",
  "    case 'inject':\n      await cmdInject(rest);\n      break;"
);

// 7. Fix usage
content = content.replace(
  "  console.log('  cortex inject [--agent <id>] [--format text|json]');",
  "  console.log('  cortex inject --target openclaw [--workspace <path>] [--dry-run]');\n  console.log('  cortex inject [--agent <id>] [--format text|json]');"
);

fs.writeFileSync('src/index.ts', content);
