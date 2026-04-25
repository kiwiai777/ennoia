import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { renderUserModelToNaturalLanguage, type UserModelItem } from '../../adapters/openclaw/render.js';

test('openclaw render - preference (English)', () => {
  const items: UserModelItem[] = [{ kind: 'preference', label: 'TypeScript over JavaScript for all projects' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, 'The user prefers TypeScript over JavaScript for all projects.');
});

test('openclaw render - goal (English)', () => {
  const items: UserModelItem[] = [{ kind: 'goal', label: 'learn Rust this year' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, "The user's goal is to learn Rust this year.");
});

test('openclaw render - constraint (English)', () => {
  const items: UserModelItem[] = [{ kind: 'constraint', label: 'code examples always include type annotations' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, 'The user requires that code examples always include type annotations.');
});

test('openclaw render - other kind (English)', () => {
  const items: UserModelItem[] = [{ kind: 'note', label: 'API keys are stored in .env' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, 'The user has noted: API keys are stored in .env.');
});

test('openclaw render - empty items', () => {
  const items: UserModelItem[] = [];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, '');
});

test('openclaw render - preference (Chinese)', () => {
  const items: UserModelItem[] = [{ kind: 'preference', label: '所有项目都用 TypeScript' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, '用户偏好 所有项目都用 TypeScript。');
});

test('openclaw render - goal (Chinese)', () => {
  const items: UserModelItem[] = [{ kind: 'goal', label: '今年学会 Rust' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, '用户的目标是 今年学会 Rust。');
});

test('openclaw render - constraint (Chinese)', () => {
  const items: UserModelItem[] = [{ kind: 'constraint', label: '代码示例必须包含类型注解' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, '用户要求 代码示例必须包含类型注解。');
});

test('openclaw render - other kind (Chinese)', () => {
  const items: UserModelItem[] = [{ kind: 'note', label: 'API 密钥存在 .env 文件里' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, '用户备注：API 密钥存在 .env 文件里。');
});

test('openclaw render - multiple lines', () => {
  const items: UserModelItem[] = [
    { kind: 'preference', label: 'TypeScript over JavaScript for all projects' },
    { kind: 'goal', label: 'learn Rust this year' },
    { kind: 'constraint', label: '代码示例必须包含类型注解' }
  ];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, "The user prefers TypeScript over JavaScript for all projects.\nThe user's goal is to learn Rust this year.\n用户要求 代码示例必须包含类型注解。");
});

test('openclaw render - trim prefix (dash)', () => {
  const items: UserModelItem[] = [{ kind: 'goal', label: '- 统一 dedupe 逻辑' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, '用户的目标是 统一 dedupe 逻辑。');
});

test('openclaw render - trim prefix (asterisk)', () => {
  const items: UserModelItem[] = [{ kind: 'goal', label: '* prefer TypeScript' }];
  const result = renderUserModelToNaturalLanguage(items);
  assert.equal(result, "The user's goal is to prefer TypeScript.");
});
