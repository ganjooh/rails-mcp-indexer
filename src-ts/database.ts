/**
 * Database operations for the code index
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FileRecord {
  id?: number;
  path: string;
  hash: string;
  last_indexed?: string;
  file_type: string;
  line_count: number;
}

export interface SymbolRecord {
  id?: number;
  file_id: number;
  name: string;
  type: string;
  parent_symbol?: string | null;
  start_line: number;
  end_line: number;
  signature?: string | null;
  visibility: string;
  documentation?: string | null;
  references?: string;
  metadata?: string;
}

export interface CallRecord {
  id?: number;
  caller_symbol_id: number;
  callee_symbol: string;
  line_number: number;
  call_type: string;
}

export class IndexDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema() {
    // Metadata table for tracking indexer state
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Files table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        hash TEXT,
        last_indexed TIMESTAMP,
        file_type TEXT,
        line_count INTEGER
      )
    `);

    // Symbols table (classes, modules, methods)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_symbol TEXT,
        start_line INTEGER,
        end_line INTEGER,
        signature TEXT,
        visibility TEXT DEFAULT 'public',
        documentation TEXT,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      )
    `);

    // Calls table (method calls, includes, requires)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_symbol_id INTEGER,
        callee_symbol TEXT,
        line_number INTEGER,
        call_type TEXT,
        FOREIGN KEY (caller_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
      )
    `);

    // Full-text search table for symbols
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
        name,
        documentation,
        signature,
        content='symbols',
        content_rowid='id'
      )
    `);

    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
        INSERT INTO symbols_fts(rowid, name, documentation, signature)
        VALUES (new.id, new.name, new.documentation, new.signature);
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
        DELETE FROM symbols_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
        DELETE FROM symbols_fts WHERE rowid = old.id;
        INSERT INTO symbols_fts(rowid, name, documentation, signature)
        VALUES (new.id, new.name, new.documentation, new.signature);
      END;
    `);

    // Create indices
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type);
      CREATE INDEX IF NOT EXISTS idx_symbols_parent ON symbols(parent_symbol);
      CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_symbol);
    `);

    // Schema tables for db/schema.rb metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        primary_key TEXT,
        last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        column_type TEXT NOT NULL,
        nullable BOOLEAN DEFAULT TRUE,
        default_value TEXT,
        column_limit INTEGER,
        precision INTEGER,
        scale INTEGER,
        FOREIGN KEY (table_id) REFERENCES schema_tables(id) ON DELETE CASCADE,
        UNIQUE(table_id, name)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_indexes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER NOT NULL,
        name TEXT,
        columns TEXT NOT NULL, -- JSON array
        unique_index BOOLEAN DEFAULT FALSE,
        where_clause TEXT,
        FOREIGN KEY (table_id) REFERENCES schema_tables(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_foreign_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_table TEXT NOT NULL,
        from_column TEXT NOT NULL,
        to_table TEXT NOT NULL,
        to_column TEXT NOT NULL,
        on_delete TEXT,
        on_update TEXT
      )
    `);

    // Create indices for schema tables
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_schema_columns_table_id ON schema_columns(table_id);
      CREATE INDEX IF NOT EXISTS idx_schema_indexes_table_id ON schema_indexes(table_id);
      CREATE INDEX IF NOT EXISTS idx_schema_fk_from ON schema_foreign_keys(from_table);
      CREATE INDEX IF NOT EXISTS idx_schema_fk_to ON schema_foreign_keys(to_table);
    `);
  }

  // File operations
  upsertFile(file: FileRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, hash, last_indexed, file_type, line_count)
      VALUES (@path, @hash, @last_indexed, @file_type, @line_count)
      ON CONFLICT(path) DO UPDATE SET
        hash = @hash,
        last_indexed = @last_indexed,
        file_type = @file_type,
        line_count = @line_count
      RETURNING id
    `);
    
    const result = stmt.get(file) as { id: number };
    return result.id;
  }

  getFile(filePath: string): FileRecord | null {
    const stmt = this.db.prepare('SELECT * FROM files WHERE path = ?');
    return stmt.get(filePath) as FileRecord | null;
  }

  getFileById(id: number): FileRecord | null {
    const stmt = this.db.prepare('SELECT * FROM files WHERE id = ?');
    return stmt.get(id) as FileRecord | null;
  }

  deleteFile(filePath: string): void {
    const stmt = this.db.prepare('DELETE FROM files WHERE path = ?');
    stmt.run(filePath);
  }

  // Symbol operations
  insertSymbol(symbol: Omit<SymbolRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (
        file_id, name, type, parent_symbol, start_line, end_line,
        signature, visibility, documentation
      ) VALUES (
        @file_id, @name, @type, @parent_symbol, @start_line, @end_line,
        @signature, @visibility, @documentation
      )
    `);
    
    const result = stmt.run(symbol);
    return result.lastInsertRowid as number;
  }

  getSymbolsForFile(fileId: number): SymbolRecord[] {
    const stmt = this.db.prepare('SELECT * FROM symbols WHERE file_id = ? ORDER BY start_line');
    return stmt.all(fileId) as SymbolRecord[];
  }

  deleteSymbolsForFile(fileId: number): void {
    const stmt = this.db.prepare('DELETE FROM symbols WHERE file_id = ?');
    stmt.run(fileId);
  }

  searchSymbols(query: string, limit: number = 10, fileTypes?: string[]): any[] {
    let sql = `
      SELECT 
        s.*,
        f.path as file_path,
        f.file_type,
        snippet(symbols_fts, 0, '<mark>', '</mark>', '...', 32) as match_snippet
      FROM symbols_fts
      JOIN symbols s ON s.id = symbols_fts.rowid
      JOIN files f ON f.id = s.file_id
      WHERE symbols_fts MATCH ?
    `;

    const params: any[] = [query];

    if (fileTypes && fileTypes.length > 0) {
      const placeholders = fileTypes.map(() => '?').join(',');
      sql += ` AND f.file_type IN (${placeholders})`;
      params.push(...fileTypes);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  // Call graph operations
  insertCall(call: Omit<CallRecord, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO calls (caller_symbol_id, callee_symbol, line_number, call_type)
      VALUES (@caller_symbol_id, @callee_symbol, @line_number, @call_type)
    `);
    stmt.run(call);
  }

  getCallsForSymbol(symbolId: number): CallRecord[] {
    const stmt = this.db.prepare('SELECT * FROM calls WHERE caller_symbol_id = ?');
    return stmt.all(symbolId) as CallRecord[];
  }

  findCallers(symbolName: string): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        s.*,
        f.path as file_path,
        c.line_number as call_line
      FROM calls c
      JOIN symbols s ON s.id = c.caller_symbol_id
      JOIN files f ON f.id = s.file_id
      WHERE c.callee_symbol = ?
    `);
    return stmt.all(symbolName);
  }

  findCallees(symbolId: number): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        c.callee_symbol,
        c.line_number,
        c.call_type
      FROM calls c
      WHERE c.caller_symbol_id = ?
    `);
    return stmt.all(symbolId);
  }

  // Utility methods
  beginTransaction(): void {
    this.db.prepare('BEGIN').run();
  }

  commit(): void {
    this.db.prepare('COMMIT').run();
  }

  rollback(): void {
    this.db.prepare('ROLLBACK').run();
  }

  close(): void {
    this.db.close();
  }

  // Additional methods for indexer
  clearAll(): void {
    this.db.prepare('DELETE FROM calls').run();
    this.db.prepare('DELETE FROM symbols').run();
    this.db.prepare('DELETE FROM files').run();
  }

  getFileByPath(filePath: string): FileRecord | undefined {
    const relativePath = filePath.includes('/') && !filePath.startsWith('/') ? 
      filePath : 
      filePath.replace(/^.*?\//, '');
    const stmt = this.db.prepare('SELECT * FROM files WHERE path = ?');
    return stmt.get(relativePath) as FileRecord | undefined;
  }

  // Get statistics
  getStats(): any {
    const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    const symbolCount = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number };
    const callCount = this.db.prepare('SELECT COUNT(*) as count FROM calls').get() as { count: number };
    
    const typeStats = this.db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM symbols 
      GROUP BY type
    `).all();

    return {
      files: fileCount.count,
      symbols: symbolCount.count,
      calls: callCount.count,
      symbolTypes: typeStats
    };
  }

  // Metadata operations
  setMetadata(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO metadata (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(key, value);
  }

  getMetadata(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM metadata WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value || null;
  }

  getAllMetadata(): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM metadata');
    const rows = stmt.all() as Array<{ key: string; value: string }>;
    const metadata: Record<string, string> = {};
    for (const row of rows) {
      metadata[row.key] = row.value;
    }
    return metadata;
  }

  // Check if database needs reindexing
  needsReindex(repoPath: string): boolean {
    const storedPath = this.getMetadata('repo_path');
    const lastIndexed = this.getMetadata('last_indexed');
    
    // Need reindex if:
    // 1. No stored path (new database)
    // 2. Different repo path
    // 3. No files in database
    // 4. Never indexed
    if (!storedPath || storedPath !== repoPath) return true;
    if (!lastIndexed) return true;
    
    const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    if (fileCount.count === 0) return true;
    
    return false;
  }

  // Schema operations
  clearSchema() {
    this.db.exec(`
      DELETE FROM schema_foreign_keys;
      DELETE FROM schema_indexes;
      DELETE FROM schema_columns;
      DELETE FROM schema_tables;
    `);
  }

  upsertSchemaTable(name: string, primaryKey?: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO schema_tables (name, primary_key)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET
        primary_key = excluded.primary_key,
        last_indexed = CURRENT_TIMESTAMP
      RETURNING id
    `);
    const result = stmt.get(name, primaryKey) as { id: number };
    return result.id;
  }

  insertSchemaColumn(tableId: number, column: any) {
    const stmt = this.db.prepare(`
      INSERT INTO schema_columns (
        table_id, name, column_type, nullable, 
        default_value, column_limit, precision, scale
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(table_id, name) DO UPDATE SET
        column_type = excluded.column_type,
        nullable = excluded.nullable,
        default_value = excluded.default_value,
        column_limit = excluded.column_limit,
        precision = excluded.precision,
        scale = excluded.scale
    `);
    
    stmt.run(
      tableId,
      column.name,
      column.type,
      column.nullable ? 1 : 0,
      column.default || null,
      column.limit || null,
      column.precision || null,
      column.scale || null
    );
  }

  insertSchemaIndex(tableId: number, index: any) {
    const stmt = this.db.prepare(`
      INSERT INTO schema_indexes (
        table_id, name, columns, unique_index, where_clause
      )
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      tableId,
      index.name,
      JSON.stringify(index.columns),
      index.unique ? 1 : 0,
      index.where || null
    );
  }

  insertSchemaForeignKey(fk: any) {
    const stmt = this.db.prepare(`
      INSERT INTO schema_foreign_keys (
        from_table, from_column, to_table, to_column, on_delete, on_update
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      fk.from_table,
      fk.from_column,
      fk.to_table,
      fk.to_column,
      fk.on_delete || null,
      fk.on_update || null
    );
  }

  getSchemaTable(tableName: string): any {
    const table = this.db.prepare(`
      SELECT * FROM schema_tables WHERE name = ?
    `).get(tableName) as any;
    
    if (!table) return null;
    
    const columns = this.db.prepare(`
      SELECT * FROM schema_columns WHERE table_id = ?
    `).all(table.id);
    
    const indexes = this.db.prepare(`
      SELECT * FROM schema_indexes WHERE table_id = ?
    `).all(table.id);
    
    // Parse JSON columns in indexes
    indexes.forEach((idx: any) => {
      idx.columns = JSON.parse(idx.columns);
    });
    
    return {
      ...table,
      columns,
      indexes
    };
  }

  getAllSchemaTables(): any[] {
    return this.db.prepare(`
      SELECT name, primary_key FROM schema_tables ORDER BY name
    `).all();
  }

  getSchemaForeignKeys(tableName?: string): any[] {
    if (tableName) {
      return this.db.prepare(`
        SELECT * FROM schema_foreign_keys 
        WHERE from_table = ? OR to_table = ?
      `).all(tableName, tableName);
    }
    return this.db.prepare(`
      SELECT * FROM schema_foreign_keys
    `).all();
  }
}