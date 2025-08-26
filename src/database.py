"""
Database operations for the code index
"""

import json
import logging
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

class IndexDatabase:
    """SQLite database for storing code index"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()
    
    def _init_schema(self):
        """Initialize database schema"""
        
        cursor = self.conn.cursor()
        
        # Files table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                hash TEXT,
                last_indexed TIMESTAMP,
                file_type TEXT,
                line_count INTEGER
            )
        ''')
        
        # Symbols table (classes, modules, methods)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS symbols (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER,
                name TEXT NOT NULL,
                type TEXT NOT NULL,  -- class, module, method, constant
                parent_symbol TEXT,
                start_line INTEGER,
                end_line INTEGER,
                signature TEXT,
                visibility TEXT,  -- public, private, protected
                ast_json TEXT,
                FOREIGN KEY (file_id) REFERENCES files(id)
            )
        ''')
        
        # Symbol references (for call graph)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS symbol_references (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_file_id INTEGER,
                from_symbol_id INTEGER,
                to_symbol TEXT,
                line_number INTEGER,
                context TEXT,
                FOREIGN KEY (from_file_id) REFERENCES files(id),
                FOREIGN KEY (from_symbol_id) REFERENCES symbols(id)
            )
        ''')
        
        # Rails-specific metadata
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS rails_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER,
                symbol_id INTEGER,
                metadata_type TEXT,  -- association, validation, callback, route
                metadata_value TEXT,
                FOREIGN KEY (file_id) REFERENCES files(id),
                FOREIGN KEY (symbol_id) REFERENCES symbols(id)
            )
        ''')
        
        # Search index for full-text search
        cursor.execute('''
            CREATE VIRTUAL TABLE IF NOT EXISTS search_index
            USING fts5(
                file_path,
                symbol_name,
                content,
                tokenize='porter'
            )
        ''')
        
        # Create indexes
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_references_from ON symbol_references(from_file_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_references_to ON symbol_references(to_symbol)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_rails_metadata_file ON rails_metadata(file_id)')
        
        self.conn.commit()
    
    def index_file(self, file_path: str, ast_data: Dict[str, Any]):
        """Index a file and its symbols"""
        
        cursor = self.conn.cursor()
        
        # Insert or update file
        cursor.execute('''
            INSERT OR REPLACE INTO files (path, hash, last_indexed, file_type, line_count)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            file_path,
            ast_data.get('hash'),
            datetime.now(),
            ast_data.get('file_type'),
            ast_data.get('line_count', 0)
        ))
        
        file_id = cursor.lastrowid
        
        # Clear existing symbols for this file
        cursor.execute('DELETE FROM symbols WHERE file_id = ?', (file_id,))
        cursor.execute('DELETE FROM symbol_references WHERE from_file_id = ?', (file_id,))
        cursor.execute('DELETE FROM rails_metadata WHERE file_id = ?', (file_id,))
        
        # Index symbols
        for symbol in ast_data.get('symbols', []):
            cursor.execute('''
                INSERT INTO symbols (
                    file_id, name, type, parent_symbol, 
                    start_line, end_line, signature, visibility, ast_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                file_id,
                symbol['name'],
                symbol['type'],
                symbol.get('parent'),
                symbol.get('start_line'),
                symbol.get('end_line'),
                symbol.get('signature'),
                symbol.get('visibility', 'public'),
                json.dumps(symbol.get('ast', {}))
            ))
            
            symbol_id = cursor.lastrowid
            
            # Index symbol references
            for ref in symbol.get('references', []):
                cursor.execute('''
                    INSERT INTO symbol_references (
                        from_file_id, from_symbol_id, to_symbol, line_number, context
                    )
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    file_id,
                    symbol_id,
                    ref['to'],
                    ref['line'],
                    ref.get('context')
                ))
            
            # Index Rails metadata
            for metadata in symbol.get('metadata', []):
                cursor.execute('''
                    INSERT INTO rails_metadata (
                        file_id, symbol_id, metadata_type, metadata_value
                    )
                    VALUES (?, ?, ?, ?)
                ''', (
                    file_id,
                    symbol_id,
                    metadata['type'],
                    json.dumps(metadata['value'])
                ))
        
        # Update search index
        # First, remove old entries
        cursor.execute('DELETE FROM search_index WHERE file_path = ?', (file_path,))
        
        # Add new entries
        for symbol in ast_data.get('symbols', []):
            content = f"{symbol['name']} {symbol.get('signature', '')} {symbol.get('doc', '')}"
            cursor.execute('''
                INSERT INTO search_index (file_path, symbol_name, content)
                VALUES (?, ?, ?)
            ''', (file_path, symbol['name'], content))
    
    def search_symbols(
        self, 
        search_terms: List[str], 
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search for symbols matching the given terms"""
        
        cursor = self.conn.cursor()
        
        try:
            # Try using FTS5 search first
            fts_query = ' OR '.join([f'"{term}"' for term in search_terms])
            
            query = '''
                SELECT DISTINCT
                    f.path as file_path,
                    s.name as symbol,
                    s.type,
                    s.start_line as line,
                    s.signature
                FROM search_index si
                JOIN files f ON si.file_path = f.path
                JOIN symbols s ON s.file_id = f.id
                WHERE si MATCH ? AND s.name = si.symbol_name
                ORDER BY rank
                LIMIT ?
            '''
            params = [fts_query, limit]
            
            cursor.execute(query, params)
            
        except sqlite3.OperationalError as e:
            # Fallback to LIKE-based search if FTS5 fails
            logger.warning(f"FTS5 search failed, falling back to LIKE: {e}")
            
            like_conditions = []
            params = []
            
            for term in search_terms:
                like_conditions.append('s.name LIKE ?')
                params.append(f'%{term}%')
            
            query = f'''
                SELECT DISTINCT
                    f.path as file_path,
                    s.name as symbol,
                    s.type,
                    s.start_line as line,
                    s.signature
                FROM symbols s
                JOIN files f ON s.file_id = f.id
                WHERE {' OR '.join(like_conditions)}
                LIMIT ?
            '''
            params.append(limit)
            
            cursor.execute(query, params)
        
        results = []
        for row in cursor.fetchall():
            results.append(dict(row))
        
        return results
    
    def get_symbol_info(
        self, 
        file_path: str, 
        symbol_name: str
    ) -> Optional[Dict[str, Any]]:
        """Get information about a specific symbol"""
        
        cursor = self.conn.cursor()
        
        cursor.execute('''
            SELECT s.*, f.path
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE f.path = ? AND s.name = ?
        ''', (file_path, symbol_name))
        
        row = cursor.fetchone()
        if row:
            return dict(row)
        
        return None
    
    def find_symbol_references(
        self, 
        class_name: str, 
        method_name: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find references to a symbol"""
        
        cursor = self.conn.cursor()
        
        if method_name:
            symbol = f"{class_name}#{method_name}"
        else:
            symbol = class_name
        
        cursor.execute('''
            SELECT 
                f.path as file_path,
                sr.line_number as line,
                sr.context,
                s.name as from_symbol
            FROM symbol_references sr
            JOIN files f ON sr.from_file_id = f.id
            JOIN symbols s ON sr.from_symbol_id = s.id
            WHERE sr.to_symbol LIKE ?
        ''', (f'%{symbol}%',))
        
        results = []
        for row in cursor.fetchall():
            results.append(dict(row))
        
        return results
    
    def get_symbol_implementation(
        self, 
        class_name: str, 
        method_name: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Get the implementation of a symbol"""
        
        cursor = self.conn.cursor()
        
        if method_name:
            cursor.execute('''
                SELECT s.*, f.path
                FROM symbols s
                JOIN files f ON s.file_id = f.id
                WHERE s.parent_symbol = ? AND s.name = ?
            ''', (class_name, method_name))
        else:
            cursor.execute('''
                SELECT s.*, f.path
                FROM symbols s
                JOIN files f ON s.file_id = f.id
                WHERE s.name = ? AND s.type IN ('class', 'module')
            ''', (class_name,))
        
        row = cursor.fetchone()
        if row:
            result = dict(row)
            if result.get('ast_json'):
                result['ast'] = json.loads(result['ast_json'])
            return result
        
        return None
    
    def find_similar_ast(
        self, 
        ast: Dict[str, Any], 
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Find symbols with similar AST structure"""
        
        cursor = self.conn.cursor()
        
        # For now, use a simple approach - find symbols of the same type
        # This could be enhanced with more sophisticated AST matching
        
        symbol_type = ast.get('type', 'method')
        
        cursor.execute('''
            SELECT 
                f.path as file_path,
                s.name as symbol,
                s.start_line as line,
                s.ast_json as ast
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE s.type = ?
            LIMIT ?
        ''', (symbol_type, limit))
        
        results = []
        for row in cursor.fetchall():
            result = dict(row)
            if result.get('ast'):
                result['ast'] = json.loads(result['ast'])
            results.append(result)
        
        return results
    
    def count_files_by_pattern(self, pattern: str) -> int:
        """Count files matching a pattern"""
        
        cursor = self.conn.cursor()
        
        # Convert regex pattern to SQL LIKE pattern (simplified)
        sql_pattern = pattern.replace('.*', '%').replace('.', '_')
        
        cursor.execute('SELECT COUNT(*) FROM files WHERE path LIKE ?', (sql_pattern,))
        return cursor.fetchone()[0]
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get database statistics"""
        
        cursor = self.conn.cursor()
        
        stats = {}
        
        cursor.execute('SELECT COUNT(*) FROM files')
        stats['file_count'] = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM symbols')
        stats['symbol_count'] = cursor.fetchone()[0]
        
        cursor.execute('SELECT MAX(last_indexed) FROM files')
        last_update = cursor.fetchone()[0]
        stats['last_update'] = last_update if last_update else 'Never'
        
        # Get database size
        db_size = os.path.getsize(self.db_path) / (1024 * 1024)  # Convert to MB
        stats['db_size_mb'] = round(db_size, 2)
        
        return stats
    
    def clear_index(self):
        """Clear all indexed data"""
        
        cursor = self.conn.cursor()
        
        cursor.execute('DELETE FROM symbol_references')
        cursor.execute('DELETE FROM rails_metadata')
        cursor.execute('DELETE FROM symbols')
        cursor.execute('DELETE FROM files')
        cursor.execute('DELETE FROM search_index')
        
        self.conn.commit()
    
    def commit(self):
        """Commit pending changes"""
        self.conn.commit()
    
    def close(self):
        """Close database connection"""
        self.conn.close()