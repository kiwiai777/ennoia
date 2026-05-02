// User Model 共享写入��（CT-0005 + CT-0027-04���
//
// 目的：�� import / suggest 两条��径共���需要的写入��义收���到一处��避免
// 写���规则��入口��加而���散。任何��三类��入入���都应先构造
// WriteableItem[]��再调�� writeItemsToUserModel，而不是各自��写。
//
// 本层��责：
//   - 按目标��别 + normalize(label) 做 against-model dedupe
//     （含���与现有 user model 比对 + 同一 batch ���部比��）
//   - CT-0027-04: embedding-based ��级 dedupe + 软���除
//   - 把待写��项映���成 UserModel ��� goal / constraint / preference ��目
//   - 更新 meta.sources（���包含本次��正写入��功的 source）
//   - 更��� meta.last_updated��仅在本��至少���入 1 条时）
//   - 返���写入 / ��过的���数与原始项，�� CLI 直接消费
//
// 本层不��责：
//   - ��取 / 建�� / 用���交互
//   - project / skill / state / decision_rule（��轮范���不含）
//   - �� / CAS / 并发协调��延续 storage.ts 的语��）
//
// 归一化规��：`trim → 折叠���白 �� 小写`，与 CT-0003-FIX 一��。不��语义 /
// 模糊��似度匹配��

import { randomUUID } from 'node:crypto';

import { updateUserModel } from './storage.js';
import type {
  Constraint,
  Goal,
  Preference,
  UserModel,
  BaseItem,
} from './types.js';
import type { EmbeddingBackend } from '../../backends/types.js';
import { compareAuthority } from './write-items-authority.js';

// 当��可写���的三个��别（user model 的数组字��名）���
// 未��若扩��� skills / states / decision_rules，��要同���扩展类型 + 映射。
export type WriteTarget = 'goals' | 'constraints' | 'preferences';

// ��数类别名��extraction / suggestion 层使���）→ 复数 target（user model
// 数��字段名）的��射。���个调��层都���用到��导出��避免���别维护。
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
  embedding?: number[];  // CT-0027-04: 来自 pipeline 的 embedding
}

export interface WriteResult {
  written: number;
  skipped: number;
  superseded: number;  // CT-0027-04: 被替��的旧���目数
  writtenItems: WriteableItem[];
  skippedItems: WriteableItem[];
}

export interface WriteOptions {
  embeddingBackend?: EmbeddingBackend;
  threshold?: number;  // embedding 相似度��值，���认 0.85
}

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// 根��� target（复数）推导 id 前缀（单数），��持与 CT-0003 / CT-0004
// 之前���自拼装��相同���命名：goal_ / constraint_ / preference_。
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

function getItemsByTarget(model: UserModel, target: WriteTarget): BaseItem[] {
  if (target === 'goals') return model.goals;
  if (target === 'constraints') return model.constraints;
  return model.preferences;
}

/**
 * 计��余弦���似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * ��较权威性��reflect > sync(deterministic) > sync(llm)
 * ��回 true 表�� newSource 更权威
 */
function compareAuthority(newSource: string, existingSource: string): boolean {
  const rank = (s: string) => {
    if (s.startsWith('cli:reflect:')) return 3;
    if (s.startsWith('cli:sync:llm:')) return 1;
    if (s.startsWith('cli:sync:')) return 2;
    return 0;
  };
  return rank(newSource) > rank(existingSource);
}

// 统一��入入���。
//
// 语义：
//   - items 为空时，��副作用返��空结果（��触发 updateUserModel）。
//   - 每��项按 (target, normalize(label)) 对 `现有 model + 本 batch 已��入`
//     双向���重；命中��复则���过，��留其���写入。
//   - CT-0027-04: 如��提供 embeddingBackend，则进行库�� embedding dedupe
//   - 写��项生�� id / ���间戳 / source 等字��；scope 固定�� 'global'
//     （与 CT-0002 以来的 CLI 写入��持一��）。
//   - meta.sources 仅追加本��实际写��的 source ��符串���全部被跳��的
//     source ���会污染 meta.sources。
//   - meta.last_updated 仅���至少写入 1 条时���新。
//
// ��回的 writtenItems / skippedItems 保���与输入相��的引用��顺序���
// 调用��可直���用于 CLI 打印。
export function writeItemsToUserModel(
  items: WriteableItem[],
  opts: WriteOptions = {}
): WriteResult {
  const written: WriteableItem[] = [];
  const skipped: WriteableItem[] = [];
  let supersededCount = 0;

  if (items.length === 0) {
    return { written: 0, skipped: 0, superseded: 0, writtenItems: written, skippedItems: skipped };
  }

  const now = new Date().toISOString();
  const threshold = opts.threshold ?? 0.85;

  updateUserModel((model) => {
    // 每个���别起始归��化集��来自���前 model；��入后���地 add，保���
    // 同 batch 内的��复也���被跳过。
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

      // 1. 文本��一化去��（保���原有逻辑）
      if (normSets[item.target].has(norm)) {
        skipped.push(item);
        continue;
      }

      // 2. Embedding ���级 dedupe（如��启用���
      let conflict: BaseItem | null = null;
      if (opts.embeddingBackend && item.embedding) {
        const existingItems = getItemsByTarget(model, item.target);
        const activeItems = existingItems.filter(i => (i.status ?? 'active') === 'active');

        for (const existing of activeItems) {
          if (!existing.embedding) continue;  // 跳过�� embedding 的条目

          const sim = cosineSimilarity(item.embedding, existing.embedding);
          if (sim >= threshold) {
            conflict = existing;
            break;
          }
        }
      }

      if (conflict) {
        // 权威性比较
        const winnerIsNew = compareAuthority(item.source, conflict.source ?? '');

        if (winnerIsNew) {
          // 新项胜��：将 conflict 标记为 superseded
          const newItemId = `${ID_PREFIX[item.target]}_${randomUUID()}`;

          conflict.status = 'superseded';
          conflict.superseded_by = newItemId;
          conflict.superseded_at = now;
          conflict.updated_at = now;

          // 写入新项
          const entry: Goal | Constraint | Preference = {
            id: newItemId,
            label: item.label,
            scope: 'global',
            source: item.source,
            created_at: now,
            updated_at: now,
            embedding: item.embedding,
            embedding_model: opts.embeddingBackend?.model,
            status: 'active',
          };

          pushByTarget(model, item.target, entry);
          normSets[item.target].add(norm);
          sourcesAdded.add(item.source);
          written.push(item);
          supersededCount++;
        } else {
          // 已有���出：跳过��项
          skipped.push(item);
        }
      } else {
        // 无���突，直接��入
        normSets[item.target].add(norm);

        const entry: Goal | Constraint | Preference = {
          id: `${ID_PREFIX[item.target]}_${randomUUID()}`,
          label: item.label,
          scope: 'global',
          source: item.source,
          created_at: now,
          updated_at: now,
          embedding: item.embedding,
          embedding_model: opts.embeddingBackend?.model,
          status: 'active',
        };

        pushByTarget(model, item.target, entry);
        sourcesAdded.add(item.source);
        written.push(item);
      }
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
    superseded: supersededCount,
    writtenItems: written,
    skippedItems: skipped,
  };
}
