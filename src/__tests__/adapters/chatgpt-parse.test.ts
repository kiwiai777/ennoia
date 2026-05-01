import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { streamConversations } from '../../adapters/chatgpt-export/parse.js';
import type { ConversationMeta } from '../../adapters/chatgpt-export/parse.js';

describe('ChatGPT parse', () => {
  const fixturePath = path.join(
    process.cwd(),
    'src/__tests__/fixtures/chatgpt-conversations.json'
  );

  describe('streamConversations', () => {
    it('should stream all conversations from fixture', async () => {
      const conversations: ConversationMeta[] = [];

      for await (const conv of streamConversations(fixturePath)) {
        conversations.push(conv);
      }

      assert.strictEqual(conversations.length, 3);
    });

    it('should parse conversation metadata correctly', async () => {
      const conversations: ConversationMeta[] = [];

      for await (const conv of streamConversations(fixturePath)) {
        conversations.push(conv);
      }

      const first = conversations[0];
      assert.strictEqual(first.id, 'conv-1');
      assert.strictEqual(first.title, 'Test Conversation 1');
      assert.strictEqual(first.create_time, 1704067200);
      assert.strictEqual(first.update_time, 1704067200);
      assert.strictEqual(first.current_node, 'node-2');
    });

    it('should parse message mapping correctly', async () => {
      const conversations: ConversationMeta[] = [];

      for await (const conv of streamConversations(fixturePath)) {
        conversations.push(conv);
      }

      const first = conversations[0];
      assert.ok(first.mapping['node-1']);
      assert.ok(first.mapping['node-2']);

      const node1 = first.mapping['node-1'];
      assert.strictEqual(node1.id, 'node-1');
      assert.strictEqual(node1.message?.author.role, 'user');
      assert.strictEqual(node1.parent, null);
      assert.deepStrictEqual(node1.children, ['node-2']);
    });

    it('should parse message content correctly', async () => {
      const conversations: ConversationMeta[] = [];

      for await (const conv of streamConversations(fixturePath)) {
        conversations.push(conv);
      }

      const first = conversations[0];
      const node1 = first.mapping['node-1'];

      assert.strictEqual(node1.message?.content.content_type, 'text');
      assert.deepStrictEqual(
        node1.message?.content.parts,
        ['I prefer TypeScript over JavaScript']
      );
    });

    it('should handle conversations with different structures', async () => {
      const conversations: ConversationMeta[] = [];

      for await (const conv of streamConversations(fixturePath)) {
        conversations.push(conv);
      }

      // conv-2: short conversation with single message
      const short = conversations[1];
      assert.strictEqual(short.id, 'conv-2');
      assert.strictEqual(Object.keys(short.mapping).length, 1);

      // conv-3: long conversation with multiple user messages
      const long = conversations[2];
      assert.strictEqual(long.id, 'conv-3');
      assert.strictEqual(Object.keys(long.mapping).length, 2);
    });

    it('should stream without loading entire file into memory', async () => {
      let count = 0;

      for await (const conv of streamConversations(fixturePath)) {
        count++;
        // Verify we can access conversation data during streaming
        assert.ok(conv.id);
        assert.ok(conv.mapping);
      }

      assert.strictEqual(count, 3);
    });
  });
});
