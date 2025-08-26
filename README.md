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

- Python 3.8+
- Ruby 2.7+ (Ruby 3.3+ recommended for Prism support)
- SQLite3

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/rails-mcp-indexer
cd rails-mcp-indexer

# Run setup script
./scripts/setup.sh

# Or manual setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Configure with Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "rails-indexer": {
      "command": "path/to/rails-mcp-indexer/venv/bin/python",
      "args": ["path/to/rails-mcp-indexer/src/server.py"],
      "env": {
        "REPO_PATH": ".",
        "DB_PATH": ".rails-index/repo.db",
        "RUBY_AST_PARSER": "path/to/rails-mcp-indexer/src/ruby_ast_parser.rb"
      }
    }
  }
}
```

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

Developed for the Ruby on Rails community. Extracted and enhanced for the Ruby on Rails community.

## Support

- Issues: [GitHub Issues](https://github.com/yourusername/rails-mcp-indexer/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/rails-mcp-indexer/discussions)