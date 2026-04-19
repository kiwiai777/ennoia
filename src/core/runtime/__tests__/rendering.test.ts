// CT-0012 测试：Selection-Aware Injection Rendering v0.1
//
// 覆盖目标：
//   1. all 模式下 text / projector 无多余 framing 行（regression）
//   2. scoped 模式 + scope → text / projector 包含聚焦信息
//   3. scoped 模式 + task-hint → text / projector 包含任务线索
//   4. scope + task-hint 叠加 → 二者都出现
//   5. open_questions 非空时进入 text / projector 输出
//   6. open_questions 为空时不出现相关标头
//   7. raw JSON pack 结构不因本任务改变
//   8. generic text path 与 claude-code projector 各自独立模板（不共享字面量）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emptyUserModel, type UserModel } from '../../user-model/types.js';
import { createInjectionPackage } from '../injection.js';
import { buildInjectionPack, serializeInjectionPack } from '../injection-pack.js';
import { projectPackForClaudeCode } from '../../../adapters/claude-code/projector.js';

function nowIso(): string {
  return new Date().toISOString();
}

function makeModel(): UserModel {
  const t = nowIso();
  const model = emptyUserModel();
  model.projects.push({
    id: 'proj-cortex',
    label: 'Cortex',
    status: 'active',
    created_at: t,
    updated_at: t,
  });
  model.projects.push({
    id: 'proj-infra',
    label: 'Infra',
    status: 'active',
    created_at: t,
    updated_at: t,
  });
  model.goals.push({
    id: 'g1',
    label: '推进 Cortex injection',
    scope: 'proj-cortex',
    created_at: t,
    updated_at: t,
  });
  model.goals.push({
    id: 'g2',
    label: '完成 infra 迁移',
    scope: 'proj-infra',
    created_at: t,
    updated_at: t,
  });
  model.preferences.push({
    id: 'pref1',
    label: '中文沟通',
    created_at: t,
    updated_at: t,
  });
  model.constraints.push({
    id: 'c1',
    label: '避免单点依赖',
    severity: 'hard',
    created_at: t,
    updated_at: t,
  });
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

// --- generic text path ---

describe('CT-0012: generic text — all 模式无 framing', () => {
  it('all 模式下 instruction_text 不含 [注入范围] 标头', () => {
    const model = makeModel();
    const pkg = createInjectionPackage(model, 'generic');
    assert.ok(
      !pkg.instruction_text.includes('[注入范围'),
      'all mode should NOT contain selection framing'
    );
  });

  it('all 模式下不含 ⚠️ 待确认问题', () => {
    const model = makeModel();
    const pkg = createInjectionPackage(model, 'generic');
    assert.ok(!pkg.instruction_text.includes('⚠️'));
  });
});

describe('CT-0012: generic text — scope framing', () => {
  it('scope 存在时 instruction_text 含 [注入范围：聚焦 → ...]', () => {
    const model = makeModel();
    const pkg = createInjectionPackage(model, 'generic', { scope: 'Cortex' });
    assert.ok(
      pkg.instruction_text.includes('[注入范围：'),
      'scoped mode should contain selection framing'
    );
    assert.ok(
      pkg.instruction_text.includes('聚焦 → Cortex'),
      'framing should mention scope'
    );
  });

  it('task-hint 存在时 instruction_text 含 任务线索', () => {
    const model = makeModel();
    const pkg = createInjectionPackage(model, 'generic', { taskHint: 'injection planning' });
    assert.ok(pkg.instruction_text.includes('任务线索 → injection planning'));
  });

  it('scope + task-hint 叠加时二者都出现在 framing 行', () => {
    const model = makeModel();
    const pkg = createInjectionPackage(model, 'generic', {
      scope: 'Cortex',
      taskHint: 'injection',
    });
    assert.ok(pkg.instruction_text.includes('聚焦 → Cortex'));
    assert.ok(pkg.instruction_text.includes('任务线索 → injection'));
  });
});

describe('CT-0012: generic text — open_questions', () => {
  it('scope 未命中时 open_questions 进入 text 输出', () => {
    const model = makeModel();
    const pkg = createInjectionPackage(model, 'generic', { scope: 'nonexistent-xyz' });
    assert.ok(
      pkg.instruction_text.includes('⚠️'),
      'should contain open_questions header'
    );
    assert.ok(
      pkg.instruction_text.includes('nonexistent-xyz'),
      'should mention the unmatched scope'
    );
  });

  it('scope 命中多个项目时 open_questions 提示多候选', () => {
    const t = nowIso();
    const model = emptyUserModel();
    model.projects.push(
      { id: 'p1', label: 'Cortex Alpha', created_at: t, updated_at: t },
      { id: 'p2', label: 'Cortex Beta', created_at: t, updated_at: t }
    );
    const pkg = createInjectionPackage(model, 'generic', { scope: 'Cortex' });
    assert.ok(pkg.instruction_text.includes('⚠️'));
    assert.ok(pkg.instruction_text.includes('多个项目'));
  });

  it('open_questions 为空时不含 ⚠️ 标头（scope 精确命中）', () => {
    const model = makeModel();
    const pkg = createInjectionPackage(model, 'generic', { scope: 'Cortex' });
    // Cortex 精确命中单个项目 → 无 open_questions
    assert.ok(
      !pkg.instruction_text.includes('⚠️'),
      'clean scope match should NOT produce open_questions'
    );
  });
});

// --- claude-code projector path ---

describe('CT-0012: claude-code projector — all 模式无 framing', () => {
  it('all 模式下 instruction_text 不含 [注入范围] 标头', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code' });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(!proj.instruction_text.includes('[注入范围'));
  });

  it('all 模式下不含 ⚠️ 待确认问题', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code' });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(!proj.instruction_text.includes('⚠️'));
  });

  it('all 模式下 XML 包装标签仍存在（regression）', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code' });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(proj.instruction_text.includes('<cortex-user-model-injection>'));
    assert.ok(proj.instruction_text.includes('</cortex-user-model-injection>'));
  });
});

describe('CT-0012: claude-code projector — scope framing', () => {
  it('scope 存在时 instruction_text 含 [注入范围：聚焦 → ...]', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code', scope: 'Cortex' });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(proj.instruction_text.includes('[注入范围：'));
    assert.ok(proj.instruction_text.includes('聚焦 → Cortex'));
  });

  it('task-hint 存在时 instruction_text 含 任务线索', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, {
      agent: 'claude-code',
      taskHint: 'injection planning',
    });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(proj.instruction_text.includes('任务线索 → injection planning'));
  });

  it('scope + task-hint 叠加时二者都出现', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, {
      agent: 'claude-code',
      scope: 'Cortex',
      taskHint: 'injection',
    });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(proj.instruction_text.includes('聚焦 → Cortex'));
    assert.ok(proj.instruction_text.includes('任务线索 → injection'));
  });
});

describe('CT-0012: claude-code projector — open_questions', () => {
  it('scope 未命中时 open_questions 进入 projector instruction_text', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code', scope: 'nomatch' });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(proj.instruction_text.includes('⚠️'));
    assert.ok(proj.instruction_text.includes('nomatch'));
  });

  it('scope 精确命中时 projector 不含 ⚠️', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code', scope: 'Cortex' });
    const proj = projectPackForClaudeCode(pack);
    assert.ok(!proj.instruction_text.includes('⚠️'));
  });
});

// --- JSON pack 结构不变 ---

describe('CT-0012: JSON pack 结构不受影响', () => {
  it('buildInjectionPack 输出仍是合法结构化 JSON', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { agent: 'generic', scope: 'Cortex' });
    const parsed = JSON.parse(serializeInjectionPack(pack)) as Record<string, unknown>;
    assert.equal(parsed.version, '0.1');
    assert.ok(Array.isArray(parsed.entries));
    assert.ok(Array.isArray(parsed.open_questions));
    const source = parsed.source as Record<string, unknown>;
    assert.equal(source.selection_strategy, 'scoped');
    assert.equal(source.scope, 'Cortex');
  });

  it('open_questions 在 JSON 中仍是数组（不被渲染层消费后清空）', () => {
    const model = makeModel();
    const pack = buildInjectionPack(model, { scope: 'nomatch' });
    assert.ok(pack.open_questions.length > 0, 'pack.open_questions should be non-empty');
    // Render to text — pack object itself must not be mutated
    const pkg = createInjectionPackage(model, 'generic', { scope: 'nomatch' });
    assert.ok(pkg.instruction_text.includes('⚠️'));
    assert.ok(pack.open_questions.length > 0, 'pack.open_questions should still be intact');
  });
});

// --- 两条路径独立模板，但共享 selection 语义 ---

describe('CT-0012: generic text 与 projector 模板独立', () => {
  it('相同 scope 下 generic text 与 projector framing 用词不完全相同', () => {
    const model = makeModel();
    const scope = 'Cortex';

    const pkg = createInjectionPackage(model, 'generic', { scope });
    const pack = buildInjectionPack(model, { agent: 'claude-code', scope });
    const proj = projectPackForClaudeCode(pack);

    // Generic 用 "--- Cortex 长期用户模型 ---"，projector 用 XML 标签
    assert.ok(pkg.instruction_text.includes('--- Cortex 长期用户模型 ---'));
    assert.ok(!pkg.instruction_text.includes('<cortex-user-model-injection>'));
    assert.ok(proj.instruction_text.includes('<cortex-user-model-injection>'));
    assert.ok(!proj.instruction_text.includes('--- Cortex 长期用户模型 ---'));
  });

  it('相同 scope 下两条路径选择的条目数一致（共享 selection 语义）', () => {
    const model = makeModel();
    const scope = 'Cortex';

    const textPkg = createInjectionPackage(model, 'generic', { scope });
    const jsonPack = buildInjectionPack(model, { scope });

    assert.equal(
      textPkg.user_snapshot.goals.length,
      jsonPack.goals.length,
      'generic text and json pack should select same number of goals'
    );
  });
});
