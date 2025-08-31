# Rails MCP Indexer

An intelligent MCP (Model Context Protocol) server for Ruby on Rails projects that provides advanced code indexing, search, and analysis capabilities without requiring Ruby installation.

## Features

- 🔍 **Smart Symbol Search**: Find classes, methods, modules across your Rails codebase
- 📊 **Call Graph Analysis**: Trace method calls and dependencies
- 🧪 **Test Discovery**: Automatically find related test files
- 📁 **Rails-aware**: Understands Rails conventions and patterns
- 🚀 **No Ruby Required**: Works without Ruby installation using regex-based parsing
- ⚡ **Fast Search**: SQLite FTS5 full-text search for instant results

## Installation

### Via NPM (Recommended)

```bash
npm install -g @hiteshganjoo/rails-mcp-indexer
```

### Via Claude Code

```bash
claude mcp add rails-indexer "npx @hiteshganjoo/rails-mcp-indexer"
```

### Via Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rails-indexer": {
      "command": "npx",
      "args": ["@hiteshganjoo/rails-mcp-indexer"],
      "env": {
        "REPO_PATH": "/path/to/your/rails/project",
        "DB_PATH": "/path/to/index.db"
      }
    }
  }
}
```

## Configuration

### Environment Variables

- `REPO_PATH`: Path to your Rails project (default: current directory)
- `DB_PATH`: Path to SQLite database (default: `.rails-index/repo.db`)
- `RUBY_AST_PARSER`: Path to Ruby AST parser script (default: built-in)

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

1. **Parsing**: Uses regex-based Ruby parser to extract symbols and structure
2. **Indexing**: Stores parsed data in SQLite with FTS5 for fast search
3. **MCP Protocol**: Exposes tools via Model Context Protocol for AI assistants

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

## Examples

### Using with Claude Code

```bash
# Add the server
claude mcp add rails-indexer "npx @hiteshganjoo/rails-mcp-indexer"

# Now you can ask Claude:
# "Find all User model methods"
# "Show me the authentication logic"
# "Find tests for the User model"
```

### Direct Usage

```javascript
// Example: Search for symbols
const result = await mcpClient.callTool('search_symbols', {
  query: 'authenticate',
  k: 5
});

// Example: Get call graph
const graph = await mcpClient.callTool('call_graph', {
  symbol: 'User.authenticate',
  direction: 'both'
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