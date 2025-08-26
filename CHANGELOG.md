# Changelog

All notable changes to Rails MCP Indexer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] - 2025-08-26

### Fixed
- **Critical**: Fixed MCP server connection issues by aligning with official MCP server pattern
  - Removed `main` field from package.json (official servers use `main: null`)
  - Renamed server.ts to index.ts following official convention
  - Updated all references from server.js to index.js
  - Server now properly responds to MCP protocol initialization messages

## [1.0.5] - 2025-08-25

### Fixed
- Updated bin executable name to mcp-server-rails-indexer

## [1.0.4] - 2025-08-25

### Fixed
- Fixed bin configuration in package.json

## [1.0.3] - 2025-08-25

### Fixed
- Removed stderr logging that could interfere with MCP communication

## [1.0.2] - 2025-08-25

### Fixed
- Fixed ES module compatibility issues

## [1.0.1] - 2025-08-25

### Changed
- Documentation improvements

## [1.0.0] - 2024-01-26

### Added
- Initial release of Rails MCP Indexer
- AST-based Ruby code parsing using Prism (Ruby 3.3+) or parser gem
- Full-text search with SQLite FTS5
- Rails-aware file type detection (models, controllers, services, etc.)
- MCP tools for code analysis:
  - `search_symbols` - Search for classes, methods, modules
  - `get_snippet` - Extract AST-aware code blocks
  - `call_graph` - Analyze method dependencies
  - `find_similar` - Find similar code patterns
  - `find_tests` - Locate test files for implementations
  - `reindex` - Update code index incrementally
- Incremental indexing for performance
- Comprehensive documentation and examples
- Setup script for easy installation
- PyPI package configuration

### Features
- Support for Ruby 2.7+ (optimized for Ruby 3.3+)
- Automatic exclusion of vendor/, node_modules/, tmp/, log/, .git/
- Rails pattern recognition (associations, validations, callbacks)
- Performance: ~100-150 files/second indexing speed
- Database size: ~10MB per 1000 files

### Credits
- Developed for the Ruby on Rails community
- Extracted and enhanced for the Ruby on Rails community