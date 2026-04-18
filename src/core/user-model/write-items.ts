// User Model 共享写入层（CT-0005）
//
// 目的：把 import / suggest 两条路径共同需要的写入语义收敛到一处，避免
// 写入规则随入口增加而发散。任何第三类写入入口都应先构造
// WriteableItem[]，再调用 writeItemsToUserModel，而不是各自重写。
//
// 本层负责：
//   - 按目标类别 + normalize(label) 做 against-model dedupe
//     （含：与现有 user model 比对 + 同一 batch 内部比对）
//   - 把待写入项映射成 UserModel 的 goal / constraint / preference 条目
//   - 更新 meta.sources（仅包含本次真正写入成功的 source）
//   - 更新 meta.last_updated（仅在本次至少写入 1 条时）
//   - 返回写入 / 跳过的计数与原始项，供 CLI 直接消费
//
// 本层不负责：
//   - 提取 / 建议 / 用户交互
//   - project / skill / state / decision_rule（本轮范围不含）
//   - 锁 / CAS / 并发协调（延续 storage.ts 的语义）
//
// 归一化规则：`trim → 折叠空白 → 小写`，与 CT-0003-FIX 一致。不做语义 /
// 模糊相似度匹配。

import { randomUUID } from 'node:crypto';

import { updateUserModel } from './storage.js';
import type {
  Constraint,
  Goal,
  Preference,
  UserModel,
} from './types.js';

// 当前可写入的三个类别（user model 的数组字段名）。
// 未来若扩到 skills / states / decision_rules，需要同步扩展类型 + 映射。
export type WriteTarget = 'goals' | 'constraints' | 'preferences';

// 单数类别名（extraction / suggestion 层使用）→ 复数 target（user model
// 数组字段名）的映射。两个调用层都会用到，导出以避免分别维护。
export type WriteCategory = 'goal' | 'constraint' | 'preference';

export function targetFromCategory(c: WriteCategory): WriteTarget {
  if (c === 'goal') return 'goals';
  if (c === 'constraint') return 'constraints';
  return 'preferences';
}

export interface WriteableItem {
  target: WriteTarget;
  label: string;
  source: string;
}

export interface WriteResult {
  written: number;
  skipped: number;
  writtenItems: WriteableItem[];
  skippedItems: WriteableItem[];
}

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// 根据 target（复数）推导 id 前缀（单数），保持与 CT-0003 / CT-0004
// 之前各自拼装时相同的命名：goal_ / constraint_ / preference_。
const ID_PREFIX: Record<WriteTarget, string> = {
  goals: 'goal',
  constraints: 'constraint',
  preferences: 'preference',
};

function pushByTarget(
  model: UserModel,
  target: WriteTarget,
  item: Goal | Constraint | Preference
): void {
  if (target === 'goals') {
    model.goals.push(item as Goal);
  } else if (target === 'constraints') {
    model.constraints.push(item as Constraint);
  } else {
    model.preferences.push(item as Preference);
  }
}

// 统一写入入口。
//
// 语义：
//   - items 为空时，零副作用返回空结果（不触发 updateUserModel）。
//   - 每一项按 (target, normalize(label)) 对 `现有 model + 本 batch 已写入`
//     双向去重；命中重复则跳过，保留其余写入。
//   - 写入项生成 id / 时间戳 / source 等字段；scope 固定为 'global'
//     （与 CT-0002 以来的 CLI 写入保持一致）。
//   - meta.sources 仅追加本次实际写入的 source 字符串；全部被跳过的
//     source 不会污染 meta.sources。
//   - meta.last_updated 仅在至少写入 1 条时更新。
//
// 返回的 writtenItems / skippedItems 保留与输入相同的引用与顺序，
// 调用方可直接用于 CLI 打印。
export function writeItemsToUserModel(
  items: WriteableItem[]
): WriteResult {
  const written: WriteableItem[] = [];
  const skipped: WriteableItem[] = [];

  if (items.length === 0) {
    return { written: 0, skipped: 0, writtenItems: written, skippedItems: skipped };
  }

  const now = new Date().toISOString();

  updateUserModel((model) => {
    // 每个类别起始归一化集合来自当前 model；写入后就地 add，保证
    // 同 batch 内的重复也会被跳过。
    const normSets: Record<WriteTarget, Set<string>> = {
      goals: new Set(model.goals.map((i) => normalizeLabel(i.label))),
      constraints: new Set(
        model.constraints.map((i) => normalizeLabel(i.label))
      ),
      preferences: new Set(
        model.preferences.map((i) => normalizeLabel(i.label))
      ),
    };

    const sourcesAdded = new Set<string>();

    for (const item of items) {
      const norm = normalizeLabel(item.label);

      if (normSets[item.target].has(norm)) {
        skipped.push(item);
        continue;
      }
      normSets[item.target].add(norm);

      const entry: Goal | Constraint | Preference = {
        id: `${ID_PREFIX[item.target]}_${randomUUID()}`,
        label: item.label,
        scope: 'global',
        source: item.source,
        created_at: now,
        updated_at: now,
      };

      pushByTarget(model, item.target, entry);
      sourcesAdded.add(item.source);
      written.push(item);
    }

    if (written.length > 0) {
      model.meta.last_updated = now;
      for (const s of sourcesAdded) {
        if (!model.meta.sources.includes(s)) {
          model.meta.sources.push(s);
        }
      }
    }
  });

  return {
    written: written.length,
    skipped: skipped.length,
    writtenItems: written,
    skippedItems: skipped,
  };
}
