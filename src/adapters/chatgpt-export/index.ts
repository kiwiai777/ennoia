import type { ContentBlock, ExtractionCandidate, ExtractionInput } from '../../core/extraction/types.js';
import type { SourceDescriptor } from '../../core/source/types.js';
import { extract } from '../../core/extraction/index.js';
import { streamConversations } from './parse.js';
import { passesTimeFilter, passesLengthFilter } from './filter.js';
import { extractMessageText } from './extract-text.js';
import { resolveExportPath } from './workspace.js';

export interface ChatGPTExtractOptions {
  exportPath: string;
  since?: Date;
  minChars?: number;
  maxConversations?: number;
}

const MAX_BLOCK_SIZE = 100 * 1024; // 100KB limit per conversation

export async function extractFromChatGPTExport(
  opts: ChatGPTExtractOptions
): Promise<ExtractionCandidate[]> {
  const filePath = resolveExportPath(opts.exportPath);
  const since = opts.since ?? new Date('2025-01-01');
  const minChars = opts.minChars ?? 500;
  const maxConversations = opts.maxConversations ?? 500;

  const blocks: ContentBlock[] = [];
  let processedCount = 0;
  let skippedTime = 0;
  let skippedLength = 0;
  let totalSeen = 0;

  for await (const conv of streamConversations(filePath)) {
    totalSeen++;
    if (processedCount >= maxConversations) break;
    if (!passesTimeFilter(conv, since)) {
      skippedTime++;
      continue;
    }
    if (!passesLengthFilter(conv, minChars)) {
      skippedLength++;
      continue;
    }

    // Extract all user messages and sort by create_time
    const userMessages: Array<{ text: string; time: number }> = [];
    for (const node of Object.values(conv.mapping)) {
      const text = extractMessageText(node.message);
      if (text && node.message?.create_time) {
        userMessages.push({ text, time: node.message.create_time });
      }
    }

    if (userMessages.length === 0) continue;

    // Sort by time
    userMessages.sort((a, b) => a.time - b.time);

    // Join all user messages
    let content = userMessages.map(m => m.text).join('\n\n');

    // Truncate if too large
    if (content.length > MAX_BLOCK_SIZE) {
      content = content.substring(0, MAX_BLOCK_SIZE);
    }

    blocks.push({
      content,
      hint: 'chat-conversation',
      kind: 'plain',
      path: `chatgpt://conversation/${conv.id}`,
    });

    processedCount++;
  }

  console.error(
    `ChatGPT export: ${totalSeen} conversations total, ` +
    `${skippedTime} skipped (time), ${skippedLength} skipped (length), ` +
    `${processedCount} processed`
  );

  // Create source descriptor
  const sourceDescriptor: SourceDescriptor = {
    kind: 'file',
    path: filePath,
    adapter: 'chatgpt-export',
  };

  // Call extraction main dispatch
  const input: ExtractionInput = {
    sourceId: 'chatgpt-export',
    sourceDescriptor,
    contentBlocks: blocks,
  };

  return extract(input);
}
