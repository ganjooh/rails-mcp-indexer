#!/bin/bash
# Script to publish to npm

echo "🚀 Publishing Rails MCP Indexer to npm..."

# Check if logged in to npm
npm whoami >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Not logged in to npm. Please run: npm login"
    exit 1
fi

# Clean and build
echo "🧹 Cleaning dist directory..."
rm -rf dist/

echo "📦 Building project..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

# Publish to npm
echo "📤 Publishing to npm..."
npm publish --access public
if [ $? -ne 0 ]; then
    echo "❌ npm publish failed"
    exit 1
fi

echo "✅ Successfully published to npm!"
echo ""
echo "To install and test:"
echo "  npm install -g @hiteshganjoo/rails-mcp-indexer"
echo "  claude mcp add rails-indexer \"npx -y @hiteshganjoo/rails-mcp-indexer\""