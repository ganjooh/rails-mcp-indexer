#!/usr/bin/env python3
"""
MCP Repo Indexer Server
Provides intelligent code indexing and retrieval for Ruby/Rails projects
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# MCP server implementation
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Local modules
from indexer import CodeIndexer
from database import IndexDatabase

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RepoIndexerServer:
    """MCP Server for intelligent repository indexing and retrieval"""
    
    def __init__(self):
        self.server = Server("repo-indexer")
        self.repo_path = Path(os.getenv("REPO_PATH", "."))
        self.db_path = Path(os.getenv("DB_PATH", ".index/repo.db"))
        self.ruby_parser = Path(os.getenv("RUBY_AST_PARSER", 
                                          "mcp-servers/repo-indexer/ruby_ast_parser.rb"))
        
        # Ensure directories exist
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Initialize components
        self.db = IndexDatabase(str(self.db_path))
        self.indexer = CodeIndexer(self.repo_path, self.db, str(self.ruby_parser))
        
        # Register handlers
        self._register_handlers()
    
    def _register_handlers(self):
        """Register MCP handlers"""
        
        @self.server.list_tools()
        async def list_tools():
            """List available tools"""
            return [
                Tool(
                    name="search_symbols",
                    description="Search for symbols (classes, methods, modules) in the codebase",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search query"
                            },
                            "k": {
                                "type": "integer",
                                "description": "Number of results to return",
                                "default": 10
                            },
                            "file_types": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "File types to search"
                            }
                        },
                        "required": ["query"]
                    }
                ),
                Tool(
                    name="get_snippet",
                    description="Get a code snippet from a file",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "file_path": {
                                "type": "string",
                                "description": "Path to the file"
                            },
                            "start_line": {
                                "type": "integer",
                                "description": "Starting line number"
                            },
                            "end_line": {
                                "type": "integer",
                                "description": "Ending line number"
                            },
                            "symbol_name": {
                                "type": "string",
                                "description": "Name of symbol to extract"
                            }
                        },
                        "required": ["file_path"]
                    }
                ),
                Tool(
                    name="call_graph",
                    description="Get the call graph for a symbol",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "symbol": {
                                "type": "string",
                                "description": "Symbol to analyze"
                            },
                            "direction": {
                                "type": "string",
                                "enum": ["callers", "callees", "both"],
                                "default": "both"
                            },
                            "depth": {
                                "type": "integer",
                                "default": 1
                            }
                        },
                        "required": ["symbol"]
                    }
                ),
                Tool(
                    name="find_similar",
                    description="Find similar code patterns",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "code_snippet": {
                                "type": "string",
                                "description": "Code snippet to find similar patterns for"
                            },
                            "k": {
                                "type": "integer",
                                "default": 5
                            },
                            "min_similarity": {
                                "type": "number",
                                "default": 0.7
                            }
                        },
                        "required": ["code_snippet"]
                    }
                ),
                Tool(
                    name="get_file_summary",
                    description="Get a summary of a file",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "file_path": {
                                "type": "string",
                                "description": "Path to the file"
                            }
                        },
                        "required": ["file_path"]
                    }
                ),
                Tool(
                    name="find_tests",
                    description="Find test files for a given file",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "file_path": {
                                "type": "string",
                                "description": "Path to the implementation file"
                            }
                        },
                        "required": ["file_path"]
                    }
                ),
                Tool(
                    name="index_status",
                    description="Get index status",
                    inputSchema={
                        "type": "object",
                        "properties": {}
                    }
                ),
                Tool(
                    name="reindex",
                    description="Reindex the codebase",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "paths": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Paths to reindex"
                            },
                            "full": {
                                "type": "boolean",
                                "description": "Perform full reindex",
                                "default": False
                            }
                        }
                    }
                )
            ]
        
        @self.server.call_tool()
        async def call_tool(name: str, arguments: dict):
            """Handle tool calls"""
            
            if name == "search_symbols":
                results = await self.indexer.search_symbols(
                    arguments["query"],
                    arguments.get("k", 10),
                    arguments.get("file_types")
                )
                return [TextContent(type="text", text=json.dumps(results, indent=2))]
            
            elif name == "get_snippet":
                snippet = await self.indexer.get_snippet(
                    arguments["file_path"],
                    arguments.get("start_line"),
                    arguments.get("end_line"),
                    arguments.get("symbol_name")
                )
                return [TextContent(type="text", text=snippet)]
            
            elif name == "call_graph":
                graph = await self.indexer.get_call_graph(
                    arguments["symbol"],
                    arguments.get("direction", "both"),
                    arguments.get("depth", 1)
                )
                return [TextContent(type="text", text=json.dumps(graph, indent=2))]
            
            elif name == "find_similar":
                results = await self.indexer.find_similar(
                    arguments["code_snippet"],
                    arguments.get("k", 5),
                    arguments.get("min_similarity", 0.7)
                )
                return [TextContent(type="text", text=json.dumps(results, indent=2))]
            
            elif name == "get_file_summary":
                summary = await self.indexer.get_file_summary(arguments["file_path"])
                return [TextContent(type="text", text=json.dumps(summary, indent=2))]
            
            elif name == "find_tests":
                tests = await self.indexer.find_associated_tests(arguments["file_path"])
                return [TextContent(type="text", text=json.dumps(tests, indent=2))]
            
            elif name == "index_status":
                status = await self.indexer.get_index_status()
                return [TextContent(type="text", text=json.dumps(status, indent=2))]
            
            elif name == "reindex":
                result = await self.indexer.reindex(
                    arguments.get("paths"),
                    arguments.get("full", False)
                )
                return [TextContent(type="text", text=json.dumps(result, indent=2))]
            
            else:
                raise ValueError(f"Unknown tool: {name}")
    
    async def run(self):
        """Run the MCP server"""
        logger.info(f"Starting repo-indexer server for {self.repo_path}")
        logger.info(f"Database at {self.db_path}")
        
        # Initial index if database doesn't exist
        if not self.db_path.exists():
            logger.info("Performing initial indexing...")
            await self.indexer.reindex(full=True)
        
        # Start the server with stdio transport
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(read_stream, write_stream, self.server.create_initialization_options())

def main():
    """Main entry point"""
    server = RepoIndexerServer()
    asyncio.run(server.run())

if __name__ == "__main__":
    # Special handling for --init flag
    if len(sys.argv) > 1 and sys.argv[1] == "--init":
        server = RepoIndexerServer()
        asyncio.run(server.indexer.reindex(full=True))
        print("Initial indexing complete!")
    else:
        main()