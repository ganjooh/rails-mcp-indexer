# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ruby AST Parser - A Ruby AST (Abstract Syntax Tree) parser that extracts symbols, structure, and metadata from Ruby files. Uses parser gem for Ruby 2.7+ or Prism for Ruby 3.3+.

## Testing

```bash
# Test Ruby parser directly
echo 'class Test; def hello; "world"; end; end' | ruby src/ruby_ast_parser.rb /dev/stdin

# Parse a Ruby file
ruby src/ruby_ast_parser.rb path/to/file.rb
```

## Architecture

The Ruby parser (`src/ruby_ast_parser.rb`) extracts AST information using:
- **parser gem** for Ruby 2.7+
- **Prism** for Ruby 3.3+ (currently disabled due to compatibility issues)

The parser outputs structured JSON containing:
- Symbols (classes, modules, methods)
- Dependencies (requires, includes, extends)
- Rails-specific metadata (associations, validations, callbacks)
- File metadata (hash, line count, file type)

## Rails Pattern Recognition

The parser recognizes these Rails file types automatically:
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
- Ruby 3.3+ recommended (built-in Prism support, currently disabled)