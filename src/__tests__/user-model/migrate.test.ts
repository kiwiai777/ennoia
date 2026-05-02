// CT-0027-04: Migration Tests

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { UserModel } from '../../core/user-model/types.js';
import type { EmbeddingBackend } from '../../backends/types.js';
import { migrateUserModelV0_2, needsMigration } from '../../core/user-model/migrate.js';

describe('Migration Tests', () => {
  const mockEmbedding: EmbeddingBackend = {
    provider: 'mock',
    model: 'mock-embedding-model',
    async embed(text: string) {
      // 返回固定��度的 mock embedding
      return new Array(1024).fill(0.1);
    },
    async similarity() {
      return 0.5;
    },
    async healthCheck() {
      return { ok: true };
    },
  };

  it('v0.1 → v0.2 自���补 embedding', async () => {
    const v01Model: UserModel = {
      schema_version: '0.1',
      projects: [],
      goals: [
        {
          id: 'goal_1',
          label: 'Test goal',
          scope: 'global',
          source: 'test',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      preferences: [],
      constraints: [],
      skills: [],
      states: [],
      decision_rules: [],
      meta: {
        last_updated: '2026-01-01T00:00:00Z',
        sources: ['test'],
        confidence: null,
      },
    };

    const migrated = await migrateUserModelV0_2(v01Model, mockEmbedding);

    assert.equal(migrated.schema_version, '0.2');
    assert.ok(migrated.goals[0].embedding, 'Should have embedding');
    assert.equal(migrated.goals[0].embedding_model, 'mock-embedding-model');
    assert.equal(migrated.goals[0].status, 'active');
  });

  it('v0.2 不重复迁��', async () => {
    const v02Model: UserModel = {
      schema_version: '0.2',
      projects: [],
      goals: [
        {
          id: 'goal_1',
          label: 'Test goal',
          scope: 'global',
          source: 'test',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          embedding: new Array(1024).fill(0.5),
          embedding_model: 'existing-model',
          status: 'active',
        },
      ],
      preferences: [],
      constraints: [],
      skills: [],
      states: [],
      decision_rules: [],
      meta: {
        last_updated: '2026-01-01T00:00:00Z',
        sources: ['test'],
        confidence: null,
      },
    };

    const migrated = await migrateUserModelV0_2(v02Model, mockEmbedding);

    // ��该直���返回，不��改
    assert.equal(migrated.schema_version, '0.2');
    assert.deepEqual(migrated.goals[0].embedding, v02Model.goals[0].embedding);
    assert.equal(migrated.goals[0].embedding_model, 'existing-model');
  });

  it('部分缺��段的旧��目能���全', async () => {
    const partialModel: UserModel = {
      schema_version: '0.1',
      projects: [],
      goals: [
        {
          id: 'goal_1',
          label: 'Goal with embedding but no status',
          scope: 'global',
          source: 'test',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          embedding: new Array(1024).fill(0.3),
          // 缺 embedding_model 和 status
        } as any,
        {
          id: 'goal_2',
          label: 'Goal without embedding',
          scope: 'global',
          source: 'test',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          // 缺 embedding
        },
      ],
      preferences: [],
      constraints: [],
      skills: [],
      states: [],
      decision_rules: [],
      meta: {
        last_updated: '2026-01-01T00:00:00Z',
        sources: ['test'],
        confidence: null,
      },
    };

    const migrated = await migrateUserModelV0_2(partialModel, mockEmbedding);

    assert.equal(migrated.schema_version, '0.2');

    // goal_1: 有 embedding 但�� embedding_model���应该补全
    assert.ok(migrated.goals[0].embedding);
    assert.equal(migrated.goals[0].embedding_model, 'mock-embedding-model');
    assert.equal(migrated.goals[0].status, 'active');

    // goal_2: 缺 embedding，应该生��
    assert.ok(migrated.goals[1].embedding);
    assert.equal(migrated.goals[1].embedding_model, 'mock-embedding-model');
    assert.equal(migrated.goals[1].status, 'active');
  });

  it('needsMigration 正确���断', () => {
    const v01: UserModel = {
      schema_version: '0.1',
      projects: [],
      goals: [],
      preferences: [],
      constraints: [],
      skills: [],
      states: [],
      decision_rules: [],
      meta: { last_updated: null, sources: [], confidence: null },
    };

    const v02: UserModel = {
      ...v01,
      schema_version: '0.2',
    };

    assert.equal(needsMigration(v01), true);
    assert.equal(needsMigration(v02), false);
  });
});
