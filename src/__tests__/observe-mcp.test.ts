import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAccessLog, type McpAccessEntry } from '../mcp-server/access-log.js';

// We test cmdObserveMcp by capturing stdout
import { cmdObserveMcp } from '../observe-mcp.js';

const TEST_LOG = path.join(os.tmpdir(), `mcp-observe-test-${process.pid}.log`);

function makeEntry(overrides: Partial<McpAccessEntry> = {}): McpAccessEntry {
  return {
    ts: '2026-05-28T10:00:00.000Z',
    transport: 'http',
    method: 'tools/call',
    tool_name: 'get_preferences',
    args_keys: ['limit'],
    args: null,
    response_size_bytes: 1200,
    duration_ms: 45,
    status: 'ok',
    error: null,
    ...overrides,
  };
}

function writeTestLog(entries: McpAccessEntry[]): void {
  fs.writeFileSync(TEST_LOG, entries.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
}

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join('');
}

// Monkey-patch readAccessLog to use test log
// We do this by writing to the real ~/.cortex/mcp-access.log path temporarily
// Instead, we test the summary logic by calling cmdObserveMcp with a patched log path
// Since cmdObserveMcp calls readAccessLog() which uses the default path,
// we write to the real path and restore after.
const REAL_LOG = path.join(os.homedir(), '.cortex', 'mcp-access.log');
let savedLog: Buffer | null = null;

function setupTestLog(entries: McpAccessEntry[]): void {
  const dir = path.dirname(REAL_LOG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(REAL_LOG)) savedLog = fs.readFileSync(REAL_LOG);
  else savedLog = null;
  fs.writeFileSync(REAL_LOG, entries.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
}

function restoreLog(): void {
  if (savedLog !== null) fs.writeFileSync(REAL_LOG, savedLog, { mode: 0o600 });
  else if (fs.existsSync(REAL_LOG)) fs.unlinkSync(REAL_LOG);
}

describe('observe-mcp: summary output', () => {
  it('shows summary with method/tool/transport breakdown', () => {
    const entries = [
      makeEntry({ method: 'tools/list', tool_name: null, args_keys: [], transport: 'http' }),
      makeEntry({ method: 'tools/call', tool_name: 'get_preferences', args_keys: ['limit'], transport: 'http' }),
      makeEntry({ method: 'tools/call', tool_name: 'get_preferences', args_keys: ['limit', 'query'], transport: 'http' }),
      makeEntry({ method: 'initialize', tool_name: null, args_keys: [], transport: 'stdio' }),
    ];
    setupTestLog(entries);
    try {
      const out = captureStdout(() => cmdObserveMcp([]));
      assert.ok(out.includes('MCP Access Log Summary'), `missing header: ${out}`);
      assert.ok(out.includes('Total requests: 4'), `missing total: ${out}`);
      assert.ok(out.includes('tools/list'), `missing tools/list: ${out}`);
      assert.ok(out.includes('tools/call'), `missing tools/call: ${out}`);
      assert.ok(out.includes('get_preferences'), `missing tool name: ${out}`);
      assert.ok(out.includes('http'), `missing http transport: ${out}`);
      assert.ok(out.includes('stdio'), `missing stdio transport: ${out}`);
    } finally {
      restoreLog();
    }
  });

  it('--raw dumps jsonl', () => {
    const entries = [makeEntry(), makeEntry({ method: 'tools/list', tool_name: null })];
    setupTestLog(entries);
    try {
      const out = captureStdout(() => cmdObserveMcp(['--raw']));
      const lines = out.trim().split('\n').filter(l => l);
      assert.equal(lines.length, 2);
      const parsed = JSON.parse(lines[0]) as McpAccessEntry;
      assert.equal(parsed.method, 'tools/call');
    } finally {
      restoreLog();
    }
  });

  it('--limit restricts to last N entries', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ ts: `2026-05-28T${String(i).padStart(2, '0')}:00:00.000Z` })
    );
    setupTestLog(entries);
    try {
      const out = captureStdout(() => cmdObserveMcp(['--limit', '3']));
      assert.ok(out.includes('Total requests: 3'), `expected 3 entries: ${out}`);
    } finally {
      restoreLog();
    }
  });

  it('shows no entries message when log is empty', () => {
    setupTestLog([]);
    try {
      const out = captureStdout(() => cmdObserveMcp([]));
      assert.ok(out.includes('No MCP access log entries'), `expected empty message: ${out}`);
    } finally {
      restoreLog();
    }
  });
});
