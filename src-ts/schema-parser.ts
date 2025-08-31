/**
 * Rails schema.rb parser
 * Extracts table definitions, columns, indexes, and foreign keys from db/schema.rb
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  foreign_keys: SchemaForeignKey[];
  primary_key?: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  limit?: number;
  precision?: number;
  scale?: number;
}

export interface SchemaIndex {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  where?: string;
}

export interface SchemaForeignKey {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  on_delete?: string;
  on_update?: string;
}

export class SchemaParser {
  private tables: Map<string, SchemaTable> = new Map();
  private foreign_keys: SchemaForeignKey[] = [];
  private version?: string;

  /**
   * Parse a Rails schema.rb file
   */
  async parseFile(schemaPath: string): Promise<{
    tables: SchemaTable[];
    foreign_keys: SchemaForeignKey[];
    version?: string;
  }> {
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const content = fs.readFileSync(schemaPath, 'utf-8');
    return this.parseContent(content);
  }

  /**
   * Parse schema content
   */
  parseContent(content: string): {
    tables: SchemaTable[];
    foreign_keys: SchemaForeignKey[];
    version?: string;
  } {
    this.tables.clear();
    this.foreign_keys = [];

    // Extract version
    const versionMatch = content.match(/ActiveRecord::Schema(?:\[[\d.]+\])?\.define\(version:\s*(\d+)\)/);
    if (versionMatch) {
      this.version = versionMatch[1];
    }

    // Parse create_table blocks - improved regex
    const tableRegex = /create_table\s+"([^"]+)"(?:,\s*([^)]*))?\s+do\s+\|t\|(.*?)\n\s*end/gms;
    let match;

    while ((match = tableRegex.exec(content)) !== null) {
      const tableName = match[1];
      const tableOptions = match[2] || '';
      const tableBody = match[3];

      const table: SchemaTable = {
        name: tableName,
        columns: [],
        indexes: [],
        foreign_keys: []
      };

      // Parse table options for primary key
      const pkMatch = tableOptions.match(/primary_key:\s*"([^"]+)"/);
      if (pkMatch) {
        table.primary_key = pkMatch[1];
      } else {
        // Default primary key is 'id' unless id: false
        if (!tableOptions.includes('id: false')) {
          table.primary_key = 'id';
        }
      }

      // Parse columns
      this.parseColumns(tableBody, table);

      // Parse inline indexes
      this.parseInlineIndexes(tableBody, table);

      this.tables.set(tableName, table);
    }

    // Parse standalone add_index statements
    this.parseStandaloneIndexes(content);

    // Parse foreign key constraints
    this.parseForeignKeys(content);

    return {
      tables: Array.from(this.tables.values()),
      foreign_keys: this.foreign_keys,
      version: this.version
    };
  }

  private parseColumns(tableBody: string, table: SchemaTable) {
    // Match various column types
    const columnPatterns = [
      // Standard columns: t.string "name", null: false
      /t\.(\w+)\s+"([^"]+)"(?:,\s*(.*))?$/gm,
      // References: t.references :user, foreign_key: true
      /t\.(references|belongs_to)\s+:(\w+)(?:,\s*(.*))?$/gm,
      // Timestamps
      /t\.timestamps(?:\s+(.*))?$/gm
    ];

    // Standard columns
    const standardRegex = /t\.(\w+)\s+"([^"]+)"(?:,\s*(.*))?$/gm;
    let match;

    while ((match = standardRegex.exec(tableBody)) !== null) {
      const type = match[1];
      const name = match[2];
      const options = match[3] || '';

      const column: SchemaColumn = {
        name,
        type,
        nullable: !options.includes('null: false')
      };

      // Parse default value
      const defaultMatch = options.match(/default:\s*([^,]+)/);
      if (defaultMatch) {
        column.default = defaultMatch[1].trim();
      }

      // Parse limit
      const limitMatch = options.match(/limit:\s*(\d+)/);
      if (limitMatch) {
        column.limit = parseInt(limitMatch[1]);
      }

      // Parse precision and scale for decimal
      const precisionMatch = options.match(/precision:\s*(\d+)/);
      if (precisionMatch) {
        column.precision = parseInt(precisionMatch[1]);
      }

      const scaleMatch = options.match(/scale:\s*(\d+)/);
      if (scaleMatch) {
        column.scale = parseInt(scaleMatch[1]);
      }

      table.columns.push(column);
    }

    // References/belongs_to
    const referencesRegex = /t\.(references|belongs_to)\s+:(\w+)(?:,\s*(.*))?$/gm;
    while ((match = referencesRegex.exec(tableBody)) !== null) {
      const name = match[2];
      const options = match[3] || '';

      // Add the foreign key column
      table.columns.push({
        name: `${name}_id`,
        type: 'bigint',
        nullable: !options.includes('null: false')
      });

      // If foreign_key: true, add to foreign keys
      if (options.includes('foreign_key: true')) {
        this.foreign_keys.push({
          from_table: table.name,
          from_column: `${name}_id`,
          to_table: this.pluralToSingular(name) + 's', // Simple pluralization
          to_column: 'id'
        });
      }

      // Check for polymorphic
      if (options.includes('polymorphic: true')) {
        table.columns.push({
          name: `${name}_type`,
          type: 'string',
          nullable: !options.includes('null: false')
        });
      }
    }

    // Timestamps
    if (tableBody.includes('t.timestamps')) {
      table.columns.push(
        { name: 'created_at', type: 'datetime', nullable: false },
        { name: 'updated_at', type: 'datetime', nullable: false }
      );
    }
  }

  private parseInlineIndexes(tableBody: string, table: SchemaTable) {
    // Parse t.index statements within create_table
    const indexRegex = /t\.index\s+\[([^\]]+)\](?:,\s*(.*))?$/gm;
    let match;

    while ((match = indexRegex.exec(tableBody)) !== null) {
      const columnsStr = match[1];
      const options = match[2] || '';

      const columns = columnsStr
        .split(',')
        .map(c => c.trim().replace(/[":]/g, ''));

      const index: SchemaIndex = {
        name: this.generateIndexName(table.name, columns, options.includes('unique: true')),
        table: table.name,
        columns,
        unique: options.includes('unique: true')
      };

      // Parse where clause
      const whereMatch = options.match(/where:\s*"([^"]+)"/);
      if (whereMatch) {
        index.where = whereMatch[1];
      }

      // Parse name if specified
      const nameMatch = options.match(/name:\s*"([^"]+)"/);
      if (nameMatch) {
        index.name = nameMatch[1];
      }

      table.indexes.push(index);
    }
  }

  private parseStandaloneIndexes(content: string) {
    // Parse add_index statements outside create_table
    const indexRegex = /add_index\s+"([^"]+)",\s+\[([^\]]+)\](?:,\s*(.*))?$/gm;
    let match;

    while ((match = indexRegex.exec(content)) !== null) {
      const tableName = match[1];
      const columnsStr = match[2];
      const options = match[3] || '';

      const columns = columnsStr
        .split(',')
        .map(c => c.trim().replace(/[":]/g, ''));

      const table = this.tables.get(tableName);
      if (table) {
        const index: SchemaIndex = {
          name: this.generateIndexName(tableName, columns, options.includes('unique: true')),
          table: tableName,
          columns,
          unique: options.includes('unique: true')
        };

        // Parse where clause
        const whereMatch = options.match(/where:\s*"([^"]+)"/);
        if (whereMatch) {
          index.where = whereMatch[1];
        }

        // Parse name if specified
        const nameMatch = options.match(/name:\s*"([^"]+)"/);
        if (nameMatch) {
          index.name = nameMatch[1];
        }

        table.indexes.push(index);
      }
    }

    // Also parse single column indexes
    const singleIndexRegex = /add_index\s+"([^"]+)",\s+"([^"]+)"(?:,\s*(.*))?$/gm;
    while ((match = singleIndexRegex.exec(content)) !== null) {
      const tableName = match[1];
      const columnName = match[2];
      const options = match[3] || '';

      const table = this.tables.get(tableName);
      if (table) {
        const index: SchemaIndex = {
          name: this.generateIndexName(tableName, [columnName], options.includes('unique: true')),
          table: tableName,
          columns: [columnName],
          unique: options.includes('unique: true')
        };

        // Parse name if specified
        const nameMatch = options.match(/name:\s*"([^"]+)"/);
        if (nameMatch) {
          index.name = nameMatch[1];
        }

        table.indexes.push(index);
      }
    }
  }

  private parseForeignKeys(content: string) {
    // Parse add_foreign_key statements
    const fkRegex = /add_foreign_key\s+"([^"]+)",\s+"([^"]+)"(?:,\s*(.*))?$/gm;
    let match;

    while ((match = fkRegex.exec(content)) !== null) {
      const fromTable = match[1];
      const toTable = match[2];
      const options = match[3] || '';

      const fk: SchemaForeignKey = {
        from_table: fromTable,
        from_column: `${this.singularize(toTable)}_id`, // Default column name
        to_table: toTable,
        to_column: 'id' // Default primary key
      };

      // Parse column if specified
      const columnMatch = options.match(/column:\s*"([^"]+)"/);
      if (columnMatch) {
        fk.from_column = columnMatch[1];
      }

      // Parse primary_key if specified
      const pkMatch = options.match(/primary_key:\s*"([^"]+)"/);
      if (pkMatch) {
        fk.to_column = pkMatch[1];
      }

      // Parse on_delete
      const onDeleteMatch = options.match(/on_delete:\s*:(\w+)/);
      if (onDeleteMatch) {
        fk.on_delete = onDeleteMatch[1];
      }

      // Parse on_update
      const onUpdateMatch = options.match(/on_update:\s*:(\w+)/);
      if (onUpdateMatch) {
        fk.on_update = onUpdateMatch[1];
      }

      this.foreign_keys.push(fk);
    }
  }

  private generateIndexName(table: string, columns: string[], unique: boolean): string {
    const prefix = unique ? 'index' : 'index';
    return `${prefix}_${table}_on_${columns.join('_and_')}`;
  }

  private singularize(word: string): string {
    // Simple singularization
    if (word.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    } else if (word.endsWith('es')) {
      return word.slice(0, -2);
    } else if (word.endsWith('s')) {
      return word.slice(0, -1);
    }
    return word;
  }

  private pluralToSingular(word: string): string {
    return this.singularize(word);
  }
}