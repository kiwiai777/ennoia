// CT-0011 测试：Scoped / Task-Aware Selection Foundation
//
// 覆盖目标：
//   1. 无 scope / task-hint 时保持默认 'all' 行为
//   2. 有 scope 时 selected entries 发生变化（只含匹配项目及关联条目）
//   3. 有 task-hint 时 selected entries 发生变化
//   4. text / json / claude-code projector 三条路径共享 selection 结果
//   5. open_questions 至少有最小真实场景覆盖
//   6. 空模型 / 部分 bucket / 多候选冲突场景稳定
//   7. CLI --scope / --task-hint 参数正确透传

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { emptyUserModel, type UserModel } from '../../user-model/types.js';
import { selectRuntimeContext } from '../context.js';
import { buildInjectionPack } from '../injection-pack.js';
import { createInjectionPackage } from '../injection.js';
import { projectPackForClaudeCode } from '../../../adapters/claude-code/projector.js';
import { cmdInject } from '../../../index.js';

function nowIso(): string {
  return new Date().toISOString();
}

// model with two projects and project-scoped items
function makeScopedModel(): UserModel {
  const t = nowIso();
  const model = emptyUserModel();

  model.projects.push({
    id: 'proj-cortex',
    label: 'Cortex',
    description: 'cross-agent user model layer',
    status: 'active',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });
  model.projects.push({
    id: 'proj-infra',
    label: 'Infra',
    description: 'infrastructure work',
    status: 'active',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });

  // Goal scoped to Cortex project
  model.goals.push({
    id: 'g-cortex',
    label: '推进 Cortex injection',
    scope: 'proj-cortex',
    created_at: t,
    updated_at: t,
  });

  // Goal scoped to Infra project
  model.goals.push({
    id: 'g-infra',
    label: '完成 infra 迁移',
    scope: 'proj-infra',
    created_at: t,
    updated_at: t,
  });

  // Global goal (no scope)
  model.goals.push({
    id: 'g-global',
    label: '学习 TypeScript 高级特性',
    scope: 'global',
    created_at: t,
    updated_at: t,
  });

  // Preferences always included
  model.preferences.push({
    id: 'pref1',
    label: '中文沟通',
    created_at: t,
    updated_at: t,
  });

  // Constraints always included
  model.constraints.push({
    id: 'c1',
    label: '避免单点依赖',
    severity: 'hard',
    created_at: t,
    updated_at: t,
  });

  // Skill
  model.skills.push({
    id: 'sk1',
    label: 'TypeScript',
    level: 'advanced',
    created_at: t,
    updated_at: t,
  });

  // State scoped to Cortex
  model.states.push({
    id: 'st1',
    label: '正在做 CT-0011',
    scope: 'proj-cortex',
    created_at: t,
    updated_at: t,
  });

  // Decision rule
  model.decision_rules.push({
    id: 'r1',
    label: '默认走 SSH',
    when: '需要操作 git remote',
    then: '使用 SSH 而不是 HTTPS',
    created_at: t,
    updated_at: t,
  });

  return model;
}

// --- selectRuntimeContext ---

describe('CT-0011: selectRuntimeContext — 无 scope/taskHint 保持 all', () => {
  it('strategy 为 all，entry 数与原模型一致', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model);
    assert.equal(ctx.meta.selection_strategy, 'all');
    assert.equal(ctx.user_snapshot.projects.length, 2);
    assert.equal(ctx.user_snapshot.goals.length, 3);
    assert.deepEqual(ctx.open_questions, []);
  });

  it('空模型时 all 策略稳定，open_questions 为空', () => {
    const model = emptyUserModel();
    const ctx = selectRuntimeContext(model);
    assert.equal(ctx.meta.selection_strategy, 'all');
    assert.deepEqual(ctx.open_questions, []);
    assert.equal(ctx.meta.total_model_entries, 0);
    assert.equal(ctx.meta.selected_entries, 0);
  });
});

describe('CT-0011: selectRuntimeContext — scope 过滤', () => {
  it('scope 命中单个项目时，只选该项目及其关联条目', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
    assert.equal(ctx.meta.selection_strategy, 'scoped');
    assert.equal(ctx.user_snapshot.projects.length, 1);
    assert.equal(ctx.user_snapshot.projects[0].id, 'proj-cortex');
    // Only cortex-scoped goal + global goal; NOT infra goal
    const goalIds = ctx.user_snapshot.goals.map((g) => g.id);
    assert.ok(goalIds.includes('g-cortex'), 'should include cortex goal');
    assert.ok(goalIds.includes('g-global'), 'should include global goal');
    assert.ok(!goalIds.includes('g-infra'), 'should NOT include infra goal');
  });

  it('preferences / constraints / decision_rules 全量保留（全局上下文）', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
    assert.equal(ctx.user_snapshot.preferences.length, 1);
    assert.equal(ctx.user_snapshot.constraints.length, 1);
    assert.equal(ctx.user_snapshot.decision_rules.length, 1);
  });

  it('scope 匹配大小写不敏感', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { scope: 'cortex' });
    assert.equal(ctx.user_snapshot.projects.length, 1);
    assert.equal(ctx.user_snapshot.projects[0].id, 'proj-cortex');
  });

  it('scope 未命中任何项目 → open_questions 非空，返回全量项目', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { scope: 'nonexistent-xyz' });
    assert.equal(ctx.meta.selection_strategy, 'scoped');
    assert.ok(ctx.open_questions.length > 0, 'should have open questions');
    assert.ok(
      ctx.open_questions[0].includes('nonexistent-xyz'),
      'open_question should mention the scope'
    );
    // Falls back to all projects
    assert.equal(ctx.user_snapshot.projects.length, 2);
  });

  it('scope 匹配多个项目 → open_questions 含多候选提示', () => {
    const t = nowIso();
    const model = emptyUserModel();
    model.projects.push(
      { id: 'p1', label: 'Cortex Alpha', created_at: t, updated_at: t },
      { id: 'p2', label: 'Cortex Beta', created_at: t, updated_at: t }
    );
    const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
    assert.ok(ctx.open_questions.some((q) => q.includes('多个项目')));
  });

  it('meta 体现 scope / matched_project_ids', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
    assert.equal(ctx.meta.scope, 'Cortex');
    assert.ok(Array.isArray(ctx.meta.matched_project_ids));
    assert.ok(ctx.meta.matched_project_ids!.includes('proj-cortex'));
  });

  it('meta.total_model_entries 与 selected_entries 不同（scoped < all）', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
    assert.ok(ctx.meta.selected_entries < ctx.meta.total_model_entries);
  });
});

describe('CT-0011: selectRuntimeContext — task-hint 过滤', () => {
  it('task-hint 命中 goal label 时该条目被选入，未命中条目被排除', () => {
    const model = makeScopedModel();
    // 'injection' matches '推进 Cortex injection'（g-cortex）
    // 不匹配 '完成 infra 迁移'（g-infra）或 '学习 TypeScript 高级特性'（g-global）
    const ctx = selectRuntimeContext(model, { taskHint: 'injection' });
    assert.equal(ctx.meta.selection_strategy, 'scoped');
    const goalIds = ctx.user_snapshot.goals.map((g) => g.id);
    assert.ok(goalIds.includes('g-cortex'), 'hint-matched goal should be included');
    assert.ok(!goalIds.includes('g-infra'), 'non-matched goal should be EXCLUDED');
    assert.ok(!goalIds.includes('g-global'), 'non-matched global goal should be EXCLUDED');
  });

  it('task-hint 单独使用时 selected_entries < total_model_entries（真实缩小）', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { taskHint: 'injection' });
    assert.ok(
      ctx.meta.selected_entries < ctx.meta.total_model_entries,
      `selected(${ctx.meta.selected_entries}) should be less than total(${ctx.meta.total_model_entries})`
    );
  });

  it('task-hint 无匹配时 open_questions 包含未命中提示', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { taskHint: 'zzznomatch999' });
    assert.ok(
      ctx.open_questions.some((q) => q.includes('task-hint')),
      'should warn about unmatched task-hint'
    );
  });

  it('scope + task-hint 叠加：两者条件都参与选择', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { scope: 'Infra', taskHint: 'TypeScript' });
    assert.equal(ctx.meta.selection_strategy, 'scoped');
    const goalIds = ctx.user_snapshot.goals.map((g) => g.id);
    // infra scope → g-infra + g-global
    assert.ok(goalIds.includes('g-infra'));
    // TypeScript hint → g-global contains 'TypeScript'
    assert.ok(goalIds.includes('g-global'));
  });

  it('meta.task_hint 体现传入值', () => {
    const model = makeScopedModel();
    const ctx = selectRuntimeContext(model, { taskHint: 'injection' });
    assert.equal(ctx.meta.task_hint, 'injection');
  });
});

// --- buildInjectionPack with scope/taskHint ---

describe('CT-0011: buildInjectionPack — scope/taskHint 透传', () => {
  it('有 scope 时 pack.source.selection_strategy 为 scoped', () => {
    const model = makeScopedModel();
    const pack = buildInjectionPack(model, { scope: 'Cortex' });
    assert.equal(pack.source.selection_strategy, 'scoped');
    assert.equal(pack.source.scope, 'Cortex');
  });

  it('有 scope 时 entries 只含命中项目相关条目（比 all 少）', () => {
    const model = makeScopedModel();
    const allPack = buildInjectionPack(model);
    const scopedPack = buildInjectionPack(model, { scope: 'Cortex' });
    assert.ok(scopedPack.entries.length < allPack.entries.length);
  });

  it('无 scope/taskHint 时 open_questions 仍为空', () => {
    const model = makeScopedModel();
    const pack = buildInjectionPack(model);
    assert.deepEqual(pack.open_questions, []);
  });

  it('scope 未命中时 open_questions 非空', () => {
    const model = makeScopedModel();
    const pack = buildInjectionPack(model, { scope: 'nonexistent' });
    assert.ok(pack.open_questions.length > 0);
  });

  it('pack.source.task_hint 体现传入值', () => {
    const model = makeScopedModel();
    const pack = buildInjectionPack(model, { taskHint: 'injection' });
    assert.equal(pack.source.task_hint, 'injection');
  });

  it('空模型 + scope 不崩溃，open_questions 含未命中提示', () => {
    const model = emptyUserModel();
    const pack = buildInjectionPack(model, { scope: 'anything' });
    assert.ok(pack.open_questions.length > 0);
    assert.equal(pack.entries.length, 0);
  });
});

// --- 三条路径共享同一 selection 结果 ---

describe('CT-0011: 三条输出路径共享 selection 结果', () => {
  it('json path 与 projector path entry_count 一致（同一 scope）', () => {
    const model = makeScopedModel();
    const scope = 'Cortex';

    const jsonPack = buildInjectionPack(model, { scope });
    const projection = projectPackForClaudeCode(jsonPack);

    assert.equal(
      projection.entry_count,
      jsonPack.user_summary.total_entries,
      'projector entry_count should match json pack total_entries'
    );
  });

  it('json path 与 text path（generic）选择结果 snapshot 条目数一致', () => {
    const model = makeScopedModel();
    const scope = 'Cortex';

    const jsonPack = buildInjectionPack(model, { scope });
    const textPkg = createInjectionPackage(model, 'generic', { scope });

    // Both go through selectRuntimeContext with same scope → same snapshot counts
    const jsonGoals = jsonPack.goals.length;
    const textGoals = textPkg.user_snapshot.goals.length;
    assert.equal(jsonGoals, textGoals, 'json and text paths should select same goals');
  });

  it('scoped json pack 的 projects bucket 只含匹配项目', () => {
    const model = makeScopedModel();
    const pack = buildInjectionPack(model, { scope: 'Cortex' });
    assert.equal(pack.projects.length, 1);
    assert.equal(pack.projects[0].id, 'proj-cortex');
  });

  it('all 三条路径在无 scope 时行为与之前一致（regression）', () => {
    const model = makeScopedModel();

    const jsonPack = buildInjectionPack(model);
    assert.equal(jsonPack.source.selection_strategy, 'all');
    assert.equal(jsonPack.entries.length, 10); // 2p+3g+1pref+1c+1sk+1st+1dr

    const projection = projectPackForClaudeCode(jsonPack);
    assert.ok(projection.entry_count > 0);

    const textPkg = createInjectionPackage(model, 'generic');
    assert.equal(typeof textPkg.instruction_text, 'string');
    assert.ok(textPkg.instruction_text.length > 0);
  });
});

// --- CLI --scope / --task-hint 参数 ---

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

function runInjectCommand(args: string[]): RunResult {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ct0011-'));
  const origHome = process.env.HOME;

  let status = 0;
  let stdout = '';
  let stderr = '';

  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;

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
  process.env.HOME = tmpHome;

  try {
    cmdInject(args);
  } catch (e) {
    if (!(e instanceof ProcessExitError)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  return { status, stdout, stderr };
}

describe('CT-0011: CLI --scope / --task-hint 参数', () => {
  it('--scope 参数解析正常，退出 0，json 输出含 scoped strategy', () => {
    const r = runInjectCommand(['--format', 'json', '--scope', 'Cortex']);
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    const source = parsed.source as Record<string, unknown>;
    // Empty user model → scope won't match, but selection_strategy is still scoped
    assert.equal(source.selection_strategy, 'scoped');
    assert.equal(source.scope, 'Cortex');
  });

  it('--task-hint 参数解析正常，退出 0，json 输出含 task_hint', () => {
    const r = runInjectCommand(['--format', 'json', '--task-hint', 'injection planning']);
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    const source = parsed.source as Record<string, unknown>;
    assert.equal(source.task_hint, 'injection planning');
  });

  it('--scope 缺少参数值 → 退出非 0，stderr 含提示', () => {
    const r = runInjectCommand(['--scope']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--scope/);
  });

  it('--task-hint 缺少参数值 → 退出非 0，stderr 含提示', () => {
    const r = runInjectCommand(['--task-hint']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--task-hint/);
  });

  it('--scope 与 --format json 组合：json 输出中 open_questions 是数组', () => {
    const r = runInjectCommand(['--format', 'json', '--scope', 'NoMatch']);
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.ok(Array.isArray(parsed.open_questions));
    // Empty model: no projects, so scope won't match → open_questions has entry
    assert.ok((parsed.open_questions as string[]).length > 0);
  });

  it('--agent claude-code --scope 组合：text 路径仍含 XML 标签', () => {
    const r = runInjectCommand(['--agent', 'claude-code', '--scope', 'Cortex']);
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('<cortex-user-model-injection>'));
  });
});
