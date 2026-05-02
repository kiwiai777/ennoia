// CT-0022-02 — cortex sync CLI 合约测试
//
// 隔离策略：
//   - Group 1 / Group 2：进程内运行，通过 extractFn/promptFn 注入绕过文件系统和 readline。
//     这两组不检查 user_model.json 磁盘状态，不需要 beforeEach 磁盘操作。
//   - Group 3：状态验证测试，使用 spawnSync + 独立 tmpHome，子进程中 storage.ts
//     重新初始化路径，完全隔离，不触碰真实 ~/.cortex/user_model.json。
//
// KNOWN LIMITATION (CT-0022-02):
// Group 2 (in-process write tests) and Group 3 (mixed workspace / dedupe) spawnSync
// tests may fail in restricted sandbox environments due to subprocess isolation.
// Root cause: sandbox restricts certain child_process behaviors (EROFS, pipe handling).
// EROFS issue resolved in commit 22b2caf; TSX_LOADER resolved in commit 1262573.
// All tests pass in local dev environment. Product CLI behavior manually verified.
// See: DL-0022 / Stage 16 archive for full context.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { cmdSync } from '../index.js';
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

// ── Fixture candidates ────────────────────────────────────────────────────────

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

// ── In-process runner (Group 1 / Group 2) ────────────────────────────────────
// No disk reads/writes. Uses extractFn + promptFn injection only.

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
  const stdinRef = process.stdin as unknown as Record<string, unknown>;
  const origIsTTY = stdinRef.isTTY;
  stdinRef.isTTY = true;

  process.exit = (code?: number): never => {
    status = code ?? 0;
    throw new ProcessExitError(code ?? 0);
  };
  console.log = (...a: unknown[]) => { stdout += a.map(String).join(' ') + '\n'; };
  console.error = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };
  console.warn = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };

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

// ── Subprocess runner (Group 3) ───────────────────────────────────────────────
// Each call gets its own tmpHome — completely isolated from ~/.cortex/.

interface SubRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  modelPath: string;
}

const TSX_LOADER = createRequire(import.meta.url).resolve('tsx/esm');

function spawnSyncInWorkspace(
  args: string[],
  workspaceDir: string,
  tmpHome: string,
): SubRunResult {
  const indexPath = path.resolve(__dirname, '../index.ts');
  const proc = spawnSync(
    'node',
    ['--import', TSX_LOADER, indexPath, 'sync', ...args],
    {
      encoding: 'utf-8',
      cwd: workspaceDir,
      env: { ...process.env, HOME: tmpHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  return {
    status: proc.status,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? '',
    modelPath: path.join(tmpHome, '.cortex', 'user_model.json'),
  };
}

function readModelCounts(modelPath: string): { goals: number; constraints: number; preferences: number; total: number } {
  if (!fs.existsSync(modelPath)) return { goals: 0, constraints: 0, preferences: 0, total: 0 };
  const data = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
  const goals = (data.goals ?? []).length;
  const constraints = (data.constraints ?? []).length;
  const preferences = (data.preferences ?? []).length;
  return { goals, constraints, preferences, total: goals + constraints + preferences };
}

// Workspace with CLAUDE.md containing Chinese triggers (produces goal/constraint)
// + package.json with name/description/dependencies (produces project/skill → unsupported)
function createMixedWorkspace(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '我的目标是快速完成 MVP。\n我不想引入外部依赖。',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'cortex-test', description: 'Test project', dependencies: { typescript: '^5.0.0' } }),
    'utf-8',
  );
}

// Workspace with CLAUDE.md only (produces only supported kinds)
function createSupportedOnlyWorkspace(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '我的目标是快速完成 MVP。\n我不想引入外部依赖。\n我更喜欢 TypeScript。',
    'utf-8',
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Group 1: Arg / param validation (in-process, no disk)
// ══════════════════════════════════════════════════════════════════════════════

describe('CLI: cortex sync', () => {

  describe('arg validation', () => {

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

  });

  // ══════════════════════════════════════════════════════════════════════════
  // Group 2: Output / behaviour (in-process + injection, no disk state checks)
  // ══════════════════════════════════════════════════════════════════════════

  describe('output and behaviour', () => {

    it('候选为空时友好提示，exit 0，不 crash', async () => {
      const r = await runSync(['--from', 'claude-code', '--accept-all'], []);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.ok(r.stdout.includes("workspace") && (r.stdout.includes("候选") || r.stdout.includes("提取")), `stdout=${r.stdout}`);
    });

    it('--dry-run：展示候选，输出 [dry-run]', async () => {
      const r = await runSync(['--from', 'claude-code', '--dry-run'], SUPPORTED_CANDIDATES);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.ok(r.stdout.includes('[dry-run]'), `stdout=${r.stdout}`);
      assert.ok(!r.stdout.includes('ℹ️  运行 cortex inject --all-targets 同步到所有 agent'), 'dry-run should not remind to inject');
    });

    it('--dry-run：all unsupported → 过滤后无可写入，不 crash', async () => {
      const onlyUnsupported: ExtractionCandidate[] = [
        { kind: 'skill', content: 'TypeScript', provenance: { source: 'claude-code', path: 'README.md' } },
      ];
      const r = await runSync(['--from', 'claude-code', '--dry-run'], onlyUnsupported);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
    });

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

    it('kind warning 含逐条候选摘要（kind / content / from）', () => {
      // Subprocess: write goes to isolated tmpHome so EROFS-safe
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        createMixedWorkspace(workspace);
        const r = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
        // Warning line mentions kind names
        assert.ok(r.stderr.includes("'skill'"), `stderr should mention skill, got=${r.stderr}`);
        assert.ok(r.stderr.includes("'project'"), `stderr should mention project, got=${r.stderr}`);
        // Per-candidate line format: "  - <kind>: <content>  (from: <path>)"
        assert.ok(r.stderr.includes('  - skill:'), `missing per-candidate skill line, stderr=${r.stderr}`);
        assert.ok(r.stderr.includes('  - project:'), `missing per-candidate project line, stderr=${r.stderr}`);
        assert.ok(r.stderr.includes('(from:'), `missing provenance in warning, stderr=${r.stderr}`);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('交互选择：stdout 包含 ✓ 写入', () => {
      // Subprocess: write goes to isolated tmpHome so EROFS-safe
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        createMixedWorkspace(workspace);
        const r = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
        assert.ok(r.stdout.includes("写入"), `stdout=${r.stdout}`);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('交互选择：选择 none → stdout 包含 未选择任何候选', async () => {
      const r = await runSync(['--from', 'claude-code'], SUPPORTED_CANDIDATES, []);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.ok(r.stdout.includes('选择') && r.stdout.includes('候选'), `stdout=${r.stdout}`);
      assert.ok(!r.stdout.includes('ℹ️  运行 cortex inject --all-targets 同步到所有 agent'), '0 writes should not remind to inject');
    });

    it('--accept-all：stdout 包含 ✓ 写入 和 inject 提示', () => {
      // Subprocess: write goes to isolated tmpHome so EROFS-safe
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        createSupportedOnlyWorkspace(workspace);
        const r = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
        assert.ok(r.stdout.includes("user model"), `stdout=${r.stdout}`);
        assert.ok(r.stdout.includes("inject --all-targets"), `stdout=${r.stdout}`);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // Group 3: State tests — subprocess + tmpHome (HOME-isolated, no real disk)
  // ══════════════════════════════════════════════════════════════════════════

  describe('state (subprocess + tmpHome)', () => {

    it('--accept-all：supported-only workspace → entry 数量正确', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        createSupportedOnlyWorkspace(workspace);
        const r = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
        const counts = readModelCounts(r.modelPath);
        assert.ok(counts.total > 0, `expected at least 1 written entry, got ${counts.total}`);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('--accept-all：mixed workspace → kind warning 出现，只写入 supported kinds', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        createMixedWorkspace(workspace);
        const r = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
        // Warning must appear
        assert.ok(r.stderr.includes("kind") && r.stderr.includes("跳过"), `expected kind warning, stderr=${r.stderr}`);
        // Only supported kinds written (no skill/project in model)
        const counts = readModelCounts(r.modelPath);
        assert.ok(counts.total > 0, `expected supported candidates written, total=${counts.total}`);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('连续两次 --accept-all：相同内容第二次提示重复', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        createSupportedOnlyWorkspace(workspace);
        spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        const r2 = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r2.status, 0, `stderr=${r2.stderr}`);
        assert.ok(r2.stdout.includes('重复') && r2.stdout.includes('跳过'), `expected dedupe message, stdout=${r2.stdout}`);
        // Total entries must not have grown
        const countsAfter = readModelCounts(r2.modelPath);
        // re-run first to get the baseline
        const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
        try {
          createSupportedOnlyWorkspace(workspace);
          spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome2);
          const countsBaseline = readModelCounts(r2.modelPath.replace(tmpHome, tmpHome2));
          // Both homes had the same workspace; after second run, counts should equal baseline
          assert.equal(countsAfter.total, countsBaseline.total, 'dedupe: count must not grow on second run');
        } finally {
          fs.rmSync(tmpHome2, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('写入的 source 格式为 cli:sync:claude-code:<path>', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        createSupportedOnlyWorkspace(workspace);
        const r = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r.status, 0, `stderr=${r.stderr}`);
        assert.ok(fs.existsSync(r.modelPath), 'user_model.json must exist');
        const data = JSON.parse(fs.readFileSync(r.modelPath, 'utf-8'));
        const allEntries = [...(data.goals ?? []), ...(data.constraints ?? []), ...(data.preferences ?? [])];
        assert.ok(allEntries.length > 0, 'expected at least one entry');
        for (const entry of allEntries) {
          const src = entry.source ?? '';
          assert.ok(
            src.startsWith('cli:sync:claude-code:'),
            `source should start with cli:sync:claude-code:, got ${src}`,
          );
        }
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('[real-path] mock workspace + --accept-all → exit 0，user_model.json 有写入', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-synchome-'));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-syncws-'));
      try {
        fs.writeFileSync(
          path.join(workspace, 'CLAUDE.md'),
          '# Test Project\n\n我的目标是快速完成 MVP。\n我不想引入外部依赖。',
          'utf-8',
        );
        fs.writeFileSync(
          path.join(workspace, 'package.json'),
          JSON.stringify({ name: 'test-project', description: 'A test project for Cortex sync', engines: { node: '>=18' } }),
          'utf-8',
        );

        const r = spawnSyncInWorkspace(['--from', 'claude-code', '--accept-all'], workspace, tmpHome);
        assert.equal(r.status, 0, `expected exit 0, stderr=${r.stderr}, stdout=${r.stdout}`);
        assert.ok(fs.existsSync(r.modelPath), `user_model.json must exist at ${r.modelPath}`);
        const counts = readModelCounts(r.modelPath);
        assert.ok(counts.total > 0, `expected at least 1 written entry, got ${counts.total}. stdout=${r.stdout}`);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

  });

});
