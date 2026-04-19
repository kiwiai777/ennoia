// CT-0010 测试：Claude Code adapter projector
//
// 运行方式：
//   npm test
//
// 覆盖目标：
//   1. 返回结构完整的 ClaudeCodeProjection（agent / pack_version / sections / instruction_text / entry_count）
//   2. instruction_text 包含 XML 包装标签
//   3. 有数据的 bucket 产生对应 section
//   4. 空 user model → 无 sections，输出仍稳定
//   5. decision_rule 有 when/then → 使用结构化格式
//   6. decision_rule 无 when/then → 回退到 content
//   7. 部分 bucket 为空时不产生对应 section（不崩溃）
//   8. entry_count 与 pack.user_summary.total_entries 一致

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emptyUserModel, type UserModel } from '../../../core/user-model/types.js';
import { buildInjectionPack } from '../../../core/runtime/injection-pack.js';
import {
  projectPackForClaudeCode,
  type ClaudeCodeProjection,
} from '../projector.js';

function now(): string {
  return new Date().toISOString();
}

function makeFullModel(): UserModel {
  const t = now();
  const model = emptyUserModel();
  model.projects.push({
    id: 'p1',
    label: 'Cortex',
    description: 'cross-agent user model layer',
    status: 'active',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });
  model.goals.push({
    id: 'g1',
    label: '推进 Cortex',
    horizon: 'mid',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });
  model.preferences.push({
    id: 'pref1',
    label: '中文沟通',
    applies_to: 'all-agents',
    created_at: t,
    updated_at: t,
  });
  model.constraints.push({
    id: 'c1',
    label: '避免单点依赖',
    severity: 'hard',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });
  model.skills.push({
    id: 'sk1',
    label: 'TypeScript',
    level: 'advanced',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });
  model.states.push({
    id: 'st1',
    label: '专注 Cortex MVP',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });
  model.decision_rules.push({
    id: 'dr1',
    label: '遇到架构分歧时，选择更小的范围',
    when: '遇到架构分歧',
    then: '选择更小的范围',
    source: 'cli:save',
    created_at: t,
    updated_at: t,
  });
  return model;
}

function buildProjection(model: UserModel): ClaudeCodeProjection {
  const pack = buildInjectionPack(model, { agent: 'claude-code' });
  return projectPackForClaudeCode(pack);
}

describe('projectPackForClaudeCode', () => {
  it('返回的 projection 包含所有顶层字段', () => {
    const proj = buildProjection(makeFullModel());

    assert.equal(proj.agent, 'claude-code');
    assert.equal(proj.pack_version, '0.1');
    assert.equal(typeof proj.generated_at, 'string');
    assert.ok(Array.isArray(proj.sections));
    assert.equal(typeof proj.instruction_text, 'string');
    assert.equal(typeof proj.entry_count, 'number');
  });

  it('instruction_text 包含 XML 包装标签', () => {
    const proj = buildProjection(makeFullModel());

    assert.ok(
      proj.instruction_text.includes('<cortex-user-model-injection>'),
      'should have opening tag'
    );
    assert.ok(
      proj.instruction_text.includes('</cortex-user-model-injection>'),
      'should have closing tag'
    );
  });

  it('有数据的每种 bucket 都产生对应 section', () => {
    const proj = buildProjection(makeFullModel());

    const kinds = proj.sections.map((s) => s.kind);
    assert.ok(kinds.includes('project'), 'should have project section');
    assert.ok(kinds.includes('goal'), 'should have goal section');
    assert.ok(kinds.includes('preference'), 'should have preference section');
    assert.ok(kinds.includes('constraint'), 'should have constraint section');
    assert.ok(kinds.includes('skill'), 'should have skill section');
    assert.ok(kinds.includes('state'), 'should have state section');
    assert.ok(kinds.includes('decision_rule'), 'should have decision_rule section');
  });

  it('每个 section 有 heading / entries / rendered_lines', () => {
    const proj = buildProjection(makeFullModel());

    for (const section of proj.sections) {
      assert.equal(typeof section.heading, 'string');
      assert.ok(section.heading.length > 0);
      assert.ok(Array.isArray(section.entries));
      assert.ok(Array.isArray(section.rendered_lines));
      assert.equal(section.entries.length, section.rendered_lines.length);
    }
  });

  it('空 user model → 无 sections，projection 仍合法', () => {
    const proj = buildProjection(emptyUserModel());

    assert.equal(proj.sections.length, 0);
    assert.equal(proj.entry_count, 0);
    assert.ok(proj.instruction_text.includes('<cortex-user-model-injection>'));
  });

  it('decision_rule 有 when/then details → content 保留且附加结构化注解', () => {
    const proj = buildProjection(makeFullModel());

    const drSection = proj.sections.find((s) => s.kind === 'decision_rule');
    assert.ok(drSection, 'decision_rule section should exist');

    const line = drSection.rendered_lines[0];
    // content（label）必须出现，语义不能丢
    assert.ok(
      line.includes('遇到架构分歧'),
      `expected content/label in output, got: ${line}`
    );
    // when/then 注解附在后面
    assert.ok(
      line.includes('当：') && line.includes('→ 则：'),
      `expected structured annotation, got: ${line}`
    );
  });

  it('decision_rule 无 when/then → 回退到 content', () => {
    const t = now();
    const model = emptyUserModel();
    model.decision_rules.push({
      id: 'dr2',
      label: '简单规则',
      source: 'cli:save',
      created_at: t,
      updated_at: t,
    });

    const proj = buildProjection(model);
    const drSection = proj.sections.find((s) => s.kind === 'decision_rule');
    assert.ok(drSection, 'decision_rule section should exist');

    const line = drSection.rendered_lines[0];
    assert.ok(
      line.startsWith('  - '),
      `expected fallback format starting with "  - ", got: ${line}`
    );
    assert.ok(
      !line.includes('当：'),
      `should not have structured format without when/then`
    );
  });

  it('部分 bucket 为空时不产生空 section（稳定性）', () => {
    const t = now();
    const model = emptyUserModel();
    // 只有 goal，其他都空
    model.goals.push({
      id: 'g1',
      label: '目标 A',
      source: 'cli:save',
      created_at: t,
      updated_at: t,
    });

    const proj = buildProjection(model);
    assert.equal(proj.sections.length, 1);
    assert.equal(proj.sections[0].kind, 'goal');
    assert.equal(proj.entry_count, 1);
  });

  it('entry_count 与 pack 的 total_entries 一致', () => {
    const model = makeFullModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code' });
    const proj = projectPackForClaudeCode(pack);

    assert.equal(proj.entry_count, pack.user_summary.total_entries);
  });
});
