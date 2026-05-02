// CT-0027-04: Write Items Dedupe Tests

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UserModel } from '../../core/user-model/types.js';
import type { EmbeddingBackend } from '../../backends/types.js';
import { writeItemsToUserModel, type WriteableItem } from '../../core/user-model/write-items.js';
import { emptyUserModel } from '../../core/user-model/types.js';

describe('Write Items Dedupe Tests', () => {
  let tmpDir: string;
  let originalHome: string;

  // Mock embedding backend
  const mockEmbedding: EmbeddingBackend = {
    provider: 'mock',
    model: 'mock-embedding',
    async embed(text: string) {
      // 根据���本生成不同�� embedding（简单 hash）
      const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return new Array(1024).fill(hash / 1000);
    },
    async similarity(a: string, b: string) {
      const embA = await this.embed(a);
      const embB = await this.embed(b);
      // 简单���弦相似度
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < embA.length; i++) {
        dot += embA[i] * embB[i];
        normA += embA[i] * embA[i];
        normB += embB[i] * embB[i];
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    },
    async healthCheck() {
      return { ok: true };
    },
  };

  // 设��临时 home 目录
  function setupTmpHome() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-dedupe-test-'));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;

    const cortexDir = path.join(tmpDir, '.cortex');
    fs.mkdirSync(cortexDir, { recursive: true });

    const model = emptyUserModel();
    fs.writeFileSync(
      path.join(cortexDir, 'user_model.json'),
      JSON.stringify(model, null, 2)
    );
  }

  function teardownTmpHome() {
    process.env.HOME = originalHome;
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  it('写��新条���（无冲��）→ 直接写�� + embedding 持久���', async () => {
    setupTmpHome();

    try {
      const items: WriteableItem[] = [
        {
          target: 'goals',
          label: '完成 MVP',
          source: 'cli:sync:test:conv-1',
          embedding: await mockEmbedding.embed('完成 MVP'),
        },
      ];

      const result = writeItemsToUserModel(items, {
        embeddingBackend: mockEmbedding,
        threshold: 0.85,
      });

      assert.equal(result.written, 1);
      assert.equal(result.skipped, 0);
      assert.equal(result.superseded, 0);

      // 验证 embedding 被持久��
      const modelPath = path.join(tmpDir, '.cortex', 'user_model.json');
      const savedModel: UserModel = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
      assert.ok(savedModel.goals[0].embedding, 'Embedding should be persisted');
      assert.equal(savedModel.goals[0].embedding_model, 'mock-embedding');
      assert.equal(savedModel.goals[0].status, 'active');
    } finally {
      teardownTmpHome();
    }
  });

  it('写入��突（���权威 reflect vs sync）→ 旧 superseded，��写入', async () => {
    setupTmpHome();

    try {
      // 先写���一个 sync 来源��条目
      const syncItems: WriteableItem[] = [
        {
          target: 'preferences',
          label: '喜欢 TypeScript',
          source: 'cli:sync:chatgpt:conv-1',
          embedding: await mockEmbedding.embed('喜欢 TypeScript'),
        },
      ];

      writeItemsToUserModel(syncItems, {
        embeddingBackend: mockEmbedding,
        threshold: 0.85,
      });

      // 再写入一�� reflect 来源的相��条目
      const reflectItems: WriteableItem[] = [
        {
          target: 'preferences',
          label: '偏好 TypeScript',  // 相似���不完��相同
          source: 'cli:reflect:manual',
          embedding: await mockEmbedding.embed('喜欢 TypeScript'),  // 使���相同 embedding 模拟高相��度
        },
      ];

      const result = writeItemsToUserModel(reflectItems, {
        embeddingBackend: mockEmbedding,
        threshold: 0.85,
      });

      assert.equal(result.written, 1, 'Should write new item');
      assert.equal(result.superseded, 1, 'Should supersede old item');

      // 验证��条目���标记为 superseded
      const modelPath = path.join(tmpDir, '.cortex', 'user_model.json');
      const savedModel: UserModel = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
      const supersededItem = savedModel.preferences.find(p => p.status === 'superseded');
      const activeItem = savedModel.preferences.find(p => p.status === 'active');

      assert.ok(supersededItem, 'Should have superseded item');
      assert.ok(activeItem, 'Should have active item');
      assert.equal(supersededItem.label, '喜欢 TypeScript');
      assert.equal(activeItem.label, '偏好 TypeScript');
      assert.ok(supersededItem.superseded_by);
      assert.ok(supersededItem.superseded_at);
    } finally {
      teardownTmpHome();
    }
  });

  it('写入冲��（低��威）��� 跳��', async () => {
    setupTmpHome();

    try {
      // 先写��一个 reflect 来源��条目
      const reflectItems: WriteableItem[] = [
        {
          target: 'goals',
          label: '快��完成项目',
          source: 'cli:reflect:manual',
          embedding: await mockEmbedding.embed('快速��成项��'),
        },
      ];

      writeItemsToUserModel(reflectItems, {
        embeddingBackend: mockEmbedding,
        threshold: 0.85,
      });

      // 再写���一个 sync 来源���相似条目��低权威）
      const syncItems: WriteableItem[] = [
        {
          target: 'goals',
          label: '快速完成项��',
          source: 'cli:sync:chatgpt:conv-1',
          embedding: await mockEmbedding.embed('快速完��项目'),
        },
      ];

      const result = writeItemsToUserModel(syncItems, {
        embeddingBackend: mockEmbedding,
        threshold: 0.85,
      });

      assert.equal(result.written, 0, 'Should not write');
      assert.equal(result.skipped, 1, 'Should skip');
      assert.equal(result.superseded, 0, 'Should not supersede');

      // 验证只有��个 active 条���
      const modelPath = path.join(tmpDir, '.cortex', 'user_model.json');
      const savedModel: UserModel = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
      const activeGoals = savedModel.goals.filter(g => (g.status ?? 'active') === 'active');
      assert.equal(activeGoals.length, 1);
      assert.equal(activeGoals[0].source, 'cli:reflect:manual');
    } finally {
      teardownTmpHome();
    }
  });

  it('写入���突（同等��威）��� 保留���有', async () => {
    setupTmpHome();

    try {
      // 先��入一个 sync 来源的条��
      const firstSync: WriteableItem[] = [
        {
          target: 'constraints',
          label: '避��外部��赖',
          source: 'cli:sync:chatgpt:conv-1',
          embedding: await mockEmbedding.embed('避免��部依���'),
        },
      ];

      writeItemsToUserModel(firstSync, {
        embeddingBackend: mockEmbedding,
        threshold: 0.85,
      });

      // 再写入��一个 sync 来源的相似��目（���等权威）
      const secondSync: WriteableItem[] = [
        {
          target: 'constraints',
          label: '避免外部依��',
          source: 'cli:sync:chatgpt:conv-2',
          embedding: await mockEmbedding.embed('避免外部��赖'),
        },
      ];

      const result = writeItemsToUserModel(secondSync, {
        embeddingBackend: mockEmbedding,
        threshold: 0.85,
      });

      assert.equal(result.written, 0, 'Should not write');
      assert.equal(result.skipped, 1, 'Should skip');
      assert.equal(result.superseded, 0, 'Should not supersede');

      // 验证��留第���个
      const modelPath = path.join(tmpDir, '.cortex', 'user_model.json');
      const savedModel: UserModel = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
      assert.equal(savedModel.constraints.length, 1);
      assert.equal(savedModel.constraints[0].source, 'cli:sync:chatgpt:conv-1');
    } finally {
      teardownTmpHome();
    }
  });
});
