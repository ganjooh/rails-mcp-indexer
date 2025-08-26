# Rails MCP Indexer - Basic Usage Examples

This guide demonstrates common usage patterns for the Rails MCP Indexer with Claude Code.

## Initial Setup

1. Add the MCP server to your Rails project's `.mcp.json`:
```json
{
  "mcpServers": {
    "rails-indexer": {
      "command": "/path/to/rails-mcp-indexer/venv/bin/python",
      "args": ["/path/to/rails-mcp-indexer/src/server.py"],
      "env": {
        "REPO_PATH": ".",
        "DB_PATH": ".rails-index/repo.db",
        "RUBY_AST_PARSER": "/path/to/rails-mcp-indexer/src/ruby_ast_parser.rb"
      }
    }
  }
}
```

2. Restart Claude Code to load the MCP server.

## Example 1: Finding ActiveRecord Models

### Find all models with specific associations
```
Claude, using the repo indexer, find all models that have a belongs_to :user association
```

### Search for validation patterns
```
Find all models with email validation using the indexer
```

## Example 2: Analyzing Controllers

### Find authentication logic
```
Use search_symbols to find all before_action authenticate methods in controllers
```

### Locate API endpoints
```
Search for all API::V1 controllers and their actions
```

## Example 3: Understanding Service Objects

### Find service classes
```
Find all classes ending with Service using the indexer
```

### Analyze service patterns
```
Use find_similar to find code similar to "def self.call" pattern
```

## Example 4: Test Coverage Analysis

### Find specs for a model
```
Use find_tests to locate all specs for app/models/user.rb
```

### Find untested files
```
Search for all models and then find which ones don't have corresponding spec files
```

## Example 5: Database Schema Analysis

### Find recent migrations
```
Search for migration files created in the last month
```

### Analyze associations
```
Use call_graph to understand all models that reference the User model
```

## Example 6: Code Refactoring

### Find duplicate code
```
Use find_similar with this validation pattern to find duplication:
validates :email, presence: true, uniqueness: true
```

### Analyze method usage
```
Use call_graph for User#authenticate to see all callers and callees
```

## Example 7: Debugging

### Trace method calls
```
Create a call graph for PaymentService#process with depth 3
```

### Find error handling
```
Search for all rescue blocks in the services directory
```

## Example 8: Performance Analysis

### Find N+1 queries
```
Search for includes and joins in all controllers
```

### Locate heavy queries
```
Find all uses of find_by_sql or connection.execute
```

## Advanced Usage

### Combining multiple searches
```
First search for all User-related models, then find their associations, 
then create a call graph showing the relationships
```

### Custom file type filtering
```
Search only in app/services and app/jobs for background job patterns
```

### Incremental reindexing
```
Reindex only the app/models directory after making changes
```

## Tips for Effective Use

1. **Be specific with queries**: Instead of "find user", use "User model authentication methods"

2. **Use file_types parameter**: Narrow your search to specific Rails components

3. **Combine tools**: Use search_symbols to find code, then get_snippet for full context

4. **Regular reindexing**: Run reindex() after major code changes

5. **Leverage call graphs**: Understand code dependencies before refactoring

## Troubleshooting

### Index not updating
```
Run reindex with full=True to rebuild the entire index
```

### Slow searches
```
Limit search scope with file_types parameter
```

### Missing results
```
Check if the file is excluded (vendor/, node_modules/) or needs reindexing
```