# Rails MCP Indexer

An intelligent code indexing and retrieval system for Ruby on Rails projects, designed to work seamlessly with Claude Code via the Model Context Protocol (MCP).

## Features

- **AST-based Ruby parsing**: Uses Prism (Ruby 3.3+) or parser gem for accurate AST extraction
- **Rails-aware indexing**: Recognizes Rails patterns (models, controllers, associations, validations)
- **Smart symbol search**: Find classes, methods, modules with ranked relevance
- **Call graph analysis**: Understand method dependencies and relationships
- **AST-aware snippets**: Extract complete, syntactically correct code blocks
- **Incremental indexing**: Fast updates for changed files only
- **SQLite FTS5**: Full-text search with efficient retrieval

## Quick Start

### Prerequisites

- Node.js 18+ (for npm package)
- Ruby 2.7+ (Ruby 3.3+ recommended for Prism support)
- SQLite3
- [Claude Desktop](https://claude.ai/download) or MCP-compatible client

### Installation

#### Option 1: NPM Global Install (Recommended)

```bash
# Install globally via npm
npm install -g @hiteshganjoo/rails-mcp-indexer

# Or use directly with npx (no install required)
npx -y @hiteshganjoo/rails-mcp-indexer
```

#### Option 2: From Source

```bash
# Clone the repository
git clone https://github.com/ganjooh/rails-mcp-indexer
cd rails-mcp-indexer

# Install dependencies and build
npm install
npm run build
```

#### Option 3: Python Version (Legacy)

```bash
# Clone and enter directory
git clone https://github.com/ganjooh/rails-mcp-indexer
cd rails-mcp-indexer

# Run Python setup script
./scripts/setup.sh
```

## Integration Guides

### Claude Code (CLI) - Recommended

Claude Code provides a simple CLI interface for managing MCP servers.

#### Quick Setup (Global)

```bash
# Add the Rails indexer globally
claude mcp add rails-indexer -- npx -y @hiteshganjoo/rails-mcp-indexer

# With environment configuration
claude mcp add rails-indexer \
  --env REPO_PATH=/path/to/your/rails/project \
  --env DB_PATH=/path/to/your/rails/project/.rails-index/repo.db \
  -- npx -y @hiteshganjoo/rails-mcp-indexer
```

#### Project-Scoped Setup

```bash
# Navigate to your Rails project
cd /path/to/your/rails/project

# Add for this project only
claude mcp add rails-indexer \
  --env REPO_PATH=. \
  --env DB_PATH=./.rails-index/repo.db \
  -- npx -y @hiteshganjoo/rails-mcp-indexer
```

#### Managing the Server

```bash
# List all MCP servers
claude mcp list

# Get server details
claude mcp get rails-indexer

# Remove the server
claude mcp remove rails-indexer
```

### Cursor IDE Integration

Cursor supports MCP servers through project-specific configuration.

#### Setup Instructions

1. **Create the configuration file** in your Rails project root:

```bash
mkdir -p .cursor
touch .cursor/mcp.json
```

2. **Add the Rails indexer configuration**:

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "rails-indexer": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@hiteshganjoo/rails-mcp-indexer"],
      "env": {
        "REPO_PATH": ".",
        "DB_PATH": "./.rails-index/repo.db"
      }
    }
  }
}
```

3. **Restart Cursor** to load the MCP server

4. **Verify the integration** by using Cursor's AI assistant - it should now have access to Rails indexing tools

#### Alternative: Global Cursor Configuration

For system-wide availability, add to Cursor's global MCP configuration:

**Location**: `~/.cursor/mcp.json` (macOS/Linux) or `%USERPROFILE%\.cursor\mcp.json` (Windows)

### Claude Desktop (Manual Configuration)

For the traditional Claude Desktop app, manually edit the configuration file.

#### Configuration File Locations

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/claude/claude_desktop_config.json`

#### Using NPM Package (Recommended)

```json
{
  "mcpServers": {
    "rails-indexer": {
      "command": "npx",
      "args": ["-y", "@hiteshganjoo/rails-mcp-indexer"],
      "env": {
        "REPO_PATH": "/path/to/your/rails/project",
        "DB_PATH": "/path/to/your/rails/project/.rails-index/repo.db"
      }
    }
  }
}
```

#### Using Local Installation

```json
{
  "mcpServers": {
    "rails-indexer": {
      "command": "node",
      "args": ["/path/to/rails-mcp-indexer/dist/server.js"],
      "env": {
        "REPO_PATH": "/path/to/your/rails/project",
        "DB_PATH": "/path/to/your/rails/project/.rails-index/repo.db",
        "RUBY_AST_PARSER": "/path/to/rails-mcp-indexer/src/ruby_ast_parser.rb"
      }
    }
  }
}
```

### Configuration Options

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|  
| `REPO_PATH` | Path to your Rails project | `.` (current directory) |
| `DB_PATH` | SQLite database location | `.rails-index/repo.db` |
| `RUBY_AST_PARSER` | Path to Ruby parser script | Auto-detected |

#### Ruby Version Requirements

- **Ruby 2.7+**: Requires `parser` gem (`gem install parser`)
- **Ruby 3.3+**: Built-in Prism support (recommended)

#### Verifying Installation

After setup, the AI assistant should have access to these tools:
- `search_symbols` - Search for Ruby symbols
- `get_snippet` - Extract code snippets
- `call_graph` - Analyze method dependencies
- `find_similar` - Find similar code patterns
- `find_tests` - Locate test files
- `reindex` - Update the code index

## Available MCP Tools

### search_symbols
Search for Ruby symbols in your Rails codebase:
```python
search_symbols(
    query="User authentication",
    k=10,
    file_types=["model", "controller"]
)
```

### get_snippet
Extract AST-aware code snippets:
```python
get_snippet(
    file_path="app/models/user.rb",
    symbol_name="authenticate"
)
```

### call_graph
Analyze method dependencies:
```python
call_graph(
    symbol="User#authenticate",
    direction="both",  # "callers", "callees", or "both"
    depth=2
)
```

### find_similar
Find similar code patterns:
```python
find_similar(
    code_snippet="has_many :posts, dependent: :destroy",
    k=5,
    min_similarity=0.7
)
```

### find_tests
Locate test files for implementation:
```python
find_tests(
    file_path="app/models/user.rb"
)
```

### reindex
Update the code index:
```python
reindex(
    paths=["app/models/"],
    full=False
)
```

## Rails File Type Recognition

The indexer automatically recognizes these Rails patterns:

| Type | Pattern | Example |
|------|---------|---------|
| `model` | `app/models/**/*.rb` | User, Post, Comment |
| `controller` | `app/controllers/**/*.rb` | UsersController |
| `service` | `app/services/**/*.rb` | AuthenticationService |
| `job` | `app/jobs/**/*.rb` | SendEmailJob |
| `policy` | `app/policies/**/*.rb` | UserPolicy |
| `mailer` | `app/mailers/**/*.rb` | UserMailer |
| `helper` | `app/helpers/**/*.rb` | ApplicationHelper |
| `concern` | `app/*/concerns/**/*.rb` | Searchable |
| `spec` | `spec/**/*_spec.rb` | user_spec.rb |
| `migration` | `db/migrate/**/*.rb` | add_email_to_users.rb |

## Performance

- **Initial indexing**: ~100-150 files/second
- **Incremental updates**: ~200-250 files/second
- **Search response**: <100ms for most queries
- **Database size**: ~10MB per 1000 files

### Optimization Tips

1. The indexer automatically excludes: `vendor/`, `node_modules/`, `tmp/`, `log/`, `.git/`
2. Use incremental indexing after initial setup
3. Leverage `file_types` parameter to narrow search scope
4. Consider indexing only `app/`, `lib/`, and `spec/` directories

## Examples

### Finding ActiveRecord Associations
```python
# Find all has_many associations
search_symbols("has_many", file_types=["model"])

# Find User model associations
get_snippet("app/models/user.rb", symbol_name="has_many")
```

### Analyzing Controller Actions
```python
# Find all authentication-related actions
search_symbols("authenticate before_action", file_types=["controller"])

# Get the full implementation
get_snippet("app/controllers/application_controller.rb", symbol_name="authenticate_user")
```

### Understanding Service Objects
```python
# Find service objects with similar patterns
find_similar("class ApplicationService\n  def self.call(...)\n    new(...).call\n  end")
```

## Troubleshooting

### Ruby Parser Issues

For Ruby < 3.3, install the parser gem:
```bash
gem install parser
```

For Ruby >= 3.3, Prism should be built-in. If missing:
```bash
gem install prism
```

### Database Corruption

Reset the index database:
```bash
rm -rf .rails-index/repo.db
# Restart MCP server to rebuild
```

### MCP Connection Issues

Verify your `.mcp.json` configuration and ensure paths are absolute.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/rails-mcp-indexer
cd rails-mcp-indexer

# Install development dependencies
pip install -e ".[dev]"

# Run tests
python -m pytest tests/
ruby tests/test_parser.rb
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│ Claude Code │────▶│  MCP Server │────▶│ Ruby Parser  │
└─────────────┘     └─────────────┘     └──────────────┘
                            │                     │
                            ▼                     ▼
                    ┌──────────────┐      ┌──────────┐
                    │   Indexer    │◀─────│   AST    │
                    └──────────────┘      └──────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │  SQLite DB   │
                    └──────────────┘
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Originally developed as part of Smart Financial 2.0 project. Extracted and enhanced for the Ruby on Rails community.

## Support

- Issues: [GitHub Issues](https://github.com/ganjooh/rails-mcp-indexer/issues)
- Discussions: [GitHub Discussions](https://github.com/ganjooh/rails-mcp-indexer/discussions)