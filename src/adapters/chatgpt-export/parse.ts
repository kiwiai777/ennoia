import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import StreamArray from 'stream-json/streamers/stream-array.js';

export interface ConversationMeta {
  id: string;
  title: string | null;
  create_time: number;
  update_time: number;
  current_node: string;
  mapping: Record<string, MessageNode>;
}

export interface MessageNode {
  id: string;
  message: {
    id: string;
    author: { role: 'user' | 'assistant' | 'system' | 'tool'; name?: string | null };
    content: { content_type: string; parts: any[] };
    create_time: number | null;
  } | null;
  parent: string | null;
  children: string[];
}

export async function* streamConversations(
  filePath: string
): AsyncGenerator<ConversationMeta> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const jsonStream = StreamArray.withParserAsStream();

  stream.pipe(jsonStream);

  for await (const { value } of jsonStream) {
    yield value as ConversationMeta;
  }
}
