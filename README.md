# Rails MCP Indexer

An intelligent MCP (Model Context Protocol) server for Ruby on Rails projects that provides advanced code indexing, search, and analysis capabilities. Features native Ruby AST parsing with automatic fallback to regex-based parsing when Ruby is not available.

## Why Use Rails MCP Indexer?

### Advantages Over Vanilla Claude Code / Cursor

| Feature | Vanilla Claude Code / Cursor | Rails MCP Indexer |
|---------|------------------------------|-------------------|
| **Rails DSL Understanding** | Basic text search | Full understanding of associations, validations, callbacks, scopes |
| **Symbol Search** | File-by-file scanning | Indexed database with instant FTS5 search |
| **Call Graph Analysis** | Not available | Trace method dependencies and call relationships |
| **Test Discovery** | Manual search | Automatic test file detection |
| **Performance** | Searches entire codebase each time | Pre-indexed SQLite database with sub-second queries |
| **Memory Usage** | Loads files into context | Efficient database queries, minimal context usage |
| **Rails Patterns** | Generic code understanding | Rails-specific: models, controllers, services, jobs, etc. |
| **AST Parsing** | Not available | Native Ruby AST parsing (when Ruby installed) |

### Key Benefits

1. **Context Efficiency**: Instead of loading entire files into Claude's context window, you can query specific symbols and relationships
2. **Rails Intelligence**: Understands Rails DSL - knows that `has_many :posts` creates methods like `posts`, `posts=`, `posts<<`, etc.
3. **Speed**: Pre-indexed database means instant searches vs scanning files every time
4. **Accurate Symbol Detection**: Native Ruby AST parsing (when available) ensures 100% accurate symbol detection

## Features

- 🔍 **Smart Symbol Search**: Find classes, methods, modules across your Rails codebase
- 📊 **Call Graph Analysis**: Trace method calls and dependencies
- 🧪 **Test Discovery**: Automatically find related test files
- 📁 **Rails-aware**: Understands Rails conventions and patterns
- 🚀 **Hybrid Parsing**: Native Ruby AST when available, regex fallback otherwise
- ⚡ **Fast Search**: SQLite FTS5 full-text search for instant results
- 🎯 **Context Efficient**: Minimizes token usage by returning only relevant code

## Quick Start

### 1. Install the Package

```bash
# Global installation (recommended for Claude Code)
npm install -g @hiteshganjoo/rails-mcp-indexer

# Or use directly with npx (no installation needed)
npx @hiteshganjoo/rails-mcp-indexer
```

### 2. Setup in Your Rails Project

#### Option A: Claude Code (Recommended)

```bash
# Navigate to your Rails project
cd /path/to/your/rails/project

# Add the MCP server with the current directory as the repo path
claude mcp add rails-indexer "npx @hiteshganjoo/rails-mcp-indexer" .

# Or if installed globally
claude mcp add rails-indexer mcp-server-rails-indexer .

# Restart Claude Code to activate
```

#### Option B: Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rails-indexer": {
      "command": "npx",
      "args": ["@hiteshganjoo/rails-mcp-indexer", "/path/to/your/rails/project"]
    }
  }
}
```

#### Option C: Cursor IDE

Add to your `.cursor/mcp.json` in your Rails project:

```json
{
  "mcpServers": {
    "rails-indexer": {
      "command": "npx",
      "args": ["@hiteshganjoo/rails-mcp-indexer"],
      "env": {
        "REPO_PATH": "."
      }
    }
  }
}
```

## Configuration

### Command Line Arguments

The server accepts a single argument for the repository path:

```bash
# Specify the Rails project path as an argument
npx @hiteshganjoo/rails-mcp-indexer /path/to/rails/project

# Or use current directory
npx @hiteshganjoo/rails-mcp-indexer .
```

### Environment Variables

You can also configure the server using environment variables:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `REPO_PATH` | Path to your Rails project | Current directory (`.`) | `/Users/me/myapp` |
| `DB_PATH` | SQLite database location | `{project}/.rails-index/repo.db` | `/tmp/rails.db` |
| `RUBY_AST_PARSER` | Custom Ruby parser path | Built-in parser | `/opt/parser.rb` |
| `AUTO_INDEX` | Enable auto-indexing on startup | `true` | `false` |

```bash
# Example with environment variables
REPO_PATH=/path/to/rails/app DB_PATH=/tmp/index.db npx @hiteshganjoo/rails-mcp-indexer

# Disable auto-indexing
AUTO_INDEX=false npx @hiteshganjoo/rails-mcp-indexer
```

### Auto-Indexing Features (v2.1.0+)

The indexer now includes intelligent auto-indexing capabilities:

#### 1. **Automatic Index on Startup**
- Automatically indexes your Rails project when the server starts
- Only indexes if:
  - Database doesn't exist (first run)
  - Repository path has changed
  - Database is empty
- Skips indexing if the existing index is valid
- Can be disabled with `AUTO_INDEX=false`

#### 2. **Project-Specific Database**
- Database is now stored at `{project}/.rails-index/repo.db` by default
- Each Rails project gets its own index
- No more conflicts when switching between projects

#### 3. **Incremental Indexing**
- Only re-indexes files that have changed since last index
- Checks file modification times vs last index time
- Much faster than full reindex for large projects

#### 4. **Smart Reindexing Detection**
- Automatically detects when a full reindex is needed:
  - When switching to a different Rails project
  - When the database is corrupted or missing
  - When explicitly requested via the `reindex` tool

### Project-Specific Configuration

Create a `.mcp.json` file in your Rails project root:

```json
{
  "rails-indexer": {
    "repoPath": ".",
    "dbPath": ".rails-index/repo.db",
    "autoIndex": true
  }
}
```

## Available Tools

### 🔍 search_symbols

Search for symbols (classes, methods, modules) in your codebase.

```typescript
{
  "query": "User",           // Search query
  "k": 10,                   // Number of results (default: 10)
  "file_types": ["model"]    // Optional: Filter by file types
}
```

### 📝 get_snippet

Extract code snippets from files.

```typescript
{
  "file_path": "app/models/user.rb",
  "start_line": 10,          // Optional
  "end_line": 20,            // Optional
  "symbol_name": "validate"  // Optional: Extract specific symbol
}
```

### 📊 call_graph

Analyze call relationships between methods.

```typescript
{
  "symbol": "User.authenticate",
  "direction": "both",       // "callers" | "callees" | "both"
  "depth": 2                 // Analysis depth
}
```

### 🔄 find_similar

Find code patterns similar to a given snippet.

```typescript
{
  "code_snippet": "validates :email, presence: true",
  "k": 5,                   // Number of results
  "min_similarity": 0.7     // Minimum similarity score
}
```

### 🧪 find_tests

Find test files related to an implementation file.

```typescript
{
  "file_path": "app/models/user.rb"
}
```

### 🔄 reindex

Reindex the codebase.

```typescript
{
  "paths": ["app/models"],  // Optional: Specific paths
  "full": false             // Full reindex
}
```

## Rails File Type Recognition

The indexer automatically recognizes these Rails patterns:

| Type | Pattern | Example |
|------|---------|---------|
| `model` | `app/models/**/*.rb` | User, Post, Comment |
| `controller` | `app/controllers/**/*.rb` | UsersController |
| `service` | `app/services/**/*.rb` | AuthenticationService |
| `job` | `app/jobs/**/*.rb`, `app/sidekiq/**/*.rb` | SendEmailJob |
| `policy` | `app/policies/**/*.rb` | UserPolicy |
| `mailer` | `app/mailers/**/*.rb` | UserMailer |
| `helper` | `app/helpers/**/*.rb` | ApplicationHelper |
| `concern` | `app/*/concerns/**/*.rb` | Searchable |
| `spec` | `spec/**/*_spec.rb`, `test/**/*_test.rb` | user_spec.rb |
| `migration` | `db/migrate/**/*.rb` | add_email_to_users.rb |

## How It Works

1. **Parsing**: Hybrid approach - native Ruby AST parser when Ruby is available, regex fallback otherwise
2. **Indexing**: Stores parsed data in SQLite with FTS5 for fast search
3. **MCP Protocol**: Exposes tools via Model Context Protocol for AI assistants

### Ruby Support (Optional)

The indexer works **without Ruby installation**, but having Ruby installed provides more accurate parsing:

| Ruby Version | Support Level | Features |
|--------------|---------------|----------|
| **No Ruby** | ✅ Full Support | Regex-based parser, all features work |
| **Ruby 2.7+** | ✅ Enhanced | Native AST parsing via `parser` gem |
| **Ruby 3.3+** | ✅ Enhanced | Native AST parsing via `prism` (built-in) |

When Ruby is detected during installation, the package automatically:
1. Detects your Ruby version
2. Installs appropriate parser gems
3. Uses native AST parsing for 100% accurate symbol detection
4. Falls back to regex parsing if native parsing fails

## Architecture

```
┌──────────────────┐     ┌──────────────────┐
│  Claude/AI Agent │────▶│   MCP Protocol   │
└──────────────────┘     └──────────────────┘
                                │
                                ▼
                         ┌──────────────────┐
                         │  Rails MCP Server│
                         └──────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │ Ruby Parser  │ │   Indexer    │ │   Database   │
         └──────────────┘ └──────────────┘ └──────────────┘
                │               │               │
                └───────────────┼───────────────┘
                                ▼
                        ┌──────────────────┐
                        │  Rails Codebase  │
                        └──────────────────┘
```

## Development

### Prerequisites

- Node.js 18+
- TypeScript 5+

### Setup

```bash
# Clone the repository
git clone https://github.com/ganjooh/rails-mcp-indexer
cd rails-mcp-indexer

# Install dependencies
npm install

# Build the project
npm run build

# Test with sample Rails app
REPO_PATH=./sample_rails_app npm start
```

### Testing

```bash
# Run tests
npm test

# Test with MCP Inspector
npx @modelcontextprotocol/inspector npm start
```

## Usage Examples

### Real-World Advantages in Claude Code

#### Without Rails MCP Indexer (Vanilla Claude Code)
```
User: "Find all authentication methods in my Rails app"
Claude: *Searches through multiple files, uses significant context*
"Let me search through your codebase... 
Reading app/models/user.rb...
Reading app/controllers/application_controller.rb...
Reading app/controllers/sessions_controller.rb..."
[Uses 5000+ tokens just to find methods]
```

#### With Rails MCP Indexer
```
User: "Find all authentication methods in my Rails app"
Claude: *Instantly queries the index*
Found 5 authentication-related methods:
- User.authenticate (app/models/user.rb:37)
- SessionsController#create (app/controllers/sessions_controller.rb:8)
- ApplicationController#authenticate_user! (app/controllers/application_controller.rb:15)
[Uses only 200 tokens with precise results]
```

### Common Use Cases

#### 1. Finding Symbol Definitions
```bash
# Ask Claude Code:
"Where is the User.authenticate method defined?"
# Rails MCP Indexer instantly returns: app/models/user.rb:37-41

# Vanilla Claude Code would need to:
# - Search through all model files
# - Parse each file to find the method
# - Use significant context tokens
```

#### 2. Understanding Model Relationships
```bash
# Ask Claude Code:
"What associations does the User model have?"
# Rails MCP Indexer knows:
# - has_many :posts
# - has_many :comments, through: :posts
# - has_one :profile
# - belongs_to :organization

# Vanilla Claude Code would need to load and parse the entire User model
```

#### 3. Finding Related Tests
```bash
# Ask Claude Code:
"Find tests for the User model"
# Rails MCP Indexer instantly returns:
# - spec/models/user_spec.rb
# - spec/requests/users_spec.rb
# - test/models/user_test.rb

# Vanilla Claude Code would manually search through spec/ and test/ directories
```

### Direct Tool Usage

```javascript
// Example: Search for authentication-related symbols
const result = await mcpClient.callTool('search_symbols', {
  query: 'authenticate',
  k: 5,
  file_types: ['model', 'controller']
});

// Example: Get call graph for a method
const graph = await mcpClient.callTool('call_graph', {
  symbol: 'User.authenticate',
  direction: 'both',
  depth: 2
});

// Example: Find similar validation patterns
const similar = await mcpClient.callTool('find_similar', {
  code_snippet: 'validates :email, presence: true, uniqueness: true',
  k: 5
});
```

## Troubleshooting

### Server not connecting

1. Check Node.js version: `node --version` (should be 18+)
2. Verify paths: Ensure REPO_PATH points to valid Rails project
3. Check logs: Run with `DEBUG=* npm start`

### Index not updating

1. Run reindex: Use the `reindex` tool with `full: true`
2. Check permissions: Ensure write access to DB_PATH directory
3. Verify file patterns: Check if your Rails structure matches expected patterns

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- Issues: [GitHub Issues](https://github.com/ganjooh/rails-mcp-indexer/issues)
- Discussions: [GitHub Discussions](https://github.com/ganjooh/rails-mcp-indexer/discussions)

## Acknowledgments

Built with [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk) for seamless AI integration.