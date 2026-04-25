const fs = require('fs');

let content = fs.readFileSync('src/__tests__/cli-inject.test.ts', 'utf8');

// The issue is cmdInject is now async, but the test wrapper runInjectCommand calls it synchronously.
content = content.replace(
  "function runInjectCommand(args: string[]): RunResult {",
  "async function runInjectCommand(args: string[]): Promise<RunResult> {"
);

content = content.replace(
  "    cmdInject(args);",
  "    await cmdInject(args);"
);

content = content.replace(
  "it('--format json 成功：退出 0，输出合法 Pack v0.1', () => {",
  "it('--format json 成功：退出 0，输出合法 Pack v0.1', async () => {"
);
content = content.replace(
  "    const r = runInjectCommand(['--format', 'json']);",
  "    const r = await runInjectCommand(['--format', 'json']);"
);

content = content.replace(
  "it('--agent claude-code --format json 把 agent 反映在 source.agent 里', () => {",
  "it('--agent claude-code --format json 把 agent 反映在 source.agent 里', async () => {"
);
content = content.replace(
  "    const r = runInjectCommand(['--agent', 'claude-code', '--format', 'json']);",
  "    const r = await runInjectCommand(['--agent', 'claude-code', '--format', 'json']);"
);

content = content.replace(
  "it('--agent claude-code（默认 text）：走 projector 路径，输出含 XML 包装标签', () => {",
  "it('--agent claude-code（默认 text）：走 projector 路径，输出含 XML 包装标签', async () => {"
);
content = content.replace(
  "    const r = runInjectCommand(['--agent', 'claude-code']);",
  "    const r = await runInjectCommand(['--agent', 'claude-code']);"
);

content = content.replace(
  "it('--format yaml 错误：退出非 0，stderr 提示 --format 非法', () => {",
  "it('--format yaml 错误：退出非 0，stderr 提示 --format 非法', async () => {"
);
content = content.replace(
  "    const r = runInjectCommand(['--format', 'yaml']);",
  "    const r = await runInjectCommand(['--format', 'yaml']);"
);

fs.writeFileSync('src/__tests__/cli-inject.test.ts', content, 'utf8');
