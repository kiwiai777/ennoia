import type { MessageNode } from './parse.js';

export function extractMessageText(message: MessageNode['message']): string | null {
  if (!message) return null;
  if (message.author.role !== 'user') return null;

  const parts = message.content?.parts;
  if (!Array.isArray(parts)) return null;

  const texts = parts.filter((p): p is string => typeof p === 'string');
  if (texts.length === 0) return null;

  return texts.join('\n').trim() || null;
}
