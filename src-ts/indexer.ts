/**
 * Code indexing logic for Ruby/Rails projects
 * Supports both native Ruby AST parsing and regex fallback
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import { IndexDatabase } from './database.js';
import { RubyParser, RubyParseResult } from './ruby-parser.js';
import { NativeRubyParser, NativeParseResult } from './ruby-parser-native.js';
import { SchemaParser } from './schema-parser.js';
import { RailsAssociationMapper } from './rails-association-mapper.js';

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
  private regexParser: RubyParser;
  private nativeParser: NativeRubyParser;
  private useNativeParser: boolean;
  private railsPatterns: Map<string, RegExp>;
  private schemaParser: SchemaParser;
  private associationMapper: RailsAssociationMapper;

  constructor(repoPath: string, db: IndexDatabase, rubyParserPath: string) {
    this.repoPath = path.resolve(repoPath);
    this.db = db;
    
    // Initialize both parsers
    this.regexParser = new RubyParser(rubyParserPath);
    this.nativeParser = new NativeRubyParser();
    
    // Initialize schema parser and association mapper
    this.schemaParser = new SchemaParser();
    this.associationMapper = new RailsAssociationMapper();
    
    // Prefer native parser if available
    this.useNativeParser = this.nativeParser.isAvailable();
    
    if (this.useNativeParser) {
      console.log(`[CodeIndexer] Using native Ruby AST parser (${this.nativeParser.getVersion()})`);
    } else {
      console.log('[CodeIndexer] Using regex-based parser (Ruby not available)');
    }

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

  async reindex(paths?: string[], full: boolean = false): Promise<any> {
    const startTime = Date.now();
    let filesProcessed = 0;
    let filesIndexed = 0;
    let filesFailed = 0;

    if (full) {
      this.db.clearAll();
    }

    // Store metadata about this indexing operation
    this.db.setMetadata('repo_path', this.repoPath);
    this.db.setMetadata('index_started_at', new Date().toISOString());

    // Find all Ruby files
    const patterns = paths?.length ? 
      paths.map(p => path.join(this.repoPath, p, '**/*.rb')) :
      [path.join(this.repoPath, '**/*.rb')];

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, { 
        ignore: ['**/node_modules/**', '**/vendor/**', '**/.git/**', '**/.rails-index/**']
      });
      files.push(...matches);
    }

    filesProcessed = files.length;

    // Process each file
    for (const filePath of files) {
      try {
        await this.indexFile(filePath);
        filesIndexed++;
      } catch (error) {
        console.error(`Failed to index ${filePath}:`, error);
        filesFailed++;
      }
    }

    // Index schema.rb if it exists
    try {
      await this.indexSchema();
    } catch (error) {
      console.warn('[CodeIndexer] Failed to index schema.rb:', error);
      // Don't fail the whole reindex if schema parsing fails
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Update metadata after successful indexing
    this.db.setMetadata('last_indexed', new Date().toISOString());
    this.db.setMetadata('last_index_duration', duration);
    this.db.setMetadata('last_index_file_count', filesIndexed.toString());
    
    // Get statistics
    const stats = this.db.getStats();

    return {
      success: true,
      filesProcessed,
      filesIndexed,
      filesFailed,
      duration: `${duration}s`,
      stats
    };
  }

  private async indexFile(filePath: string): Promise<void> {
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    // Check if file needs reindexing
    const relativePath = path.relative(this.repoPath, filePath);
    const existingFile = this.db.getFileByPath(relativePath);
    
    // Skip if file unchanged (same hash and not forced native parser reparse)
    if (existingFile && existingFile.hash === hash && !this.useNativeParser) {
      return; // File unchanged and using regex parser
    }
    
    // Also skip if file hasn't been modified since last index
    if (existingFile && existingFile.last_indexed) {
      const lastIndexedTime = new Date(existingFile.last_indexed).getTime();
      const fileModifiedTime = stats.mtime.getTime();
      if (fileModifiedTime < lastIndexedTime && existingFile.hash === hash) {
        return; // File not modified since last index
      }
    }

    let parseResult: RubyParseResult | NativeParseResult;
    
    // Try native parser first if available
    if (this.useNativeParser) {
      try {
        parseResult = await this.nativeParser.parseFile(filePath);
      } catch (error) {
        console.warn(`Native parse failed for ${filePath}, falling back to regex:`, error);
        parseResult = await this.regexParser.parseFile(filePath);
      }
    } else {
      parseResult = await this.regexParser.parseFile(filePath);
    }

    // Convert native result to common format if needed
    const fileType = this.detectFileType(filePath);

    // Store in database
    const fileId = this.db.upsertFile({
      path: relativePath,
      hash,
      file_type: fileType,
      line_count: parseResult.line_count || 0,
      last_indexed: new Date().toISOString()
    });

    // Index symbols
    if (parseResult.symbols) {
      for (const symbol of parseResult.symbols) {
        this.db.insertSymbol({
          file_id: fileId,
          name: symbol.name,
          type: symbol.type,
          parent_symbol: ('parent_symbol' in symbol ? symbol.parent_symbol : symbol.parent) || null,
          start_line: symbol.start_line,
          end_line: symbol.end_line,
          signature: 'signature' in symbol ? symbol.signature : null,
          visibility: symbol.visibility || 'public',
          documentation: 'documentation' in symbol ? symbol.documentation : null,
          references: JSON.stringify(symbol.references || []),
          metadata: JSON.stringify(symbol.metadata || [])
        });
      }
    }

    // Index Rails-specific metadata
    if (parseResult.associations) {
      for (const assoc of parseResult.associations) {
        this.db.insertSymbol({
          file_id: fileId,
          name: assoc.name,
          type: 'association',
          parent_symbol: null,
          start_line: 0,
          end_line: 0,
          signature: null,
          visibility: 'public',
          documentation: null,
          references: JSON.stringify([]),
          metadata: JSON.stringify(assoc)
        });
      }
    }
  }

  private detectFileType(filePath: string): string {
    for (const [type, pattern] of this.railsPatterns) {
      if (pattern.test(filePath)) {
        return type;
      }
    }
    return 'ruby';
  }

  private async indexSchema(): Promise<void> {
    const schemaPath = path.join(this.repoPath, 'db', 'schema.rb');
    
    if (!fs.existsSync(schemaPath)) {
      console.log('[CodeIndexer] No schema.rb found, skipping schema indexing');
      return;
    }

    console.log('[CodeIndexer] Indexing database schema from schema.rb');
    
    // Parse the schema file
    const schemaData = await this.schemaParser.parseFile(schemaPath);
    
    // Clear existing schema data
    this.db.clearSchema();
    
    // Store tables and their metadata
    for (const table of schemaData.tables) {
      const tableId = this.db.upsertSchemaTable(table.name, table.primary_key);
      
      // Store columns
      for (const column of table.columns) {
        this.db.insertSchemaColumn(tableId, column);
      }
      
      // Store indexes
      for (const index of table.indexes) {
        this.db.insertSchemaIndex(tableId, index);
      }
    }
    
    // Store foreign keys
    for (const fk of schemaData.foreign_keys) {
      this.db.insertSchemaForeignKey(fk);
    }
    
    // Store schema version as metadata
    if (schemaData.version) {
      this.db.setMetadata('schema_version', schemaData.version);
    }
    
    console.log(`[CodeIndexer] Indexed ${schemaData.tables.length} tables from schema.rb`);
  }

  async searchSymbols(query: string, limit: number = 10, fileTypes?: string[]): Promise<SearchResult[]> {
    return this.db.searchSymbols(query, limit, fileTypes);
  }

  async getSnippet(
    filePath: string, 
    startLine?: number, 
    endLine?: number, 
    symbolName?: string
  ): Promise<any> {
    const absolutePath = path.isAbsolute(filePath) ? 
      filePath : 
      path.join(this.repoPath, filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');

    if (symbolName) {
      // Find symbol in database
      const symbols = this.db.searchSymbols(symbolName, 1, undefined);
      if (symbols.length > 0) {
        startLine = symbols[0].start_line;
        endLine = symbols[0].end_line;
      }
    }

    const start = (startLine || 1) - 1;
    const end = endLine || lines.length;
    
    const snippet = lines.slice(start, end).join('\n');

    return {
      file_path: filePath,
      start_line: startLine || 1,
      end_line: end,
      snippet,
      language: 'ruby'
    };
  }

  async callGraph(symbol: string, direction: 'callers' | 'callees' | 'both', depth: number): Promise<CallGraphResult> {
    // For now, return a basic structure
    // Full implementation would analyze method calls
    return {
      symbol,
      callers: direction === 'callers' || direction === 'both' ? [] : undefined,
      callees: direction === 'callees' || direction === 'both' ? [] : undefined,
      depth
    };
  }

  async findSimilar(codeSnippet: string, k: number, minSimilarity: number): Promise<any[]> {
    // Basic implementation - search for similar patterns
    const tokens = codeSnippet.split(/\s+/).filter(t => t.length > 2);
    const query = tokens.join(' ');
    
    const results = await this.searchSymbols(query, k);
    return results.filter(r => (r.score || 0) >= minSimilarity);
  }

  async findTests(filePath: string): Promise<string[]> {
    const basename = path.basename(filePath, '.rb');
    const testPatterns = [
      `spec/**/*${basename}_spec.rb`,
      `test/**/*${basename}_test.rb`,
      `spec/**/${basename}_spec.rb`,
      `test/**/${basename}_test.rb`
    ];

    const testFiles: string[] = [];
    for (const pattern of testPatterns) {
      const matches = await glob(path.join(this.repoPath, pattern));
      testFiles.push(...matches.map(f => path.relative(this.repoPath, f)));
    }

    return testFiles;
  }

  async incrementalReindex(): Promise<any> {
    const startTime = Date.now();
    let filesChecked = 0;
    let filesUpdated = 0;
    let filesFailed = 0;

    // Find all Ruby files
    const pattern = path.join(this.repoPath, '**/*.rb');
    const files = await glob(pattern, { 
      ignore: ['**/node_modules/**', '**/vendor/**', '**/.git/**', '**/.rails-index/**']
    });

    filesChecked = files.length;

    // Check each file for changes
    for (const filePath of files) {
      try {
        const stats = fs.statSync(filePath);
        const relativePath = path.relative(this.repoPath, filePath);
        const existingFile = this.db.getFileByPath(relativePath);
        
        // Index if file is new or modified
        if (!existingFile || 
            !existingFile.last_indexed ||
            stats.mtime.getTime() > new Date(existingFile.last_indexed).getTime()) {
          await this.indexFile(filePath);
          filesUpdated++;
        }
      } catch (error) {
        console.error(`Failed to check ${filePath}:`, error);
        filesFailed++;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Update metadata
    this.db.setMetadata('last_incremental_index', new Date().toISOString());
    this.db.setMetadata('last_incremental_duration', duration);
    
    const stats = this.db.getStats();

    return {
      success: true,
      filesChecked,
      filesUpdated,
      filesFailed,
      duration: `${duration}s`,
      stats
    };
  }

  // Schema-related methods
  async getTables(): Promise<any[]> {
    return this.db.getAllSchemaTables();
  }

  async getTable(tableName: string): Promise<any> {
    return this.db.getSchemaTable(tableName);
  }

  async getTableRelations(tableName: string): Promise<any> {
    const foreignKeys = this.db.getSchemaForeignKeys(tableName);
    return {
      table: tableName,
      foreign_keys: foreignKeys,
      incoming: foreignKeys.filter(fk => fk.to_table === tableName),
      outgoing: foreignKeys.filter(fk => fk.from_table === tableName)
    };
  }

  async suggestAssociations(tableName: string): Promise<any> {
    const table = this.db.getSchemaTable(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} not found in schema`);
    }
    
    const allTables = this.db.getAllSchemaTables().map(t => t.name);
    const foreignKeys = this.db.getSchemaForeignKeys();
    
    const associations = this.associationMapper.generateAssociations(
      tableName,
      foreignKeys,
      allTables,
      table.indexes
    );
    
    const validations = this.associationMapper.suggestValidations(
      table.columns,
      table.indexes
    );
    
    return {
      table: tableName,
      model: this.tableToModel(tableName),
      associations,
      validations
    };
  }

  private tableToModel(tableName: string): string {
    // Convert table name to model name (users -> User)
    const singular = tableName.endsWith('ies') 
      ? tableName.slice(0, -3) + 'y'
      : tableName.endsWith('s') 
      ? tableName.slice(0, -1)
      : tableName;
    
    return singular.split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
}