import fs from 'fs';

let content = fs.readFileSync('src/index.ts', 'utf8');

// Replace the original signature 
const searchStr = `export function cmdInject(args: string[]): void {
  const model = loadUserModel();

  let agentId = 'generic';
  let format: InjectFormat = 'text';
  let scope: string | undefined;
  let taskHint: string | undefined;
  let withObservation = false;`;

const replacementStr = `export async function cmdInject(args: string[]): Promise<void> {
  const model = loadUserModel();

  let agentId = 'generic';
  let format: InjectFormat = 'text';
  let scope: string | undefined;
  let taskHint: string | undefined;
  let withObservation = false;
  let target: string | undefined;
  let workspace: string | undefined;
  let dryRun = false;`;

content = content.replace(searchStr, replacementStr);

const loopStart = `  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent') {`;
    
const replacementLoop = `  for (let i = 0; i < args.length; i++) {
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
    } else if (arg === '--agent') {`;
    
content = content.replace(loopStart, replacementLoop);

const contextStart = `  const context = selectRuntimeContext(model, {
    scopeMatch: scope,
    taskHintMatch: taskHint,
  });`;
  
const contextReplace = `  if (target === 'openclaw') {
    await injectToOpenClaw({ workspacePath: workspace, dryRun });
    return;
  }

  const context = selectRuntimeContext(model, {
    scopeMatch: scope,
    taskHintMatch: taskHint,
  });`;

content = content.replace(contextStart, contextReplace);

fs.writeFileSync('src/index.ts', content, 'utf8');
