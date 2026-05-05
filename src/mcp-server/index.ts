#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface UserModelEntry {
  type: 'preference' | 'goal' | 'constraint';
  label: string;
  description: string;
  source: string;
  confidence?: string;
  created_at?: string;
  deleted_at?: string | null;
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

// Load user model from ~/.cortex/user_model.json
function loadUserModel(): UserModel {
  const userModelPath = path.join(os.homedir(), '.cortex', 'user_model.json');

  if (!fs.existsSync(userModelPath)) {
    return { preferences: [], goals: [], constraints: [] };
  }

  const data = fs.readFileSync(userModelPath, 'utf-8');
  return JSON.parse(data);
}

// Filter entries based on query, type, and limit
function filterEntries(
  userModel: UserModel,
  args: GetPreferencesArgs
): UserModelEntry[] {
  const { query, type, limit = 10 } = args;

  let entries: UserModelEntry[] = [];

  // Collect entries based on type filter and add type field
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

  // Filter out soft-deleted entries
  entries = entries.filter(e => !e.deleted_at);

  // Apply query filter if provided
  if (query) {
    const lowerQuery = query.toLowerCase();
    entries = entries.filter(e => {
      const searchText = `${e.label} ${e.description || ''}`.toLowerCase();
      return searchText.includes(lowerQuery);
    });
  }

  // Apply limit
  return entries.slice(0, limit);
}

// Format results for MCP response
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

// Create and configure MCP server
const server = new Server(
  {
    name: 'cortex-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools/list handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_preferences',
      description: 'Query user preferences, goals, and constraints from cortex user model. Returns items matching the natural language query.',
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

// Register tools/call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_preferences') {
    try {
      const args = request.params.arguments as GetPreferencesArgs;
      const userModel = loadUserModel();
      const results = filterEntries(userModel, args);

      return {
        content: [
          {
            type: 'text',
            text: formatResults(results),
          },
        ],
      };
    } catch (error) {
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is used for MCP protocol)
  console.error('Cortex MCP server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
