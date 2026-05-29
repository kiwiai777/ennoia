import { readAccessLog, type McpAccessEntry } from './mcp-server/access-log.js';

function parseDuration(s: string): number | null {
  const m = s.match(/^(\d+)(h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  return null;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  return `${(b / 1024).toFixed(1)}KB`;
}

function formatDate(ts: string): string {
  return ts.slice(0, 16).replace('T', ' ');
}

export function cmdObserveMcp(args: string[]): void {
  const rawMode = args.includes('--raw');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50;
  const sinceIdx = args.indexOf('--since');
  const sinceStr = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

  let entries = readAccessLog();

  if (sinceStr) {
    const ms = parseDuration(sinceStr);
    if (ms === null) {
      console.error(`Error: invalid --since value "${sinceStr}". Use format like 24h or 7d.`);
      process.exit(1);
    }
    const cutoff = new Date(Date.now() - ms).toISOString();
    entries = entries.filter(e => e.ts >= cutoff);
  }

  // Apply limit (take last N)
  const limited = entries.slice(-limit);

  if (rawMode) {
    for (const e of limited) {
      console.log(JSON.stringify(e));
    }
    return;
  }

  if (limited.length === 0) {
    console.log('No MCP access log entries found.');
    return;
  }

  const first = limited[0].ts.slice(0, 10);
  const last = limited[limited.length - 1].ts.slice(0, 10);
  const periodStr = first === last ? first : `${first} to ${last}`;

  console.log('MCP Access Log Summary');
  console.log('');
  console.log(`Period: ${periodStr}`);
  console.log(`Total requests: ${limited.length}`);

  // By method
  const byMethod: Record<string, number> = {};
  for (const e of limited) {
    byMethod[e.method] = (byMethod[e.method] ?? 0) + 1;
  }
  console.log('');
  console.log('By method:');
  for (const [method, count] of Object.entries(byMethod).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${method.padEnd(20)} ${count} request${count !== 1 ? 's' : ''}`);
  }

  // By tool (tools/call only)
  const toolCalls = limited.filter(e => e.method === 'tools/call' && e.tool_name);
  if (toolCalls.length > 0) {
    const byTool: Record<string, McpAccessEntry[]> = {};
    for (const e of toolCalls) {
      const name = e.tool_name!;
      if (!byTool[name]) byTool[name] = [];
      byTool[name].push(e);
    }
    console.log('');
    console.log('By tool (tools/call only):');
    for (const [toolName, calls] of Object.entries(byTool).sort((a, b) => b[1].length - a[1].length)) {
      const avgDuration = Math.round(calls.reduce((s, e) => s + e.duration_ms, 0) / calls.length);
      const avgSize = Math.round(calls.reduce((s, e) => s + e.response_size_bytes, 0) / calls.length);
      const errors = calls.filter(e => e.status === 'error').length;
      // Unique args_keys combinations
      const keyPatterns = [...new Set(calls.map(e => JSON.stringify(e.args_keys.sort())))].map(s => JSON.parse(s) as string[]);
      console.log(`  ${toolName}  ${calls.length} request${calls.length !== 1 ? 's' : ''}`);
      console.log(`    - avg duration: ${avgDuration}ms`);
      console.log(`    - avg response size: ${formatBytes(avgSize)}`);
      if (keyPatterns.length > 0) {
        const patternsStr = keyPatterns.map(p => JSON.stringify(p)).join(', ');
        console.log(`    - args keys observed: ${patternsStr}`);
      }
      console.log(`    - errors: ${errors}`);
    }
  }

  // By transport
  const byTransport: Record<string, number> = {};
  for (const e of limited) {
    byTransport[e.transport] = (byTransport[e.transport] ?? 0) + 1;
  }
  console.log('');
  console.log('By transport:');
  for (const [t, count] of Object.entries(byTransport).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(10)} ${count} request${count !== 1 ? 's' : ''}`);
  }

  // Recent activity (last 5)
  const recent = limited.slice(-5).reverse();
  console.log('');
  console.log('Recent activity (last 5):');
  for (const e of recent) {
    const tool = e.tool_name ?? '-';
    const size = formatBytes(e.response_size_bytes);
    console.log(`  ${formatDate(e.ts)}  ${e.transport.padEnd(6)}  ${e.method.padEnd(12)}  ${tool.padEnd(20)} ${String(e.duration_ms).padStart(5)}ms  ${size.padStart(7)}  ${e.status}`);
  }
}
