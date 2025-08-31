#!/usr/bin/env node
/**
 * Rails MCP Indexer Server
 * Intelligent code indexing and retrieval for Ruby on Rails projects
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CodeIndexer } from './indexer.js';
import { IndexDatabase } from './database.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Tool schemas
const SearchSymbolsSchema = z.object({
  query: z.string().describe('Search query'),
  k: z.number().default(10).describe('Number of results to return'),
  file_types: z.array(z.string()).optional().describe('File types to search')
});

const GetSnippetSchema = z.object({
  file_path: z.string().describe('Path to the file'),
  start_line: z.number().optional().describe('Starting line number'),
  end_line: z.number().optional().describe('Ending line number'),
  symbol_name: z.string().optional().describe('Name of symbol to extract')
});

const CallGraphSchema = z.object({
  symbol: z.string().describe('Symbol to analyze'),
  direction: z.enum(['callers', 'callees', 'both']).default('both').describe('Direction of analysis'),
  depth: z.number().default(2).describe('Depth of analysis')
});

const FindSimilarSchema = z.object({
  code_snippet: z.string().describe('Code snippet to find similar patterns'),
  k: z.number().default(5).describe('Number of results'),
  min_similarity: z.number().default(0.7).describe('Minimum similarity score')
});

const FindTestsSchema = z.object({
  file_path: z.string().describe('Implementation file path')
});

const ReindexSchema = z.object({
  paths: z.array(z.string()).optional().describe('Paths to reindex'),
  full: z.boolean().default(false).describe('Full reindex')
});

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class RailsMcpServer {
  private server: Server;
  private indexer: CodeIndexer;
  private db: IndexDatabase;

  constructor() {
    // Get configuration from environment variables
    const repoPath = process.env.REPO_PATH || '.';
    const dbPath = process.env.DB_PATH || '.rails-index/repo.db';
    const rubyParser = process.env.RUBY_AST_PARSER || path.join(__dirname, '..', 'src', 'ruby_ast_parser.rb');

    // Ensure database directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize components
    this.db = new IndexDatabase(dbPath);
    this.indexer = new CodeIndexer(repoPath, this.db, rubyParser);

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'rails-mcp-indexer',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_symbols',
            description: 'Search for symbols (classes, methods, modules) in the codebase',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                k: { type: 'number', description: 'Number of results to return', default: 10 },
                file_types: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'File types to search'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_snippet',
            description: 'Get a code snippet from a file',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: { type: 'string', description: 'Path to the file' },
                start_line: { type: 'number', description: 'Starting line number' },
                end_line: { type: 'number', description: 'Ending line number' },
                symbol_name: { type: 'string', description: 'Name of symbol to extract' }
              },
              required: ['file_path']
            }
          },
          {
            name: 'call_graph',
            description: 'Analyze method dependencies and call relationships',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Symbol to analyze' },
                direction: { 
                  type: 'string', 
                  enum: ['callers', 'callees', 'both'],
                  description: 'Direction of analysis',
                  default: 'both'
                },
                depth: { type: 'number', description: 'Depth of analysis', default: 2 }
              },
              required: ['symbol']
            }
          },
          {
            name: 'find_similar',
            description: 'Find similar code patterns in the codebase',
            inputSchema: {
              type: 'object',
              properties: {
                code_snippet: { type: 'string', description: 'Code snippet to find similar patterns' },
                k: { type: 'number', description: 'Number of results', default: 5 },
                min_similarity: { type: 'number', description: 'Minimum similarity score', default: 0.7 }
              },
              required: ['code_snippet']
            }
          },
          {
            name: 'find_tests',
            description: 'Find test files for a given implementation file',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: { type: 'string', description: 'Implementation file path' }
              },
              required: ['file_path']
            }
          },
          {
            name: 'reindex',
            description: 'Reindex the codebase or specific paths',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { 
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Paths to reindex'
                },
                full: { type: 'boolean', description: 'Full reindex', default: false }
              }
            }
          }
        ] as Tool[]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_symbols': {
            const params = SearchSymbolsSchema.parse(args);
            const results = await this.indexer.searchSymbols(
              params.query,
              params.k,
              params.file_types
            );
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(results, null, 2)
              } as TextContent]
            };
          }

          case 'get_snippet': {
            const params = GetSnippetSchema.parse(args);
            const snippet = await this.indexer.getSnippet(
              params.file_path,
              params.start_line,
              params.end_line,
              params.symbol_name
            );
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(snippet, null, 2)
              } as TextContent]
            };
          }

          case 'call_graph': {
            const params = CallGraphSchema.parse(args);
            const graph = await this.indexer.callGraph(
              params.symbol,
              params.direction,
              params.depth
            );
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(graph, null, 2)
              } as TextContent]
            };
          }

          case 'find_similar': {
            const params = FindSimilarSchema.parse(args);
            const similar = await this.indexer.findSimilar(
              params.code_snippet,
              params.k,
              params.min_similarity
            );
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(similar, null, 2)
              } as TextContent]
            };
          }

          case 'find_tests': {
            const params = FindTestsSchema.parse(args);
            const tests = await this.indexer.findTests(params.file_path);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(tests, null, 2)
              } as TextContent]
            };
          }

          case 'reindex': {
            const params = ReindexSchema.parse(args);
            const result = await this.indexer.reindex(params.paths, params.full);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              } as TextContent]
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid parameters: ${error.message}`
          );
        }
        throw error;
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Don't log to stderr as it might interfere with MCP communication
    // console.error('Rails MCP Indexer server started');
  }
}

// Main entry point
const server = new RailsMcpServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});