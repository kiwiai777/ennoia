import fs from 'fs';
import path from 'path';
import os from 'os';

export interface McpAccessEntry {
  ts: string;
  transport: 'stdio' | 'http';
  method: string;
  tool_name: string | null;
  args_keys: string[];
  args: Record<string, unknown> | null;
  response_size_bytes: number;
  duration_ms: number;
  status: 'ok' | 'error';
  error: string | null;
}

const LOG_PATH = path.join(os.homedir(), '.cortex', 'mcp-access.log');
const LOG_ARGS = process.env['ENNOIA_LOG_ARGS'] === '1';

function ensureLogFile(): void {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, '', { mode: 0o600 });
  }
}

export function appendAccessLog(entry: McpAccessEntry): void {
  // Fire-and-forget: don't block the response path
  setImmediate(() => {
    try {
      ensureLogFile();
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch {
      // Logging failure must never crash the MCP server
    }
  });
}

export function buildEntry(
  transport: 'stdio' | 'http',
  method: string,
  toolName: string | null,
  args: Record<string, unknown> | null | undefined,
  startTime: number,
  responseSize: number,
  status: 'ok' | 'error',
  error: string | null
): McpAccessEntry {
  const argsKeys = args != null ? Object.keys(args) : [];
  return {
    ts: new Date().toISOString(),
    transport,
    method,
    tool_name: toolName,
    args_keys: argsKeys,
    args: LOG_ARGS && args != null ? args : null,
    response_size_bytes: responseSize,
    duration_ms: Date.now() - startTime,
    status,
    error,
  };
}

export function readAccessLog(logPath = LOG_PATH): McpAccessEntry[] {
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
  const entries: McpAccessEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as McpAccessEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}
