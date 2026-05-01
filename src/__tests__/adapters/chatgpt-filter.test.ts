import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { passesTimeFilter, passesLengthFilter, getUserCharCount } from '../../adapters/chatgpt-export/filter.js';
import type { ConversationMeta } from '../../adapters/chatgpt-export/parse.js';

describe('ChatGPT filter', () => {
  const mockConv: ConversationMeta = {
    id: 'conv-1',
    title: 'Test',
    create_time: 1704067200, // 2024-01-01
    update_time: 1704067200,
    current_node: 'node-1',
    mapping: {
      'node-1': {
        id: 'node-1',
        message: {
          id: 'msg-1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Hello world'] },
          create_time: 1704067200,
        },
        parent: null,
        children: [],
      },
    },
  };

  describe('passesTimeFilter', () => {
    it('should pass when conversation is after since date', () => {
      const since = new Date('2023-01-01');
      assert.strictEqual(passesTimeFilter(mockConv, since), true);
    });

    it('should fail when conversation is before since date', () => {
      const since = new Date('2025-01-01');
      assert.strictEqual(passesTimeFilter(mockConv, since), false);
    });

    it('should pass when conversation is exactly at since date', () => {
      const since = new Date(mockConv.create_time * 1000);
      assert.strictEqual(passesTimeFilter(mockConv, since), true);
    });
  });

  describe('getUserCharCount', () => {
    it('should count characters in user messages', () => {
      const count = getUserCharCount(mockConv);
      assert.strictEqual(count, 'Hello world'.length);
    });

    it('should count multiple user messages', () => {
      const conv: ConversationMeta = {
        ...mockConv,
        mapping: {
          'node-1': {
            id: 'node-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['First'] },
              create_time: 1704067200,
            },
            parent: null,
            children: ['node-2'],
          },
          'node-2': {
            id: 'node-2',
            message: {
              id: 'msg-2',
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['Second'] },
              create_time: 1704067300,
            },
            parent: 'node-1',
            children: [],
          },
        },
      };

      const count = getUserCharCount(conv);
      assert.strictEqual(count, 'First'.length + 'Second'.length);
    });

    it('should ignore assistant messages', () => {
      const conv: ConversationMeta = {
        ...mockConv,
        mapping: {
          'node-1': {
            id: 'node-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['User'] },
              create_time: 1704067200,
            },
            parent: null,
            children: ['node-2'],
          },
          'node-2': {
            id: 'node-2',
            message: {
              id: 'msg-2',
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Assistant response'] },
              create_time: 1704067300,
            },
            parent: 'node-1',
            children: [],
          },
        },
      };

      const count = getUserCharCount(conv);
      assert.strictEqual(count, 'User'.length);
    });

    it('should return 0 for conversation with no user messages', () => {
      const conv: ConversationMeta = {
        ...mockConv,
        mapping: {
          'node-1': {
            id: 'node-1',
            message: {
              id: 'msg-1',
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Assistant only'] },
              create_time: 1704067200,
            },
            parent: null,
            children: [],
          },
        },
      };

      const count = getUserCharCount(conv);
      assert.strictEqual(count, 0);
    });
  });

  describe('passesLengthFilter', () => {
    it('should pass when char count meets minimum', () => {
      assert.strictEqual(passesLengthFilter(mockConv, 10), true);
    });

    it('should fail when char count is below minimum', () => {
      assert.strictEqual(passesLengthFilter(mockConv, 100), false);
    });

    it('should pass when char count exactly equals minimum', () => {
      const count = getUserCharCount(mockConv);
      assert.strictEqual(passesLengthFilter(mockConv, count), true);
    });
  });
});
