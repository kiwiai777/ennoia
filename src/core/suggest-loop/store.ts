// CT-0021-07 — Suggest Loop v0: persistent file-based store
//
// Upgrades the in-memory UserModelStore to a JSON file at
// ~/.cortex/suggest-loop-store.json.  Isolated from main
// ~/.cortex/user_model.json per DL-0020.
//
// Atomic write: tmp file + rename.
// Read fail-soft: corrupt / missing → empty store + stderr warning.
// Write fail-soft: error → stderr warning, caller continues.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { UserModelEntry } from './confirmSuggestion.js';

export interface PersistedStore {
  version: '0.1';
  entries: UserModelEntry[];
}

// Dynamic path so process.env.HOME overrides work in tests.
export function getStorePath(): string {
  return path.join(os.homedir(), '.cortex', 'suggest-loop-store.json');
}

function ensureDir(): void {
  const dir = path.join(os.homedir(), '.cortex');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadStore(): PersistedStore {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return { version: '0.1', entries: [] };
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).version === '0.1' &&
      Array.isArray((parsed as Record<string, unknown>).entries)
    ) {
      return parsed as PersistedStore;
    }
  } catch {
    process.stderr.write('[suggest-loop] 警告：store 文件损坏，将初始化为空 store\n');
  }
  return { version: '0.1', entries: [] };
}

function saveStore(store: PersistedStore): void {
  ensureDir();
  const storePath = getStorePath();
  const json = JSON.stringify(store, null, 2) + '\n';
  const tmpPath = `${storePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, storePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // cleanup failure doesn't mask original error
    }
    throw err;
  }
}

export function appendEntry(entry: UserModelEntry): void {
  const store = loadStore();
  store.entries.push(entry);
  try {
    saveStore(store);
  } catch {
    process.stderr.write('[suggest-loop] 警告：store 写入失败，条目未持久化\n');
  }
}
