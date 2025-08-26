/**
 * Code indexing logic for Ruby/Rails projects
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import { IndexDatabase } from './database.js';
import { RubyParser, RubyParseResult } from './ruby-parser.js';

export interface SearchResult {
  file_path: string;
  symbol_name: string;
  symbol_type: string;
  start_line: number;
  end_line: number;
  score?: number;
  snippet?: string;
}

export interface CallGraphResult {
  symbol: string;
  callers?: any[];
  callees?: any[];
  depth: number;
}

export class CodeIndexer {
  private repoPath: string;
  private db: IndexDatabase;
  private parser: RubyParser;
  private railsPatterns: Map<string, RegExp>;

  constructor(repoPath: string, db: IndexDatabase, rubyParserPath: string) {
    this.repoPath = path.resolve(repoPath);
    this.db = db;
    this.parser = new RubyParser(rubyParserPath);

    // Rails-specific patterns
    this.railsPatterns = new Map([
      ['model', /app\/models\/.*\.rb$/],
      ['controller', /app\/controllers\/.*\.rb$/],
      ['service', /app\/services\/.*\.rb$/],
      ['job', /(app\/jobs\/|app\/sidekiq\/).*\.rb$/],
      ['policy', /app\/policies\/.*\.rb$/],
      ['mailer', /app\/mailers\/.*\.rb$/],
      ['helper', /app\/helpers\/.*\.rb$/],
      ['concern', /app\/(controllers|models)\/concerns\/.*\.rb$/],
      ['spec', /(spec|test)\/.*_(spec|test)\.rb$/],
      ['migration', /db\/migrate\/.*\.rb$/]
    ]);
  }

  /**
   * Determine Rails file type based on path
   */
  private getFileType(filePath: string): string {
    const relativePath = path.relative(this.repoPath, filePath);
    
    for (const [type, pattern] of this.railsPatterns) {
      if (pattern.test(relativePath)) {
        return type;
      }
    }
    
    return 'ruby';
  }

  /**
   * Calculate file hash for change detection
   */
  private calculateFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Find all Ruby files in the repository
   */
  private async findRubyFiles(paths?: string[]): Promise<string[]> {
    const patterns = paths || ['**/*.rb'];
    const ignorePatterns = [
      '**/node_modules/**',
      '**/vendor/**',
      '**/tmp/**',
      '**/log/**',
      '**/.git/**',
      '**/coverage/**',
      '**/public/**'
    ];

    const files: string[] = [];
    
    for (const pattern of patterns) {
      const searchPattern = path.isAbsolute(pattern) 
        ? pattern 
        : path.join(this.repoPath, pattern);
        
      const matches = await glob(searchPattern, {
        ignore: ignorePatterns.map(p => path.join(this.repoPath, p)),
        absolute: true
      });
      
      files.push(...matches);
    }

    return [...new Set(files)]; // Remove duplicates
  }

  /**
   * Index a single Ruby file
   */
  private async indexFile(filePath: string): Promise<void> {
    try {
      // Calculate hash to check if file changed
      const hash = this.calculateFileHash(filePath);
      const existingFile = this.db.getFile(filePath);
      
      if (existingFile && existingFile.hash === hash) {
        // File hasn't changed, skip indexing
        return;
      }

      // Parse the file
      const parseResult = await this.parser.parseFile(filePath);
      
      if (parseResult.error) {
        console.error(`Error parsing ${filePath}: ${parseResult.error}`);
        return;
      }

      // Start transaction
      this.db.beginTransaction();
      
      try {
        // Update or insert file record
        const fileId = this.db.upsertFile({
          path: filePath,
          hash: hash,
          last_indexed: new Date().toISOString(),
          file_type: this.getFileType(filePath),
          line_count: parseResult.line_count
        });

        // Delete old symbols for this file
        this.db.deleteSymbolsForFile(fileId);

        // Insert new symbols
        for (const symbol of parseResult.symbols) {
          const symbolId = this.db.insertSymbol({
            file_id: fileId,
            name: symbol.name,
            type: symbol.type,
            parent_symbol: symbol.parent_symbol,
            start_line: symbol.start_line,
            end_line: symbol.end_line,
            signature: symbol.signature,
            visibility: symbol.visibility,
            documentation: symbol.documentation
          });

          // TODO: Process calls, associations, etc.
        }

        this.db.commit();
      } catch (error) {
        this.db.rollback();
        throw error;
      }
    } catch (error) {
      console.error(`Failed to index ${filePath}: ${error}`);
    }
  }

  /**
   * Search for symbols in the codebase
   */
  async searchSymbols(query: string, k: number = 10, fileTypes?: string[]): Promise<SearchResult[]> {
    // Transform query for FTS5
    const ftsQuery = query.split(' ').map(term => `"${term}"`).join(' OR ');
    
    const results = this.db.searchSymbols(ftsQuery, fileTypes, k);
    
    return results.map(r => ({
      file_path: r.file_path,
      symbol_name: r.name,
      symbol_type: r.type,
      start_line: r.start_line,
      end_line: r.end_line,
      snippet: r.match_snippet
    }));
  }

  /**
   * Get a code snippet from a file
   */
  async getSnippet(
    filePath: string,
    startLine?: number,
    endLine?: number,
    symbolName?: string
  ): Promise<any> {
    const absolutePath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(this.repoPath, filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');

    // If symbol name is provided, find it in the database
    if (symbolName) {
      const file = this.db.getFile(absolutePath);
      if (file) {
        const symbols = this.db.getSymbolsForFile(file.id!);
        const symbol = symbols.find(s => s.name === symbolName);
        
        if (symbol) {
          startLine = symbol.start_line;
          endLine = symbol.end_line;
        }
      }
    }

    // Default to entire file if no range specified
    startLine = startLine || 1;
    endLine = endLine || lines.length;

    // Adjust for 0-based array indexing
    const snippet = lines.slice(startLine - 1, endLine).join('\n');

    return {
      file_path: filePath,
      start_line: startLine,
      end_line: endLine,
      snippet: snippet,
      language: 'ruby'
    };
  }

  /**
   * Analyze call graph for a symbol
   */
  async callGraph(
    symbol: string,
    direction: 'callers' | 'callees' | 'both' = 'both',
    depth: number = 2
  ): Promise<CallGraphResult> {
    const result: CallGraphResult = {
      symbol,
      depth
    };

    if (direction === 'callers' || direction === 'both') {
      result.callers = this.db.findCallers(symbol);
    }

    if (direction === 'callees' || direction === 'both') {
      // Find the symbol in the database
      const searchResults = this.db.searchSymbols(symbol, undefined, 1);
      if (searchResults.length > 0) {
        result.callees = this.db.findCallees(searchResults[0].id);
      }
    }

    return result;
  }

  /**
   * Find similar code patterns
   */
  async findSimilar(
    codeSnippet: string,
    k: number = 5,
    minSimilarity: number = 0.7
  ): Promise<any[]> {
    // Simple implementation using keyword extraction
    // In a production system, you might use embeddings or more sophisticated similarity
    
    // Extract meaningful tokens from the snippet
    const tokens = codeSnippet
      .split(/\s+/)
      .filter(t => t.length > 2 && !['def', 'end', 'class', 'module', 'if', 'else'].includes(t));
    
    if (tokens.length === 0) {
      return [];
    }

    // Search for files containing these tokens
    const query = tokens.slice(0, 5).join(' OR ');
    const results = this.db.searchSymbols(query, undefined, k * 2);

    // Simple similarity scoring based on token overlap
    const scored = results.map(r => {
      const resultTokens = new Set(
        (r.signature || '').split(/\s+/).concat(r.name.split(/[_:]/))
      );
      
      const overlap = tokens.filter(t => resultTokens.has(t)).length;
      const similarity = overlap / Math.max(tokens.length, resultTokens.size);
      
      return { ...r, similarity };
    });

    return scored
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  /**
   * Find test files for a given implementation file
   */
  async findTests(filePath: string): Promise<string[]> {
    const absolutePath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(this.repoPath, filePath);

    const baseName = path.basename(filePath, '.rb');
    const dirName = path.dirname(filePath);

    // Common test file patterns
    const testPatterns = [
      `spec/**/*${baseName}_spec.rb`,
      `test/**/*${baseName}_test.rb`,
      `spec/${baseName}_spec.rb`,
      `test/${baseName}_test.rb`
    ];

    // For Rails files, check conventional locations
    if (filePath.includes('app/')) {
      const relativePath = path.relative(this.repoPath, absolutePath);
      const specPath = relativePath.replace(/^app\//, 'spec/').replace(/\.rb$/, '_spec.rb');
      const testPath = relativePath.replace(/^app\//, 'test/').replace(/\.rb$/, '_test.rb');
      
      testPatterns.unshift(specPath, testPath);
    }

    const testFiles: string[] = [];
    
    for (const pattern of testPatterns) {
      const matches = await glob(path.join(this.repoPath, pattern));
      testFiles.push(...matches);
    }

    return [...new Set(testFiles)]; // Remove duplicates
  }

  /**
   * Reindex the codebase or specific paths
   */
  async reindex(paths?: string[], full: boolean = false): Promise<any> {
    const startTime = Date.now();
    
    // Validate Ruby environment first
    const validation = await this.parser.validateEnvironment();
    if (!validation.valid) {
      return {
        success: false,
        error: validation.message
      };
    }

    // Find files to index
    const files = await this.findRubyFiles(paths);
    console.log(`Found ${files.length} Ruby files to index`);

    let indexed = 0;
    let skipped = 0;
    let failed = 0;

    // Index files in batches
    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (file) => {
        try {
          await this.indexFile(file);
          indexed++;
        } catch (error) {
          console.error(`Failed to index ${file}: ${error}`);
          failed++;
        }
      }));

      // Progress update
      if ((i + batchSize) % 100 === 0) {
        console.log(`Indexed ${i + batchSize}/${files.length} files...`);
      }
    }

    const duration = Date.now() - startTime;
    const stats = this.db.getStats();

    return {
      success: true,
      filesProcessed: files.length,
      filesIndexed: indexed,
      filesFailed: failed,
      duration: `${(duration / 1000).toFixed(2)}s`,
      stats
    };
  }

  /**
   * Initialize the indexer (called on first run)
   */
  async initialize(): Promise<void> {
    const validation = await this.parser.validateEnvironment();
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    
    console.log(validation.message);
  }
}