#!/bin/bash

# Setup script for Rails MCP Indexer

set -e

echo "🚀 Setting up Rails MCP Indexer..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Ruby version
echo "Checking Ruby installation..."
if command -v ruby &> /dev/null; then
    ruby_version=$(ruby -v | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    ruby_major=$(echo $ruby_version | cut -d. -f1)
    ruby_minor=$(echo $ruby_version | cut -d. -f2)
    
    echo -e "${GREEN}✓${NC} Ruby version: $ruby_version"
    
    if [ "$ruby_major" -eq 3 ] && [ "$ruby_minor" -ge 3 ]; then
        echo -e "${GREEN}✓${NC} Ruby 3.3+ detected - Prism support available"
    else
        echo -e "${YELLOW}⚠${NC}  Ruby $ruby_version detected - Installing parser gem for AST parsing..."
        gem install parser
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓${NC} Parser gem installed successfully"
        else
            echo -e "${RED}❌${NC} Failed to install parser gem. Please install manually: gem install parser"
            exit 1
        fi
    fi
else
    echo -e "${RED}❌${NC} Ruby not found. Please install Ruby 2.7+ (3.3+ recommended)"
    echo "   Visit: https://www.ruby-lang.org/en/documentation/installation/"
    exit 1
fi

echo ""

# Check Python
echo "Checking Python installation..."
if command -v python3 &> /dev/null; then
    python_version=$(python3 --version | grep -oE '[0-9]+\.[0-9]+')
    python_major=$(echo $python_version | cut -d. -f1)
    python_minor=$(echo $python_version | cut -d. -f2)
    
    if [ "$python_major" -eq 3 ] && [ "$python_minor" -ge 8 ]; then
        echo -e "${GREEN}✓${NC} Python version: $python_version"
    else
        echo -e "${RED}❌${NC} Python $python_version found but 3.8+ required"
        exit 1
    fi
else
    echo -e "${RED}❌${NC} Python 3 not found. Please install Python 3.8+"
    echo "   Visit: https://www.python.org/downloads/"
    exit 1
fi

echo ""

# Check SQLite3
echo "Checking SQLite3..."
if command -v sqlite3 &> /dev/null; then
    sqlite_version=$(sqlite3 --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    echo -e "${GREEN}✓${NC} SQLite3 version: $sqlite_version"
else
    echo -e "${YELLOW}⚠${NC}  SQLite3 not found. Installing may be required for some features."
fi

echo ""

# Create virtual environment
echo "Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✓${NC} Virtual environment created"
else
    echo -e "${GREEN}✓${NC} Virtual environment already exists"
fi

# Activate venv and install dependencies
echo "Installing Python dependencies..."
source venv/bin/activate
pip install --upgrade pip > /dev/null 2>&1
pip install -r requirements.txt
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Python dependencies installed"
else
    echo -e "${RED}❌${NC} Failed to install Python dependencies"
    exit 1
fi

echo ""

# Test Ruby parser
echo "Testing Ruby AST parser..."
test_ruby_code='class Test; def hello; "world"; end; end'
echo "$test_ruby_code" | ruby src/ruby_ast_parser.rb /dev/stdin > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Ruby AST parser working correctly"
else
    echo -e "${YELLOW}⚠${NC}  Ruby AST parser test failed - check src/ruby_ast_parser.rb"
    echo "   This might be due to missing Prism/parser gem"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Setup complete!${NC} 🎉"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Add to your Rails project's .mcp.json:"
echo "   {\"mcpServers\": {"
echo "     \"rails-indexer\": {"
echo "       \"command\": \"$(pwd)/venv/bin/python\","
echo "       \"args\": [\"$(pwd)/src/server.py\"],"
echo "       \"env\": {"
echo "         \"REPO_PATH\": \".\","
echo "         \"DB_PATH\": \".rails-index/repo.db\","
echo "         \"RUBY_AST_PARSER\": \"$(pwd)/src/ruby_ast_parser.rb\""
echo "       }"
echo "     }"
echo "   }}"
echo ""
echo "2. Restart Claude Code to load the MCP server"
echo ""
echo "3. Use the indexer tools in your conversations:"
echo "   - search_symbols: Find classes, methods, modules"
echo "   - get_snippet: Get AST-aware code snippets"
echo "   - call_graph: Analyze method dependencies"
echo "   - find_similar: Find similar code patterns"
echo "   - find_tests: Locate test files"
echo "   - reindex: Update the code index"
echo ""
echo "📚 For more examples, see: examples/basic_usage.md"
echo ""