const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

// 1. Add import
content = content.replace(
  "import { extractFromOpenClawWorkspace } from './adapters/openclaw/index.js';",
  "import { extractFromOpenClawWorkspace, injectToOpenClaw } from './adapters/openclaw/index.js';"
);

// 2. Change cmdInject
const injectMatch = content.match(/export function cmdInject\(args: string\[\]\): void \{([\s\S]*?)const context = selectRuntimeContext\(model, \{/);
if (injectMatch) {
  let inner = injectMatch[1];
  
  // Replace the signature and args parsing
  const newHeader = `export async function cmdInject(args: string[]): Promise<void> {\n  let target: string | undefined;\n  let workspace: string | undefined;\n  let dryRun = false;\n`;
  inner = inner.replace("  const model = loadUserModel();", "  const model = loadUserModel();");
  
  const forLoopMatch = inner.match(/for \(let i = 0; i < args\.length; i\+\+\) \{/);
  if (forLoopMatch) {
    const argsParsing = `for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--target 缺少参数值。示例：--target openclaw');
        process.exit(1);
      }
      target = args[i + 1];
      i++;
      continue;
    } else if (arg === '--workspace') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--workspace 缺少参数值。');
        process.exit(1);
      }
      workspace = args[i + 1];
      i++;
      continue;
    } else if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }`;
    inner = inner.replace("for (let i = 0; i < args.length; i++) {\n    const arg = args[i];", argsParsing);
  }
  
  const injectionPath = `if (target === 'openclaw') {
    await injectToOpenClaw({ workspacePath: workspace, dryRun });
    return;
  }

  const context = selectRuntimeContext(model, {`;
  
  content = content.replace(injectMatch[0], newHeader + inner + injectionPath);
}

// Fix main loop invocation
content = content.replace(
  "case 'inject':\n      cmdInject(rest);",
  "case 'inject':\n      await cmdInject(rest);"
);

// Update usage - doing this safely
content = content.replace(
  "console.log('  cortex inject [--agent <id>] [--format text|json]');",
  "console.log('  cortex inject --target openclaw [--workspace <path>] [--dry-run]');\n  console.log('  cortex inject [--agent <id>] [--format text|json]');"
);

fs.writeFileSync('src/index.ts', content, 'utf8');
