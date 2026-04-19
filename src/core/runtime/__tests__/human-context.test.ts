// CT-0013 测试：Human-Facing Context Alignment v0.1
//
// 覆盖目标：
//   1. all 模式下输出干净稳定（无 selection summary，无 open_questions 块）
//   2. scoped 模式下出现 selection summary（模式 / 条目计数）
//   3. scope 在 human-facing 输出中可见且语义清楚
//   4. task-hint 在 human-facing 输出中可见且语义清楚
//   5. scope + task-hint 叠加时二者都出现
//   6. open_questions 非空时以 human-facing 方式呈现（非 agent 警告格式）
//   7. open_questions 为空时不出现相关标头
//   8. human-facing selection 与 selectRuntimeContext 结果语义一致

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emptyUserModel, type UserModel } from '../../user-model/types.js';
import { selectRuntimeContext, renderContextForHuman } from '../context.js';

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
    id: 'goal-1',
    label: 'Build injection layer',
    description: 'selection-aware injection for agents',
    scope: 'proj-cortex',
    created_at: t,
    updated_at: t,
  });
  model.goals.push({
    id: 'goal-2',
    label: 'Setup CI pipeline',
    scope: 'proj-infra',
    created_at: t,
    updated_at: t,
  });

  model.preferences.push({
    id: 'pref-1',
    label: 'Minimal scope creep',
    created_at: t,
    updated_at: t,
  });

  return model;
}

describe('CT-0013 human-facing context', () => {
  describe('all 模式', () => {
    it('输出包含 [User Context] 标头', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model);
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('[User Context]'));
    });

    it('不输出 [当前上下文范围] 块', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model);
      const output = renderContextForHuman(ctx);
      assert.ok(!output.includes('[当前上下文范围]'));
    });

    it('不输出 [待确认信息] 块', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model);
      const output = renderContextForHuman(ctx);
      assert.ok(!output.includes('[待确认信息]'));
    });

    it('包含所有项目（无过滤）', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model);
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('Cortex'));
      assert.ok(output.includes('Infra'));
    });
  });

  describe('scoped 模式 — scope 命中', () => {
    it('输出包含 [当前上下文范围] 块', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('[当前上下文范围]'));
    });

    it('显示 聚焦（非全量）', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('聚焦（非全量）'));
    });

    it('显示聚焦项目名', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('聚焦项目：Cortex'));
    });

    it('显示 已选条目 / 总条目', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
      const output = renderContextForHuman(ctx);
      // selected < total because only Cortex-scoped goals are included
      assert.ok(output.includes('已选条目：'));
      const total = ctx.meta.total_model_entries;
      const selected = ctx.meta.selected_entries;
      assert.ok(output.includes(`${selected} / ${total}`));
      assert.ok(selected < total, '聚焦模式下应少于全量条目');
    });

    it('[User Context] 出现在 selection summary 之后', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
      const output = renderContextForHuman(ctx);
      const summaryPos = output.indexOf('[当前上下文范围]');
      const contentPos = output.indexOf('[User Context]');
      assert.ok(summaryPos < contentPos);
    });
  });

  describe('scoped 模式 — task-hint', () => {
    it('显示任务线索', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { taskHint: 'injection' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('任务线索：injection'));
    });

    it('不显示聚焦项目行（无 scope）', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { taskHint: 'injection' });
      const output = renderContextForHuman(ctx);
      assert.ok(!output.includes('聚焦项目：'));
    });
  });

  describe('scoped 模式 — scope + task-hint 叠加', () => {
    it('scope 和 task-hint 都出现在 summary 中', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'Cortex', taskHint: 'injection' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('聚焦项目：Cortex'));
      assert.ok(output.includes('任务线索：injection'));
    });
  });

  describe('open_questions 呈现', () => {
    it('scope 未命中时显示 [待确认信息] 块', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'nonexistent-xyz' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('[待确认信息]'));
    });

    it('[待确认信息] 不含 ⚠️（agent 警告格式不用于 human-facing）', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'nonexistent-xyz' });
      const output = renderContextForHuman(ctx);
      // The human-facing block should not start with the agent ⚠️ header
      assert.ok(!output.includes('⚠️ 待确认问题'));
    });

    it('包含 "供参考，不影响执行" 的克制措辞', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'nonexistent-xyz' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('不影响执行'));
    });

    it('open_questions 内容出现在 [待确认信息] 块中', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'nonexistent-xyz' });
      const output = renderContextForHuman(ctx);
      // The actual question text from CT-0011 selection
      assert.ok(ctx.open_questions.length > 0);
      assert.ok(output.includes(ctx.open_questions[0]));
    });

    it('open_questions 为空时不输出 [待确认信息] 块', () => {
      const model = makeModel();
      // Cortex matches exactly one project → no open_questions
      const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
      const output = renderContextForHuman(ctx);
      assert.strictEqual(ctx.open_questions.length, 0);
      assert.ok(!output.includes('[待确认信息]'));
    });

    it('[待确认信息] 出现在内容区之后', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'nonexistent-xyz' });
      const output = renderContextForHuman(ctx);
      const contentPos = output.indexOf('[User Context]');
      const oqPos = output.indexOf('[待确认信息]');
      assert.ok(contentPos < oqPos);
    });
  });

  describe('语义一致性', () => {
    it('human-facing selected_entries 与 selectRuntimeContext meta 一致', () => {
      const model = makeModel();
      const ctx = selectRuntimeContext(model, { scope: 'Cortex' });
      const output = renderContextForHuman(ctx);
      assert.ok(
        output.includes(`${ctx.meta.selected_entries} / ${ctx.meta.total_model_entries}`)
      );
    });

    it('空模型 all 模式稳定', () => {
      const model = emptyUserModel();
      const ctx = selectRuntimeContext(model);
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('[User Context]'));
      assert.ok(!output.includes('[当前上下文范围]'));
    });

    it('空模型 scoped 模式稳定', () => {
      const model = emptyUserModel();
      const ctx = selectRuntimeContext(model, { scope: 'anything' });
      const output = renderContextForHuman(ctx);
      assert.ok(output.includes('[当前上下文范围]'));
      // scope with no projects → open_questions populated
      assert.ok(output.includes('[待确认信息]'));
    });
  });
});
