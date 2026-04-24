// CT-0022-02 — cortex sync CLI 合约测试
//
// 隔离策略：
//   - user_model.json 路径由 storage.ts 在模块加载时固定（module-level const）。
//     因此直接保存/清空/恢复真实文件，而不能依赖 HOME env override。
//   - extractFn / promptFn 通过 opts 注入，绕过文件系统扫描 / readline 依赖。
//   - 真实路径集成测试（spawnSync）使用独立 tmpHome，路径在子进程中重新初始化。

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { cmdSync } from '../index.js';
import { loadUserModel, getUserModelPath } from '../core/user-model/storage.js';
import type { ExtractionCandidate } from '../core/extraction/types.js';

class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

// ── 用户模型隔离 ─────────────────────────────────────────────────────────────
// storage.ts 中的 USER_MODEL_PATH 在模块加载时固定，HOME 变更不影响它。
// 因此通过保存/清空/恢复文件本身来隔离每个测试。

let savedModelContent: string | null = null;
const MODEL_PATH = getUserModelPath();

function clearUserModel(): void {
  const dir = path.dirname(MODEL_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Write an empty user model
  const empty = {
    schema_version: '0.1',
    goals: [],
    constraints: [],
    preferences: [],
    skills: [],
    projects: [],
    states: [],
    decision_rules: [],
    meta: {
      sources: [],
      last_updated: new Date().toISOString(),
      confidence: 1.0,
    },
  };
  fs.writeFileSync(MODEL_PATH, JSON.stringify(empty, null, 2), 'utf-8');
}

function setup(): void {
  // Save current model content (may not exist)
  savedModelContent = fs.existsSync(MODEL_PATH)
    ? fs.readFileSync(MODEL_PATH, 'utf-8')
    : null;
  clearUserModel();
}

function teardown(): void {
  // Restore model
  if (savedModelContent !== null) {
    fs.writeFileSync(MODEL_PATH, savedModelContent, 'utf-8');
  } else if (fs.existsSync(MODEL_PATH)) {
    fs.unlinkSync(MODEL_PATH);
  }
}

// ── Fixture candidates ───────────────────────────────────────────────────────

const SUPPORTED_CANDIDATES: ExtractionCandidate[] = [
  {
    kind: 'goal',
    content: 'build a cross-agent user model layer',
    provenance: { source: 'claude-code', path: 'CLAUDE.md' },
  },
  {
    kind: 'constraint',
    content: 'avoid single point of failure',
    provenance: { source: 'claude-code', path: 'README.md' },
  },
  {
    kind: 'preference',
    content: 'prefer TypeScript over JavaScript',
    provenance: { source: 'claude-code', path: 'package.json' },
  },
];

const MIXED_CANDIDATES: ExtractionCandidate[] = [
  ...SUPPORTED_CANDIDATES,
  {
    kind: 'skill',
    content: 'TypeScript expert',
    provenance: { source: 'claude-code', path: '.claude/agents/coder.md' },
  },
  {
    kind: 'project',
    content: 'Cortex project',
    provenance: { source: 'claude-code', path: 'CLAUDE.md' },
  },
];

// ── Test runner helper ────────────────────────────────────────────────────────

async function runSync(
  args: string[],
  candidates: ExtractionCandidate[] = SUPPORTED_CANDIDATES,
  promptAnswerIndices: number[] = [],
): Promise<RunResult> {
  let status = 0;
  let stdout = '';
  let stderr = '';

  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  // Simulate interactive TTY so non-TTY preflight passes in injection-based tests
  const stdinRef = process.stdin as unknown as Record<string, unknown>;
  const origIsTTY = stdinRef.isTTY;
  stdinRef.isTTY = true;

  process.exit = (code?: number): never => {
    status = code ?? 0;
    throw new ProcessExitError(code ?? 0);
  };
  console.log = (...a: unknown[]) => {
    stdout += a.map(String).join(' ') + '\n';
  };
  console.error = (...a: unknown[]) => {
    stderr += a.map(String).join(' ') + '\n';
  };
  console.warn = (...a: unknown[]) => {
    stderr += a.map(String).join(' ') + '\n';
  };

  try {
    await cmdSync(args, {
      extractFn: async (_rootPath: string) => candidates,
      promptFn: async (_total: number) => promptAnswerIndices,
    });
  } catch (e) {
    if (!(e instanceof ProcessExitError)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    stdinRef.isTTY = origIsTTY;
  }

  return { status, stdout, stderr };
}

describe('CLI: cortex sync', () => {
  beforeEach(setup);
  afterEach(teardown);

  // ── fail-fast 参数校验 ──────────────────────────────────────────────────────

  it('缺少 --from → exit 1，提示用法', async () => {
    const r = await runSync([]);

    assert.equal(r.status, 1, `stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('--from'), `stderr=${r.stderr}`);
  });

  it('--from 缺值 → exit 1', async () => {
    const r = await runSync(['--from']);

    assert.equal(r.status, 1, `stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('--from'), `stderr=${r.stderr}`);
  });

  it('--from unsupported-adapter → exit 1，提示不支持', async () => {
    const r = await runSync(['--from', 'openai-copilot']);

    assert.equal(r.status, 1, `stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('不支持'), `stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('openai-copilot'), `stderr=${r.stderr}`);
  });

  it('--accept-all + --dry-run 互斥 → exit 1', async () => {
    const r = await runSync(['--from', 'claude-code', '--accept-all', '--dry-run']);

    assert.equal(r.status, 1, `stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('互斥'), `stderr=${r.stderr}`);
  });

  it('未知参数 → exit 1', async () => {
    const r = await runSync(['--from', 'claude-code', '--foo']);

    assert.equal(r.status, 1, `stderr=${r.stderr}`);
    assert.ok(r.stderr.includes('--foo'), `stderr=${r.stderr}`);
  });

  // ── --dry-run 路径 ──────────────────────────────────────────────────────────

  it('--dry-run：展示候选，不写入 user model', async () => {
    const r = await runSync(['--from', 'claude-code', '--dry-run'], SUPPORTED_CANDIDATES);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('[dry-run]'), `stdout=${r.stdout}`);

    // User model must be empty (only what clearUserModel wrote)
    const model = loadUserModel();
    assert.equal(model.goals.length, 0, 'goals must be empty after dry-run');
    assert.equal(model.constraints.length, 0, 'constraints must be empty after dry-run');
    assert.equal(model.preferences.length, 0, 'preferences must be empty after dry-run');
  });

  // ── --accept-all 路径 ───────────────────────────────────────────────────────

  it('--accept-all：写入所有 supported candidates', async () => {
    const r = await runSync(['--from', 'claude-code', '--accept-all'], SUPPORTED_CANDIDATES);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('✓ 写入'), `stdout=${r.stdout}`);

    const model = loadUserModel();
    const total = model.goals.length + model.constraints.length + model.preferences.length;
    assert.equal(total, SUPPORTED_CANDIDATES.length, `expected ${SUPPORTED_CANDIDATES.length} items written`);
  });

  it('--accept-all：写入后 user_model.json entry 数量正确', async () => {
    await runSync(['--from', 'claude-code', '--accept-all'], SUPPORTED_CANDIDATES);

    assert.ok(fs.existsSync(MODEL_PATH), 'user_model.json must exist');
    const raw = fs.readFileSync(MODEL_PATH, 'utf-8');
    const data = JSON.parse(raw);
    const total = data.goals.length + data.constraints.length + data.preferences.length;
    assert.equal(total, SUPPORTED_CANDIDATES.length);
  });

  // ── kind 过滤 + warning ──────────────────────────────────────────────────────

  it('skill/project candidates：打印 warning，只写入 supported kinds', async () => {
    const r = await runSync(['--from', 'claude-code', '--accept-all'], MIXED_CANDIDATES);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);

    // Warnings for unsupported kinds
    assert.ok(r.stderr.includes("kind 'skill'"), `stderr should mention skill, got=${r.stderr}`);
    assert.ok(r.stderr.includes("kind 'project'"), `stderr should mention project, got=${r.stderr}`);

    // Only the 3 supported candidates written
    const model = loadUserModel();
    const total = model.goals.length + model.constraints.length + model.preferences.length;
    assert.equal(total, SUPPORTED_CANDIDATES.length, `expected only ${SUPPORTED_CANDIDATES.length} items written`);
  });

  it('all candidates unsupported kinds → 过滤后无可写入，exit 0，不写入', async () => {
    const onlyUnsupported: ExtractionCandidate[] = [
      { kind: 'skill', content: 'TypeScript', provenance: { source: 'claude-code', path: 'README.md' } },
      { kind: 'project', content: 'Cortex', provenance: { source: 'claude-code', path: 'CLAUDE.md' } },
    ];
    const r = await runSync(['--from', 'claude-code', '--accept-all'], onlyUnsupported);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('过滤后无可写入'), `stdout=${r.stdout}`);

    const model = loadUserModel();
    const total = model.goals.length + model.constraints.length + model.preferences.length;
    assert.equal(total, 0);
  });

  // ── 候选为空 ────────────────────────────────────────────────────────────────

  it('候选为空时友好提示，exit 0，不 crash', async () => {
    const r = await runSync(['--from', 'claude-code', '--accept-all'], []);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('未从 workspace 中提取到候选事实'), `stdout=${r.stdout}`);

    const model = loadUserModel();
    const total = model.goals.length + model.constraints.length + model.preferences.length;
    assert.equal(total, 0);
  });

  // ── 交互选择 happy path ──────────────────────────────────────────────────────

  it('交互选择 happy path：选择部分候选，只写入选中的', async () => {
    // Select only index 0 (goal) and 2 (preference)
    const r = await runSync(['--from', 'claude-code'], SUPPORTED_CANDIDATES, [0, 2]);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('✓ 写入'), `stdout=${r.stdout}`);

    const model = loadUserModel();
    assert.equal(model.goals.length, 1, 'expected 1 goal written');
    assert.equal(model.preferences.length, 1, 'expected 1 preference written');
    assert.equal(model.constraints.length, 0, 'expected 0 constraints written');
  });

  it('交互选择：选择 none → 不写入，exit 0', async () => {
    const r = await runSync(['--from', 'claude-code'], SUPPORTED_CANDIDATES, []);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('未选择任何候选'), `stdout=${r.stdout}`);

    const model = loadUserModel();
    const total = model.goals.length + model.constraints.length + model.preferences.length;
    assert.equal(total, 0);
  });

  // ── dedupe 语义 ─────────────────────────────────────────────────────────────

  it('连续两次 --accept-all：相同内容第二次全部 skipped', async () => {
    await runSync(['--from', 'claude-code', '--accept-all'], SUPPORTED_CANDIDATES);
    const r = await runSync(['--from', 'claude-code', '--accept-all'], SUPPORTED_CANDIDATES);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('因重复已跳过'), `stdout=${r.stdout}`);

    // Total entries still SUPPORTED_CANDIDATES.length (no duplicates)
    const model = loadUserModel();
    const total = model.goals.length + model.constraints.length + model.preferences.length;
    assert.equal(total, SUPPORTED_CANDIDATES.length);
  });

  // ── provenance → source 格式 ────────────────────────────────────────────────

  it('写入的 source 格式为 cli:sync:claude-code:<path>', async () => {
    await runSync(['--from', 'claude-code', '--accept-all'], SUPPORTED_CANDIDATES);

    const model = loadUserModel();
    const allEntries = [...model.goals, ...model.constraints, ...model.preferences];
    for (const entry of allEntries) {
      const src = entry.source ?? '';
      assert.ok(
        src.startsWith('cli:sync:claude-code:'),
        `source should start with cli:sync:claude-code:, got ${src}`,
      );
    }
  });

  // ── 非 TTY 交互模式拦截 ──────────────────────────────────────────────────────

  it('非 TTY + 无 --accept-all → exit 1，提示使用 --accept-all', async () => {
    const stdinRef = process.stdin as unknown as Record<string, unknown>;
    const origIsTTY = stdinRef.isTTY;
    stdinRef.isTTY = false;

    let status = 0;
    let stderr = '';
    const origExit = process.exit;
    const origError = console.error;
    process.exit = (code?: number): never => { status = code ?? 0; throw new ProcessExitError(code ?? 0); };
    console.error = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };

    try {
      await cmdSync(['--from', 'claude-code'], {
        extractFn: async () => SUPPORTED_CANDIDATES,
        // No promptFn — tests real TTY preflight path
      });
    } catch (e) {
      if (!(e instanceof ProcessExitError)) throw e;
    } finally {
      process.exit = origExit;
      console.error = origError;
      stdinRef.isTTY = origIsTTY;
    }

    assert.equal(status, 1, 'expected exit 1');
    assert.ok(stderr.includes('--accept-all'), `expected --accept-all in stderr, got: ${stderr}`);
  });

  // ── 真实路径集成测试 ─────────────────────────────────────────────────────────

  it('[real-path] mock workspace + --accept-all → exit 0，user_model.json 有写入', () => {
    // Build a mock workspace with CLAUDE.md + package.json
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
    // Use a fresh tmpHome so the subprocess writes to an isolated model
    const tmpHomeForProc = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));

    try {
      // CLAUDE.md with hint 'plain' → plain extractor → Chinese patterns only
      // Use Chinese goal pattern to ensure extraction produces a 'goal' candidate
      fs.writeFileSync(
        path.join(tmpWorkspace, 'CLAUDE.md'),
        '# Test Project\n\n我的目标是快速完成 MVP。\n我不想引入外部依赖。',
        'utf-8',
      );
      // package.json with engines → constraint candidate
      fs.writeFileSync(
        path.join(tmpWorkspace, 'package.json'),
        JSON.stringify({ name: 'test-project', description: 'A test project for Cortex sync', engines: { node: '>=18' } }),
        'utf-8',
      );

      // Use absolute path to tsx loader so it's found regardless of cwd
      const tsxLoader = path.resolve(__dirname, '../../node_modules/tsx/dist/esm/index.cjs');
      const indexPath = path.resolve(__dirname, '../index.ts');

      const proc = spawnSync(
        'node',
        ['--import', tsxLoader, indexPath, 'sync', '--from', 'claude-code', '--accept-all'],
        {
          encoding: 'utf-8',
          cwd: tmpWorkspace,
          env: {
            ...process.env,
            HOME: tmpHomeForProc,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      const status = proc.status;
      const stdout = proc.stdout ?? '';
      const stderr = proc.stderr ?? '';

      assert.equal(status, 0, `expected exit 0, stderr=${stderr}, stdout=${stdout}`);

      // user_model.json should have at least some entries in the subprocess's HOME
      const procModelPath = path.join(tmpHomeForProc, '.cortex', 'user_model.json');
      assert.ok(fs.existsSync(procModelPath), `user_model.json must exist at ${procModelPath}`);
      const raw = fs.readFileSync(procModelPath, 'utf-8');
      const data = JSON.parse(raw);
      const total = data.goals.length + data.constraints.length + data.preferences.length;
      assert.ok(total > 0, `expected at least 1 written entry, got ${total}. stdout=${stdout}`);
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
      fs.rmSync(tmpHomeForProc, { recursive: true, force: true });
    }
  });
});
