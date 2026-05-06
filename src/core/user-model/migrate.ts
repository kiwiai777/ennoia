// User Model Schema Migration
// CT-0027-04: v0.1 → v0.2 自��迁移���补全 embedding 字段

import { UserModel } from './types.js';
import { EmbeddingBackend } from '../../backends/types.js';

export interface MigrationResult {
  migrated: boolean;
  itemsUpdated: number;
  error?: string;
}

/**
 * 迁移 user model 从 v0.1 到 v0.2
 *
 * 变更��
 * 1. 为��有缺��� embedding 的���目补全 embedding
 * 2. 为所有缺�� status 的条��设置 status='active'
 * 3. 为所有缺�� embedding_model ���条目设��当前 backend 的 model
 * 4. ��新 schema_version 到 '0.2'
 */
export async function migrateUserModelV0_2(
  userModel: UserModel,
  embeddingBackend: EmbeddingBackend
): Promise<UserModel> {
  // 如果已经是 v0.2，直��返回
  if (userModel.schema_version === '0.2') {
    return userModel;
  }

  console.error('ℹ️  正在���级 user model schema (v0.1 → v0.2)...');

  const allItems = [
    ...userModel.projects,
    ...userModel.goals,
    ...userModel.preferences,
    ...userModel.constraints,
    ...userModel.skills,
    ...userModel.states,
    ...userModel.decision_rules,
  ];

  let itemsUpdated = 0;
  const startTime = Date.now();

  // 批��收集��要 embed ��文本
  const itemsNeedingEmbedding = allItems.filter(item => !item.embedding);

  if (itemsNeedingEmbedding.length > 0) {
    console.error(`   补��� ${itemsNeedingEmbedding.length} 条 embedding...`);

    const texts = itemsNeedingEmbedding.map(item => item.label);

    // 使用批量 embed（��果支持）
    let embeddings: number[][];
    if (embeddingBackend.embedBatch) {
      embeddings = await embeddingBackend.embedBatch(texts);
    } else {
      // ���行 embed
      embeddings = [];
      for (let i = 0; i < texts.length; i++) {
        if (i > 0 && i % 10 === 0) {
          console.error(`   ���度: ${i}/${texts.length}...`);
        }
        embeddings.push(await embeddingBackend.embed(texts[i]));
      }
    }

    // 写入 embedding
    for (let i = 0; i < itemsNeedingEmbedding.length; i++) {
      itemsNeedingEmbedding[i].embedding = embeddings[i];
      itemsNeedingEmbedding[i].embedding_model = embeddingBackend.model;
      itemsUpdated++;
    }
  }

  // 补全 status 字段
  for (const item of allItems) {
    if (!item.status) {
      item.status = 'active';
    }
    // 如��有 embedding 但缺 embedding_model，补全
    if (item.embedding && !item.embedding_model) {
      item.embedding_model = embeddingBackend.model;
    }
  }

  // 更新 schema_version
  userModel.schema_version = '0.2';

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`✓ 升级完��，耗��� ${elapsed} ��`);

  return userModel;
}

/**
 * 检查��否需���迁移
 */
export function needsMigration(userModel: UserModel): boolean {
  return userModel.schema_version === '0.1' || userModel.schema_version === '0.2';
}

/**
 * Migrate user model from v0.2 to v0.3
 *
 * Changes:
 * 1. Add description field support (already defined as optional in BaseItem)
 * 2. Update schema_version to '0.3'
 *
 * Note: description field already exists in BaseItem from v0.2, this migration only updates version number
 */
export function migrateUserModelV0_3(userModel: UserModel): UserModel {
  // If already v0.3, return as-is
  if (userModel.schema_version === '0.3') {
    return userModel;
  }

  console.error('ℹ️  Upgrading user model schema (v0.2 → v0.3)...');

  // description field is defined as optional in BaseItem, no data modification needed
  // Just update schema_version
  userModel.schema_version = '0.3';

  console.error('✓ Upgrade complete');

  return userModel;
}
