#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('[rails-mcp-indexer] Checking Ruby environment...');

try {
  // Check for Ruby
  const rubyVersion = execSync('ruby -v', { stdio: 'pipe' }).toString().trim();
  console.log('[rails-mcp-indexer] Found:', rubyVersion);
  
  // Extract version number
  const versionMatch = rubyVersion.match(/ruby (\d+\.\d+\.\d+)/);
  if (versionMatch) {
    const [major, minor] = versionMatch[1].split('.').map(Number);
    
    if (major < 2 || (major === 2 && minor < 7)) {
      console.warn('[rails-mcp-indexer] ⚠️  Ruby version is below 2.7. AST parsing may not work correctly.');
      console.warn('[rails-mcp-indexer] ⚠️  Please upgrade to Ruby 2.7+ for best results.');
    } else if (major >= 3 && minor >= 3) {
      console.log('[rails-mcp-indexer] ✅ Ruby 3.3+ detected - Prism support available');
    } else {
      console.log('[rails-mcp-indexer] ✅ Ruby 2.7+ detected - Parser gem will be used');
    }
  }
  
  // Check for bundler
  try {
    execSync('bundle -v', { stdio: 'pipe' });
    
    // Install Ruby dependencies
    const rubyDir = join(__dirname, '..', 'ruby');
    if (existsSync(join(rubyDir, 'Gemfile'))) {
      console.log('[rails-mcp-indexer] Installing Ruby dependencies...');
      try {
        execSync('bundle install --quiet', { 
          cwd: rubyDir, 
          stdio: 'pipe',
          env: { ...process.env, BUNDLE_SILENCE_ROOT_WARNING: '1' }
        });
        console.log('[rails-mcp-indexer] ✅ Ruby dependencies installed successfully');
      } catch (bundleError) {
        console.warn('[rails-mcp-indexer] ⚠️  Could not install Ruby gems automatically');
        console.warn('[rails-mcp-indexer] ⚠️  Please run: cd ruby && bundle install');
      }
    }
  } catch {
    console.warn('[rails-mcp-indexer] ⚠️  Bundler not found. Please install: gem install bundler');
  }
  
  console.log('[rails-mcp-indexer] ✅ Setup complete. Full AST parsing available.');
  
} catch (e) {
  console.warn('[rails-mcp-indexer] ⚠️  Ruby not found on this system');
  console.warn('[rails-mcp-indexer] ⚠️  The MCP server will use regex-based parsing (limited functionality)');
  console.warn('[rails-mcp-indexer] ⚠️  For full AST support, install Ruby 2.7+ from https://www.ruby-lang.org');
  console.log('[rails-mcp-indexer] ✅ Setup complete. Regex fallback mode enabled.');
}