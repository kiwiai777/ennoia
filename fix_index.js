import fs from 'fs';

let content = fs.readFileSync('src/index.ts', 'utf8');

// Replace the cmdInject definition completely
const originalFunc = `export function cmdInject(args: string[]): void {
  const model = loadUserModel();

  let agentId = 'generic';
  let format: InjectFormat = 'text';
  let scope: string | undefined;
  let taskHint: string | undefined;
  let withObservation = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--agent 缺少参数值。示例：--agent claude-code');
        process.exit(1);
      }
      agentId = args[i + 1];
      i++;
    } else if (arg === '--format') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--format 缺少参数值。可选值：text | json');
        process.exit(1);
      }
      const value = args[i + 1];
      if (value !== 'text' && value !== 'json') {
        console.error(\`错误：--format 取值非法（\${value}）。可选值：text | json\`);
        process.exit(1);
      }
      format = value;
      i++;
    } else if (arg === '--scope') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--scope 缺少参数值。示例：--scope Cortex');
        process.exit(1);
      }
      scope = args[i + 1];
      i++;
    } else if (arg === '--task-hint') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--task-hint 缺少参数值。示例：--task-hint "planning injection"');
        process.exit(1);
      }
      taskHint = args[i + 1];
      i++;
    } else if (arg === '--with-observation') {
      withObservation = true;
    } else {
      console.error(\`错误：未知的参数 \${arg}\`);
      process.exit(1);
    }
  }

  const context = selectRuntimeContext(model, {
    scopeMatch: scope,
    taskHintMatch: taskHint,
  });`;

const newFunc = `export async function cmdInject(args: string[]): Promise<void> {
  const model = loadUserModel();

  let agentId = 'generic';
  let format: InjectFormat = 'text';
  let scope: string | undefined;
  let taskHint: string | undefined;
  let withObservation = false;
  let target: string | undefined;
  let workspace: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--target 缺少参数值。示例：--target openclaw');
        process.exit(1);
      }
      target = args[i + 1];
      i++;
    } else if (arg === '--workspace') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--workspace 缺少参数值。');
        process.exit(1);
      }
      workspace = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--agent') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--agent 缺少参数值。示例：--agent claude-code');
        process.exit(1);
      }
      agentId = args[i + 1];
      i++;
    } else if (arg === '--format') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--format 缺少参数值。可选值：text | json');
        process.exit(1);
      }
      const value = args[i + 1];
      if (value !== 'text' && value !== 'json') {
        console.error(\`错误：--format 取值非法（\${value}）。可选值：text | json\`);
        process.exit(1);
      }
      format = value;
      i++;
    } else if (arg === '--scope') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--scope 缺少参数值。示例：--scope Cortex');
        process.exit(1);
      }
      scope = args[i + 1];
      i++;
    } else if (arg === '--task-hint') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('错误：--task-hint 缺少参数值。示例：--task-hint "planning injection"');
        process.exit(1);
      }
      taskHint = args[i + 1];
      i++;
    } else if (arg === '--with-observation') {
      withObservation = true;
    } else {
      console.error(\`错误：未知的参数 \${arg}\`);
      process.exit(1);
    }
  }

  if (target === 'openclaw') {
    await injectToOpenClaw({ workspacePath: workspace, dryRun });
    return;
  }

  const context = selectRuntimeContext(model, {
    scopeMatch: scope,
    taskHintMatch: taskHint,
  });`;

content = content.replace(originalFunc, newFunc);
fs.writeFileSync('src/index.ts', content, 'utf8');
