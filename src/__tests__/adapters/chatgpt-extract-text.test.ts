import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMessageText } from '../../adapters/chatgpt-export/extract-text.js';
import type { MessageNode } from '../../adapters/chatgpt-export/parse.js';

describe('ChatGPT extract-text', () => {
  it('should extract text from user message', () => {
    const message: MessageNode['message'] = {
      id: 'msg-1',
      author: { role: 'user' },
      content: { content_type: 'text', parts: ['Hello world'] },
      create_time: 1234567890,
    };

    const result = extractMessageText(message);
    assert.strictEqual(result, 'Hello world');
  });

  it('should return null for assistant message', () => {
    const message: MessageNode['message'] = {
      id: 'msg-1',
      author: { role: 'assistant' },
      content: { content_type: 'text', parts: ['Hello'] },
      create_time: 1234567890,
    };

    const result = extractMessageText(message);
    assert.strictEqual(result, null);
  });

  it('should return null for system message', () => {
    const message: MessageNode['message'] = {
      id: 'msg-1',
      author: { role: 'system' },
      content: { content_type: 'text', parts: ['System message'] },
      create_time: 1234567890,
    };

    const result = extractMessageText(message);
    assert.strictEqual(result, null);
  });

  it('should return null for null message', () => {
    const result = extractMessageText(null);
    assert.strictEqual(result, null);
  });

  it('should join multiple text parts', () => {
    const message: MessageNode['message'] = {
      id: 'msg-1',
      author: { role: 'user' },
      content: { content_type: 'text', parts: ['Part 1', 'Part 2', 'Part 3'] },
      create_time: 1234567890,
    };

    const result = extractMessageText(message);
    assert.strictEqual(result, 'Part 1\nPart 2\nPart 3');
  });

  it('should skip non-string parts (multimodal)', () => {
    const message: MessageNode['message'] = {
      id: 'msg-1',
      author: { role: 'user' },
      content: {
        content_type: 'multimodal',
        parts: ['Text part', { type: 'image', url: 'http://example.com/img.png' }, 'More text'],
      },
      create_time: 1234567890,
    };

    const result = extractMessageText(message);
    assert.strictEqual(result, 'Text part\nMore text');
  });

  it('should return null for empty parts', () => {
    const message: MessageNode['message'] = {
      id: 'msg-1',
      author: { role: 'user' },
      content: { content_type: 'text', parts: [] },
      create_time: 1234567890,
    };

    const result = extractMessageText(message);
    assert.strictEqual(result, null);
  });

  it('should return null for whitespace-only text', () => {
    const message: MessageNode['message'] = {
      id: 'msg-1',
      author: { role: 'user' },
      content: { content_type: 'text', parts: ['   ', '\n\n', '  '] },
      create_time: 1234567890,
    };

    const result = extractMessageText(message);
    assert.strictEqual(result, null);
  });
});
