# Ruby AST Parser

A Ruby AST (Abstract Syntax Tree) parser that extracts symbols, structure, and metadata from Ruby files. Originally part of Rails MCP Indexer.

## Features

- **AST-based Ruby parsing**: Uses parser gem (Ruby 2.7+) or Prism (Ruby 3.3+) for accurate AST extraction
- **Rails-aware**: Recognizes Rails patterns (models, controllers, associations, validations)
- **Symbol extraction**: Extracts classes, methods, modules with metadata
- **Dependency tracking**: Tracks requires, includes, extends
- **JSON output**: Outputs structured JSON for easy integration

## Quick Start

### Prerequisites

- Ruby 2.7+ (Ruby 3.3+ recommended for Prism support)
- `parser` gem for Ruby < 3.3

### Installation

```bash
# For Ruby < 3.3, install the parser gem
gem install parser

# Clone the repository
git clone https://github.com/ganjooh/rails-mcp-indexer
cd rails-mcp-indexer
```

## Usage

### Command Line

```bash
# Parse a Ruby file
ruby src/ruby_ast_parser.rb path/to/file.rb

# Parse from stdin
echo 'class Test; def hello; "world"; end; end' | ruby src/ruby_ast_parser.rb /dev/stdin
```

### Output Format

The parser outputs JSON with the following structure:

```json
{
  "hash": "file_content_hash",
  "file_type": "model|controller|service|etc",
  "line_count": 100,
  "symbols": [
    {
      "name": "ClassName",
      "type": "class|module|method",
      "parent": "ParentClass",
      "start_line": 1,
      "end_line": 10,
      "visibility": "public|private|protected",
      "references": [],
      "metadata": []
    }
  ],
  "requires": [],
  "require_relatives": [],
  "includes": [],
  "extends": [],
  "classes": [],
  "modules": [],
  "methods": [],
  "associations": [],
  "validations": [],
  "callbacks": []
}
```

## Ruby Version Requirements

- **Ruby 2.7+**: Requires `parser` gem (`gem install parser`)
- **Ruby 3.3+**: Built-in Prism support (recommended, but currently disabled due to compatibility issues)

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

## Examples

### Parsing a Rails Model
```bash
ruby src/ruby_ast_parser.rb app/models/user.rb
```

### Parsing Multiple Files
```bash
for file in app/models/*.rb; do
  ruby src/ruby_ast_parser.rb "$file" > "${file%.rb}.json"
done
```

### Integration with Other Tools
```ruby
require 'json'

# Parse and process the output
output = `ruby src/ruby_ast_parser.rb #{file_path}`
data = JSON.parse(output)

# Access extracted symbols
data['symbols'].each do |symbol|
  puts "#{symbol['type']}: #{symbol['name']}"
end
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


## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
# Clone the repo
git clone https://github.com/ganjooh/rails-mcp-indexer
cd rails-mcp-indexer

# Test the parser
echo 'class Test; def hello; "world"; end; end' | ruby src/ruby_ast_parser.rb /dev/stdin
```

## Architecture

```
┌──────────────┐
│  Ruby File   │
└──────────────┘
       │
       ▼
┌──────────────┐
│ Ruby Parser  │ ──► parser gem (Ruby < 3.3)
└──────────────┘ ──► Prism (Ruby 3.3+)
       │
       ▼
┌──────────────┐
│     AST      │
└──────────────┘
       │
       ▼
┌──────────────┐
│ JSON Output  │
└──────────────┘
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Developed for the Ruby on Rails community.

## Support

- Issues: [GitHub Issues](https://github.com/ganjooh/rails-mcp-indexer/issues)
- Discussions: [GitHub Discussions](https://github.com/ganjooh/rails-mcp-indexer/discussions)