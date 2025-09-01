# Changelog

All notable changes to Rails AST MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-09-01

### New Package Release
This is the first release under the new simplified name `rails-ast-mcp-server`, replacing the previous `@hiteshganjoo/rails-mcp-indexer` package.

### Added
- **Knowledge Graph**: Complete graph-based code navigation system
  - SQLite-backed graph store with nodes and edges tables
  - Automatic graph population from AST and database schema
  - Support for code relationships: inheritance, module inclusion, method definitions
  - Database relationships: tables, columns, foreign keys, indexes
  - Rails-specific edges: belongs_to, has_many, has_one, backs (model↔table)
- **Graph Navigation Tools**:
  - `graph_find_nodes` - Search nodes by kind, key, or label
  - `graph_neighbors` - Traverse connected nodes with edge filtering
  - `graph_explain` - Get detailed node information and suggested actions
  - `get_definition` - Retrieve code snippets with context
  - `list_rails` - List Rails associations, validations, and callbacks
- **Database Schema Awareness**: Parses `db/schema.rb` to understand database structure
- **Rails Association Mapping**: Automatically suggests associations from foreign keys
- **Native Ruby AST Parsing**: Uses Ruby's native parser when available
- **Smart Indexing**: Auto-indexes on startup with incremental updates

### Improved
- **Path Handling**: Now correctly handles relative paths and `.` 
- **Error Messages**: Better feedback when Rails project path is invalid
- **Simplified Package Name**: Changed from `@hiteshganjoo/rails-mcp-indexer` to `rails-ast-mcp-server`
- **Executable Name**: Changed from `mcp-server-rails-indexer` to `rails-ast-mcp-server`

### Fixed
- Connection issues with Claude Code when using relative paths
- Current working directory resolution for MCP protocol

## Migration from Previous Package

If you were using `@hiteshganjoo/rails-mcp-indexer`, update your configuration:

**Old:**
```bash
claude mcp add rails-indexer "npx @hiteshganjoo/rails-mcp-indexer" .
```

**New:**
```bash
claude mcp add rails-ast "npx rails-ast-mcp-server" .
```