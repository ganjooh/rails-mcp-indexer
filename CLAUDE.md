# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rails MCP Indexer is an intelligent code indexing and retrieval system for Ruby on Rails projects that provides MCP (Model Context Protocol) integration for Claude Code. It uses AST-based parsing to understand Ruby code structure and provides tools for searching, analyzing, and understanding Rails codebases.

## Development Commands

### Initial Setup
```bash
./scripts/setup.sh
```

### Manual Setup (if script fails)
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Testing
```bash
# Run Python tests
python -m pytest tests/

# Test Ruby parser directly
echo 'class Test; def hello; "world"; end; end' | ruby src/ruby_ast_parser.rb /dev/stdin
```

### Code Quality
```bash
# Format code with Black
black src/ tests/ --line-length 100

# Lint with Flake8
flake8 src/ tests/ --max-line-length=100 --extend-ignore=E203,W503

# Type checking with MyPy
mypy src/
```

### Development Mode Installation
```bash
pip install -e ".[dev]"
```

## Architecture

The system consists of four main components:

1. **MCP Server** (`src/server.py`): Entry point that implements the MCP protocol and exposes tools to Claude Code
2. **Code Indexer** (`src/indexer.py`): Handles code analysis, indexing logic, and Rails-specific pattern recognition
3. **Database** (`src/database.py`): SQLite FTS5-based storage for indexed code with full-text search capabilities
4. **Ruby Parser** (`src/ruby_ast_parser.rb`): Ruby script that extracts AST information using Prism (Ruby 3.3+) or parser gem

## MCP Tools Available

- `search_symbols`: Find Ruby symbols (classes, methods, modules) with ranked relevance
- `get_snippet`: Extract AST-aware code snippets from specific files
- `call_graph`: Analyze method dependencies and relationships
- `find_similar`: Find similar code patterns across the codebase
- `find_tests`: Locate test files for implementation files
- `reindex`: Update the code index for changed files

## Rails Pattern Recognition

The indexer recognizes these Rails file types automatically:
- `model`: `app/models/**/*.rb`
- `controller`: `app/controllers/**/*.rb`
- `service`: `app/services/**/*.rb`
- `job`: `app/jobs/**/*.rb` and `app/sidekiq/**/*.rb`
- `policy`: `app/policies/**/*.rb`
- `mailer`: `app/mailers/**/*.rb`
- `helper`: `app/helpers/**/*.rb`
- `concern`: `app/*/concerns/**/*.rb`
- `spec`: `spec/**/*_spec.rb` and `test/**/*_test.rb`
- `migration`: `db/migrate/**/*.rb`

## Ruby Version Requirements

- Ruby 2.7+ minimum (parser gem required)
- Ruby 3.3+ recommended (built-in Prism support)
- Python 3.8+ required

## Environment Variables

When configuring the MCP server, these environment variables control behavior:
- `REPO_PATH`: Path to the Rails repository to index (default: ".")
- `DB_PATH`: Path to SQLite database file (default: ".index/repo.db")
- `RUBY_AST_PARSER`: Path to ruby_ast_parser.rb script