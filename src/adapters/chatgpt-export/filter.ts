import type { ConversationMeta } from './parse.js';
import { extractMessageText } from './extract-text.js';

export function passesTimeFilter(
  conv: ConversationMeta,
  since: Date
): boolean {
  return conv.create_time * 1000 >= since.getTime();
}

export function getUserCharCount(conv: ConversationMeta): number {
  let total = 0;
  for (const node of Object.values(conv.mapping)) {
    const text = extractMessageText(node.message);
    if (text) total += text.length;
  }
  return total;
}

export function passesLengthFilter(
  conv: ConversationMeta,
  minChars: number
): boolean {
  return getUserCharCount(conv) >= minChars;
}
