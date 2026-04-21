// CT-0021-07 — Persistent store tests
//
// Tests: empty init, append → reload consistency, corrupt fail-soft,
// atomic write (tmp file not left behind).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadStore, appendEntry, getStorePath } from '../store.js';
import type { UserModelEntry } from '../confirmSuggestion.js';

let tmpHome: string;
let origHome: string | undefined;

function setup(): void {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-storetest-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
}

function teardown(): void {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

const entry1: UserModelEntry = { type: 'preference', content: '喜欢简洁代码', source: 'suggest_loop' };
const entry2: UserModelEntry = { type: 'goal', content: '完成 MVP', source: 'suggest_loop' };

describe('suggest-loop store: persistence', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('空 store 初始化：loadStore 返回 version 0.1，entries 为空数组', () => {
    const store = loadStore();
    assert.equal(store.version, '0.1');
    assert.deepEqual(store.entries, []);
  });

  it('append → reload 跨进程一致性：写入后重新 load 可读回条目', () => {
    appendEntry(entry1);
    appendEntry(entry2);

    const reloaded = loadStore();
    assert.equal(reloaded.entries.length, 2);
    assert.deepEqual(reloaded.entries[0], entry1);
    assert.deepEqual(reloaded.entries[1], entry2);
  });

  it('损坏文件 fail-soft：load 返回空 store，不 throw', () => {
    // Write corrupt JSON to store path
    const dir = path.join(tmpHome, '.cortex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStorePath(), 'not valid json', 'utf-8');

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    let store;
    try {
      store = loadStore();
    } finally {
      process.stderr.write = origWrite;
    }

    assert.equal(store.version, '0.1');
    assert.deepEqual(store.entries, []);
    assert.ok(stderrChunks.some((c) => c.includes('损坏')));
  });

  it('原子写入：tmp 文件不遗留', () => {
    appendEntry(entry1);

    const dir = path.join(tmpHome, '.cortex');
    const files = fs.readdirSync(dir);
    const tmps = files.filter((f) => f.includes('.tmp.'));
    assert.equal(tmps.length, 0);
  });

  it('store 文件不存在时 loadStore 不报错，返回空 store', () => {
    // No .cortex dir created
    const store = loadStore();
    assert.equal(store.version, '0.1');
    assert.deepEqual(store.entries, []);
  });

  it('版本不匹配时 fail-soft：返回空 store 并输出 stderr warning', () => {
    const dir = path.join(tmpHome, '.cortex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStorePath(), JSON.stringify({ version: '0.2', entries: [] }), 'utf-8');

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    let store;
    try {
      store = loadStore();
    } finally {
      process.stderr.write = origWrite;
    }

    assert.equal(store.version, '0.1');
    assert.deepEqual(store.entries, []);
    assert.ok(stderrChunks.some((c) => c.includes('版本不匹配')), `expected version-mismatch warning, got: ${stderrChunks.join('')}`);
  });
});
