// CT-0009 测试：Structured Injection Pack v0.1
//
// 运行方式：
//   ./node_modules/.bin/tsx --test src/core/runtime/__tests__/*.test.ts
// 或者通过 npm script:
//   npm test
//
// 覆盖目标：
//   1. cortex inject 默认仍输出 text（renderer 路径不变）
//   2. structured/json 输出是合法 JSON
//   3. pack 含关键字段：version / generated_at / instructions / entries
//   4. user model 某些类型为空时，pack 输出仍稳定（空数组而非缺失）
//   5. text render 与 structured output 职责分离（互不依赖）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emptyUserModel, type UserModel } from '../../user-model/types.js';
import { createInjectionPackage } from '../injection.js';
import {
  buildInjectionPack,
  serializeInjectionPack,
  INJECTION_PACK_VERSION,
} from '../injection-pack.js';

function nowIso(): string {
  return new Date().toISOString();
}

function makeRichModel(): UserModel {
  const t = nowIso();
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
    created_at: t,
    updated_at: t,
  });
  model.skills.push({
    id: 's1',
    label: 'TypeScript',
    level: 'advanced',
    created_at: t,
    updated_at: t,
  });
  model.states.push({
    id: 'st1',
    label: '正在做 CT-0009',
    valid_until: '2026-12-31T00:00:00Z',
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

describe('Structured Injection Pack v0.1', () => {
  it('CT-0008 text 路径仍输出 instruction_text（默认行为兼容）', () => {
    const model = makeRichModel();
    const pkg = createInjectionPackage(model, 'generic');
    assert.equal(pkg.format, 'text');
    assert.equal(typeof pkg.instruction_text, 'string');
    assert.ok(pkg.instruction_text.length > 0);
    // 文本路径不应当包含 JSON pack 的标志字段
    assert.ok(!pkg.instruction_text.includes('"version"'));
  });

  it('serializeInjectionPack 输出合法 JSON', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model, { agent: 'generic' });
    const serialized = serializeInjectionPack(pack);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    assert.equal(parsed.version, INJECTION_PACK_VERSION);
  });

  it('pack 顶层含 version / generated_at / instructions / entries', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code' });

    assert.equal(pack.version, '0.1');
    assert.equal(typeof pack.generated_at, 'string');
    assert.ok(!Number.isNaN(Date.parse(pack.generated_at)));

    assert.ok(Array.isArray(pack.entries));
    assert.equal(pack.entries.length, 7);

    assert.ok(pack.instructions);
    assert.equal(typeof pack.instructions.text, 'string');
    assert.ok(pack.instructions.text.length > 0);
    assert.ok(Array.isArray(pack.instructions.notes));
    assert.ok(pack.instructions.notes.length > 0);
  });

  it('source / user_summary 元信息正确', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model, { agent: 'claude-code' });

    assert.equal(pack.source.generator, 'cortex');
    assert.equal(pack.source.agent, 'claude-code');
    assert.equal(pack.source.selection_strategy, 'all');
    assert.equal(pack.source.user_model_schema_version, '0.2');

    assert.equal(pack.user_summary.total_entries, 7);
    assert.equal(pack.user_summary.counts.project, 1);
    assert.equal(pack.user_summary.counts.goal, 1);
    assert.equal(pack.user_summary.counts.preference, 1);
    assert.equal(pack.user_summary.counts.constraint, 1);
    assert.equal(pack.user_summary.counts.skill, 1);
    assert.equal(pack.user_summary.counts.state, 1);
    assert.equal(pack.user_summary.counts.decision_rule, 1);
  });

  it('每个 entry 至少含 id / kind / content / confirmed / 时间戳', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model);
    for (const e of pack.entries) {
      assert.equal(typeof e.id, 'string');
      assert.ok(e.id.length > 0);
      assert.ok(
        ['project', 'goal', 'preference', 'constraint', 'skill', 'state', 'decision_rule'].includes(
          e.kind
        )
      );
      assert.equal(typeof e.content, 'string');
      assert.ok(e.content.length > 0);
      assert.equal(e.confirmed, true);
      assert.equal(typeof e.created_at, 'string');
      assert.equal(typeof e.updated_at, 'string');
    }
  });

  it('decision_rule 的 when/then 在 details 中保留', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model);
    const rule = pack.decision_rules[0];
    assert.ok(rule);
    assert.deepEqual(rule.details, {
      when: '需要操作 git remote',
      then: '使用 SSH 而不是 HTTPS',
    });
  });

  it('description 折进 content（label：description）', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model);
    const project = pack.projects[0];
    assert.ok(project);
    assert.equal(project.content, 'Cortex：cross-agent user model layer');
  });

  it('provenance 来自 source 字段；未提供时为 null', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model);
    const project = pack.projects[0];
    const preference = pack.preferences[0];
    assert.equal(project.provenance, 'cli:save');
    assert.equal(preference.provenance, null);
  });

  it('buckets 与 entries 一致（派生关系）', () => {
    const model = makeRichModel();
    const pack = buildInjectionPack(model);
    const fromBuckets = [
      ...pack.projects,
      ...pack.goals,
      ...pack.preferences,
      ...pack.constraints,
      ...pack.skills,
      ...pack.states,
      ...pack.decision_rules,
    ];
    assert.equal(fromBuckets.length, pack.entries.length);
    for (const e of fromBuckets) {
      assert.ok(pack.entries.some((x) => x.id === e.id && x.kind === e.kind));
    }
  });

  it('空 user model 输出稳定：所有 bucket 是空数组而非 null', () => {
    const model = emptyUserModel();
    const pack = buildInjectionPack(model);
    assert.equal(pack.entries.length, 0);
    assert.deepEqual(pack.projects, []);
    assert.deepEqual(pack.goals, []);
    assert.deepEqual(pack.preferences, []);
    assert.deepEqual(pack.constraints, []);
    assert.deepEqual(pack.skills, []);
    assert.deepEqual(pack.states, []);
    assert.deepEqual(pack.decision_rules, []);
    assert.deepEqual(pack.open_questions, []);
    assert.equal(pack.user_summary.total_entries, 0);
    // serialization on empty model 仍合法
    const parsed = JSON.parse(serializeInjectionPack(pack));
    assert.equal(parsed.version, '0.1');
  });

  it('部分类型为空时不报错且其他类型仍正确', () => {
    const t = nowIso();
    const model = emptyUserModel();
    model.goals.push({
      id: 'g-only',
      label: '只剩 goal',
      created_at: t,
      updated_at: t,
    });
    const pack = buildInjectionPack(model);
    assert.equal(pack.user_summary.total_entries, 1);
    assert.equal(pack.goals.length, 1);
    assert.equal(pack.projects.length, 0);
    assert.equal(pack.preferences.length, 0);
  });

  it('text 渲染与 structured pack 互不依赖（修改一边不会污染另一边）', () => {
    const model = makeRichModel();
    const pkg = createInjectionPackage(model, 'generic');
    const pack = buildInjectionPack(model, { agent: 'generic' });

    // 两条路径产生的对象类型不同：text 路径核心是 instruction_text 字符串，
    // structured 路径核心是 entries 数组；它们都基于 user model 派生但互不引用。
    assert.equal(typeof pkg.instruction_text, 'string');
    assert.ok(Array.isArray(pack.entries));

    // 改 pack 不应反过来改到 text instruction
    pack.entries.length = 0;
    assert.ok(pkg.instruction_text.length > 0);
  });
});
