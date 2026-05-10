#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { loadConfig } from '../backends/config.js';
import { createEmbeddingBackend } from '../backends/factory.js';
import type { EmbeddingBackend } from '../backends/types.js';

const VERSION = '0.2.0';

interface UserModelEntry {
  type: 'preference' | 'goal' | 'constraint';
  label: string;
  description?: string;
  source: string;
  confidence?: string;
  created_at?: string;
  deleted_at?: string | null;
  embedding?: number[];
}

interface UserModel {
  preferences: UserModelEntry[];
  goals: UserModelEntry[];
  constraints: UserModelEntry[];
}

interface GetPreferencesArgs {
  query?: string;
  type?: 'preference' | 'goal' | 'constraint';
  limit?: number;
}

function log(event: string, data: Record<string, any>) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...data
  };
  console.error(JSON.stringify(logEntry));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

function loadUserModel(): UserModel {
  const userModelPath = path.join(os.homedir(), '.cortex', 'user_model.json');

  if (!fs.existsSync(userModelPath)) {
    return { preferences: [], goals: [], constraints: [] };
  }

  const data = fs.readFileSync(userModelPath, 'utf-8');
  return JSON.parse(data);
}

let embeddingBackend: EmbeddingBackend | null = null;

function getEmbeddingBackend(): EmbeddingBackend | null {
  if (embeddingBackend === null) {
    try {
      const config = loadConfig();
      if (config.embedding.enabled) {
        embeddingBackend = createEmbeddingBackend(config.embedding);
        log('embedding_init', {
          provider: embeddingBackend.provider,
          model: embeddingBackend.model
        });
      }
    } catch (error) {
      log('embedding_init_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return embeddingBackend;
}

async function filterEntries(
  userModel: UserModel,
  args: GetPreferencesArgs
): Promise<UserModelEntry[]> {
  const startTime = Date.now();
  const { query, type, limit = 10 } = args;

  let entries: UserModelEntry[] = [];

  if (type) {
    const arrayKey = `${type}s` as keyof UserModel;
    entries = (userModel[arrayKey] || []).map(e => ({ ...e, type }));
  } else {
    entries = [
      ...userModel.preferences.map(e => ({ ...e, type: 'preference' as const })),
      ...userModel.goals.map(e => ({ ...e, type: 'goal' as const })),
      ...userModel.constraints.map(e => ({ ...e, type: 'constraint' as const })),
    ];
  }

  entries = entries.filter(e => !e.deleted_at);

  let searchMethod = 'none';

  if (query) {
    const backend = getEmbeddingBackend();

    if (backend) {
      try {
        const queryEmbedding = await backend.embed(query);
        const entriesWithEmbeddings = entries.filter(e => e.embedding && Array.isArray(e.embedding));

        if (entriesWithEmbeddings.length > 0) {
          const scored = entriesWithEmbeddings.map(e => ({
            entry: e,
            score: cosineSimilarity(queryEmbedding, e.embedding!)
          }));
          scored.sort((a, b) => b.score - a.score);
          entries = scored.slice(0, limit).map(s => s.entry);
          searchMethod = 'embedding';
        } else {
          log('embedding_fallback', { reason: 'no_embeddings_in_entries' });
          searchMethod = 'string_fallback';
          const lowerQuery = query.toLowerCase();
          entries = entries.filter(e => {
            const searchText = `${e.label} ${e.description || ''}`.toLowerCase();
            return searchText.includes(lowerQuery);
          }).slice(0, limit);
        }
      } catch (error) {
        log('error', {
          message: 'Embedding search failed',
          error: error instanceof Error ? error.message : String(error),
          fallback: 'string_matching'
        });
        searchMethod = 'string_fallback';
        const lowerQuery = query.toLowerCase();
        entries = entries.filter(e => {
          const searchText = `${e.label} ${e.description || ''}`.toLowerCase();
          return searchText.includes(lowerQuery);
        }).slice(0, limit);
      }
    } else {
      searchMethod = 'string';
      const lowerQuery = query.toLowerCase();
      entries = entries.filter(e => {
        const searchText = `${e.label} ${e.description || ''}`.toLowerCase();
        return searchText.includes(lowerQuery);
      }).slice(0, limit);
    }
  } else {
    entries = entries.slice(0, limit);
  }

  const latencyMs = Date.now() - startTime;

  log('query', {
    query: query || null,
    type: type || null,
    limit,
    result_count: entries.length,
    latency_ms: latencyMs,
    search_method: searchMethod
  });

  return entries;
}

function formatResults(entries: UserModelEntry[]): string {
  if (entries.length === 0) {
    return 'No preferences found matching your query.';
  }

  let result = `Found ${entries.length} item(s):\n\n`;

  entries.forEach((entry, index) => {
    result += `${index + 1}. [${entry.type}] ${entry.label}\n`;
    if (entry.description) {
      result += `   ${entry.description}\n`;
    }
    result += `   Source: ${entry.source}`;
    if (entry.confidence) {
      result += ` | Confidence: ${entry.confidence}`;
    }
    result += '\n\n';
  });

  return result.trim();
}

function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'cortex-mcp-server',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_preferences',
        description: 'Query user preferences, goals, and constraints from cortex user model. Returns items matching the natural language query, ranked by semantic similarity.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language query to search preferences (e.g., "coding style", "TypeScript", "meeting preferences")',
            },
            type: {
              type: 'string',
              enum: ['preference', 'goal', 'constraint'],
              description: 'Optional filter by item type',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
              default: 10,
              minimum: 1,
              maximum: 50,
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'get_preferences') {
      try {
        const args = request.params.arguments as GetPreferencesArgs;
        const userModel = loadUserModel();
        const results = await filterEntries(userModel, args);

        return {
          content: [
            {
              type: 'text',
              text: formatResults(results),
            },
          ],
        };
      } catch (error) {
        log('error', {
          message: 'Query execution failed',
          error: error instanceof Error ? error.message : String(error)
        });
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}

async function startHttpServer(port: number) {
  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: VERSION }));
      return;
    }

    if (req.method === 'POST' && req.url === '/mcp') {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  httpServer.listen(port, '127.0.0.1', () => {
    log('startup', { version: VERSION, mode: 'http', port });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const httpMode = args.includes('--http');
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3100;

  if (httpMode) {
    await startHttpServer(port);
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('startup', { version: VERSION, mode: 'stdio' });
  }
}

main().catch((error) => {
  log('fatal_error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
