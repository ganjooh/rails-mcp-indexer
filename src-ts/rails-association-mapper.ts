/**
 * Maps database foreign keys to Rails associations
 */

import { SchemaForeignKey } from './schema-parser.js';

export interface RailsAssociation {
  model: string;
  association_type: 'belongs_to' | 'has_many' | 'has_one';
  name: string;
  options: Record<string, any>;
  source: 'foreign_key' | 'index' | 'inference';
}

export class RailsAssociationMapper {
  /**
   * Generate Rails associations from foreign keys and schema metadata
   */
  generateAssociations(
    tableName: string,
    foreignKeys: SchemaForeignKey[],
    allTables: string[],
    indexes?: any[]
  ): RailsAssociation[] {
    const associations: RailsAssociation[] = [];
    const modelName = this.tableToModel(tableName);

    // Process foreign keys where this table is the source (belongs_to)
    const outgoingFks = foreignKeys.filter(fk => fk.from_table === tableName);
    for (const fk of outgoingFks) {
      const associationName = this.inferAssociationName(fk.from_column, fk.to_table);
      
      associations.push({
        model: modelName,
        association_type: 'belongs_to',
        name: associationName,
        options: this.buildBelongsToOptions(fk),
        source: 'foreign_key'
      });
    }

    // Process foreign keys where this table is the target (has_many/has_one)
    const incomingFks = foreignKeys.filter(fk => fk.to_table === tableName);
    for (const fk of incomingFks) {
      const isUnique = this.isUniqueColumn(fk.from_table, fk.from_column, indexes);
      const associationType = isUnique ? 'has_one' : 'has_many';
      const associationName = isUnique ? 
        this.singularize(fk.from_table) : 
        fk.from_table;

      associations.push({
        model: modelName,
        association_type: associationType,
        name: associationName,
        options: this.buildHasManyOptions(fk),
        source: 'foreign_key'
      });
    }

    // Infer polymorphic associations
    const polymorphicAssociations = this.inferPolymorphicAssociations(tableName, indexes);
    associations.push(...polymorphicAssociations);

    // Infer join table associations (has_many :through)
    const throughAssociations = this.inferThroughAssociations(tableName, foreignKeys, allTables);
    associations.push(...throughAssociations);

    return associations;
  }

  /**
   * Generate migration code for adding a foreign key
   */
  generateForeignKeyMigration(fk: SchemaForeignKey): string {
    const parts = [`add_foreign_key "${fk.from_table}", "${fk.to_table}"`];
    
    if (fk.from_column !== `${this.singularize(fk.to_table)}_id`) {
      parts.push(`column: "${fk.from_column}"`);
    }
    
    if (fk.to_column !== 'id') {
      parts.push(`primary_key: "${fk.to_column}"`);
    }
    
    if (fk.on_delete) {
      parts.push(`on_delete: :${fk.on_delete}`);
    }
    
    if (fk.on_update) {
      parts.push(`on_update: :${fk.on_update}`);
    }
    
    return parts.join(', ');
  }

  /**
   * Suggest validations based on schema constraints
   */
  suggestValidations(columns: any[], indexes: any[]): string[] {
    const validations: string[] = [];

    for (const column of columns) {
      // Presence validation for non-nullable columns
      if (!column.nullable && column.name !== 'id' && 
          !column.name.endsWith('_at') && !column.default_value) {
        validations.push(`validates :${column.name}, presence: true`);
      }

      // Length validation for string columns with limit
      if (column.column_type === 'string' && column.column_limit) {
        validations.push(`validates :${column.name}, length: { maximum: ${column.column_limit} }`);
      }

      // Numericality for numeric columns
      if (['integer', 'decimal', 'float'].includes(column.column_type)) {
        const options: string[] = [];
        if (column.column_type === 'integer') {
          options.push('only_integer: true');
        }
        if (column.name.includes('price') || column.name.includes('amount')) {
          options.push('greater_than_or_equal_to: 0');
        }
        if (options.length > 0) {
          validations.push(`validates :${column.name}, numericality: { ${options.join(', ')} }`);
        }
      }
    }

    // Uniqueness validations from unique indexes
    for (const index of indexes) {
      if (index.unique_index && index.columns.length === 1) {
        validations.push(`validates :${index.columns[0]}, uniqueness: true`);
      } else if (index.unique_index && index.columns.length > 1) {
        const [first, ...rest] = index.columns;
        validations.push(`validates :${first}, uniqueness: { scope: [${rest.map((c: string) => `:${c}`).join(', ')}] }`);
      }
    }

    return validations;
  }

  private buildBelongsToOptions(fk: SchemaForeignKey): Record<string, any> {
    const options: Record<string, any> = {};
    
    // Add class_name if it doesn't match convention
    const expectedTable = this.pluralize(this.inferAssociationName(fk.from_column, fk.to_table));
    if (expectedTable !== fk.to_table) {
      options.class_name = this.tableToModel(fk.to_table);
    }

    // Add foreign_key if it doesn't match convention
    const expectedColumn = `${this.singularize(fk.to_table)}_id`;
    if (fk.from_column !== expectedColumn) {
      options.foreign_key = fk.from_column;
    }

    // Add inverse_of suggestion
    options.inverse_of = `:${fk.from_table}`;

    // Add optional: false for non-nullable foreign keys
    // This would need column metadata to determine

    return options;
  }

  private buildHasManyOptions(fk: SchemaForeignKey): Record<string, any> {
    const options: Record<string, any> = {};

    // Add dependent option based on on_delete
    if (fk.on_delete === 'cascade') {
      options.dependent = ':destroy';
    } else if (fk.on_delete === 'set_null') {
      options.dependent = ':nullify';
    } else if (fk.on_delete === 'restrict') {
      options.dependent = ':restrict_with_exception';
    }

    // Add foreign_key if non-standard
    const expectedColumn = `${this.singularize(fk.to_table)}_id`;
    if (fk.from_column !== expectedColumn) {
      options.foreign_key = fk.from_column;
    }

    // Add inverse_of
    options.inverse_of = `:${this.inferAssociationName(fk.from_column, fk.to_table)}`;

    return options;
  }

  private inferAssociationName(columnName: string, targetTable: string): string {
    // Remove _id suffix
    if (columnName.endsWith('_id')) {
      return columnName.slice(0, -3);
    }
    // Use singularized table name
    return this.singularize(targetTable);
  }

  private inferPolymorphicAssociations(tableName: string, indexes?: any[]): RailsAssociation[] {
    // Look for _type and _id column pairs
    // This would need column metadata to implement properly
    return [];
  }

  private inferThroughAssociations(
    tableName: string,
    foreignKeys: SchemaForeignKey[],
    allTables: string[]
  ): RailsAssociation[] {
    // Detect join tables and suggest has_many :through associations
    // A join table typically has exactly 2 foreign keys and possibly timestamps
    return [];
  }

  private isUniqueColumn(tableName: string, columnName: string, indexes?: any[]): boolean {
    if (!indexes) return false;
    
    return indexes.some(idx => 
      idx.table === tableName &&
      idx.unique &&
      idx.columns.length === 1 &&
      idx.columns[0] === columnName
    );
  }

  private tableToModel(tableName: string): string {
    // Convert table name to model name (users -> User)
    return this.camelize(this.singularize(tableName));
  }

  private singularize(word: string): string {
    if (word.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    } else if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) {
      return word.slice(0, -2);
    } else if (word.endsWith('ches') || word.endsWith('shes')) {
      return word.slice(0, -2);
    } else if (word.endsWith('ves')) {
      return word.slice(0, -3) + 'f';
    } else if (word.endsWith('oes')) {
      return word.slice(0, -2);
    } else if (word.endsWith('s') && !word.endsWith('ss')) {
      return word.slice(0, -1);
    }
    return word;
  }

  private pluralize(word: string): string {
    if (word.endsWith('y') && !['ay', 'ey', 'iy', 'oy', 'uy'].includes(word.slice(-2))) {
      return word.slice(0, -1) + 'ies';
    } else if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') ||
               word.endsWith('ch') || word.endsWith('sh')) {
      return word + 'es';
    } else if (word.endsWith('f')) {
      return word.slice(0, -1) + 'ves';
    } else if (word.endsWith('fe')) {
      return word.slice(0, -2) + 'ves';
    } else if (word.endsWith('o') && !['eo', 'io', 'oo'].includes(word.slice(-2))) {
      return word + 'es';
    } else {
      return word + 's';
    }
  }

  private camelize(word: string): string {
    return word
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
}