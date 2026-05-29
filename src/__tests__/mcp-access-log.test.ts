import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEntry, readAccessLog, type McpAccessEntry } from '../mcp-server/access-log.js';

const TEST_LOG = path.join(os.tmpdir(), `mcp-access-test-${process.pid}.log`);

// Patch the module's LOG_PATH by writing to a temp file directly
function writeTestLog(entries: McpAccessEntry[]): void {
  fs.writeFileSync(TEST_LOG, entries.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
}

describe('access-log: buildEntry', () => {
  it('builds entry with args_keys and null args by default', () => {
    const start = Date.now() - 50;
    const entry = buildEntry('http', 'tools/call', 'get_preferences', { limit: 3, query: 'test' }, start, 1234, 'ok', null);
    assert.equal(entry.transport, 'http');
    assert.equal(entry.method, 'tools/call');
    assert.equal(entry.tool_name, 'get_preferences');
    assert.deepEqual(entry.args_keys.sort(), ['limit', 'query']);
    assert.equal(entry.args, null); // ENNOIA_LOG_ARGS not set
    assert.equal(entry.response_size_bytes, 1234);
    assert.ok(entry.duration_ms >= 0);
    assert.equal(entry.status, 'ok');
    assert.equal(entry.error, null);
    assert.ok(entry.ts.endsWith('Z'));
  });

  it('builds entry with null tool_name for tools/list', () => {
    const entry = buildEntry('stdio', 'tools/list', null, {}, Date.now(), 500, 'ok', null);
    assert.equal(entry.tool_name, null);
    assert.equal(entry.transport, 'stdio');
    assert.deepEqual(entry.args_keys, []);
  });

  it('builds error entry', () => {
    const entry = buildEntry('http', 'tools/call', 'unknown_tool', {}, Date.now(), 0, 'error', 'Unknown tool: unknown_tool');
    assert.equal(entry.status, 'error');
    assert.equal(entry.error, 'Unknown tool: unknown_tool');
  });

  it('handles null args gracefully', () => {
    const entry = buildEntry('http', 'initialize', null, null, Date.now(), 100, 'ok', null);
    assert.deepEqual(entry.args_keys, []);
    assert.equal(entry.args, null);
  });
});

describe('access-log: readAccessLog', () => {
  before(() => {
    const entries: McpAccessEntry[] = [
      {
        ts: '2026-05-28T10:00:00.000Z',
        transport: 'http',
        method: 'tools/list',
        tool_name: null,
        args_keys: [],
        args: null,
        response_size_bytes: 890,
        duration_ms: 12,
        status: 'ok',
        error: null,
      },
      {
        ts: '2026-05-28T10:01:00.000Z',
        transport: 'http',
        method: 'tools/call',
        tool_name: 'get_preferences',
        args_keys: ['limit'],
        args: null,
        response_size_bytes: 1200,
        duration_ms: 45,
        status: 'ok',
        error: null,
      },
    ];
    writeTestLog(entries);
  });

  after(() => {
    if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
  });

  it('reads all entries from log file', () => {
    const entries = readAccessLog(TEST_LOG);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].method, 'tools/list');
    assert.equal(entries[1].method, 'tools/call');
    assert.equal(entries[1].tool_name, 'get_preferences');
  });

  it('returns empty array for non-existent file', () => {
    const entries = readAccessLog('/tmp/nonexistent-mcp-log-xyz.log');
    assert.deepEqual(entries, []);
  });

  it('skips malformed lines', () => {
    const mixed = TEST_LOG + '.mixed';
    fs.writeFileSync(mixed, '{"ts":"2026-05-28T10:00:00.000Z","method":"tools/list","transport":"http","tool_name":null,"args_keys":[],"args":null,"response_size_bytes":100,"duration_ms":10,"status":"ok","error":null}\nnot-json\n{"ts":"2026-05-28T10:01:00.000Z","method":"tools/call","transport":"http","tool_name":"get_preferences","args_keys":[],"args":null,"response_size_bytes":200,"duration_ms":20,"status":"ok","error":null}\n');
    const entries = readAccessLog(mixed);
    assert.equal(entries.length, 2);
    fs.unlinkSync(mixed);
  });
});
