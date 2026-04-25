const fs = require('fs');

let content = fs.readFileSync('src/index.ts', 'utf8');

if (!content.includes('import { extractFromOpenClawWorkspace, injectToOpenClaw }')) {
    content = content.replace(
        "import { extractFromOpenClawWorkspace } from './adapters/openclaw/index.js';",
        "import { extractFromOpenClawWorkspace, injectToOpenClaw } from './adapters/openclaw/index.js';"
    );
}

if (!content.includes('export async function cmdInject')) {
    content = content.replace(
        "export function cmdInject(args: string[]): void {",
        `export async function cmdInject(args: string[]): Promise<void> {
  const model = loadUserModel();

  let target: string | undefined;
  let workspace: string | undefined;
  let dryRun = false;`
    );

    content = content.replace(
        "const model = loadUserModel();",
        "" // removed because we added it in the replace above
    );

    content = content.replace(
        "for (let i = 0; i < args.length; i++) {",
        `for (let i = 0; i < args.length; i++) {
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
    }
    
    // original args`
    );
    
    // Fix the duplicate const arg
    content = content.replace(
        "// original args\n    const arg = args[i];",
        "// original args"
    );

    const injectToOpenClawLogic = `
  if (target === 'openclaw') {
    await injectToOpenClaw({
      workspacePath: workspace,
      dryRun: dryRun,
    });
    return;
  }

  // 1. Selection`;

    content = content.replace("  // 1. Selection", injectToOpenClawLogic);

    content = content.replace(
        "case 'inject':\n      cmdInject(rest);",
        "case 'inject':\n      await cmdInject(rest);"
    );
    
    content = content.replace(
        "cortex inject [--agent <id>] [--format text|json]",
        "cortex inject [--agent <id>] [--format text|json]"
    );
    
    content = content.replace(
        "cortex inject [--agent <id>] [--format text|json]",
        "cortex inject --target openclaw [--workspace <path>] [--dry-run]\n  cortex inject [--agent <id>] [--format text|json]"
    );
}

fs.writeFileSync('src/index.ts', content, 'utf8');
console.log("Patched src/index.ts");
