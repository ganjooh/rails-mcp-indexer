/**
 * Graph Builder for populating knowledge graph from AST and schema data
 */

import { GraphStore, KGNode } from './graph-store.js';
import { IndexDatabase } from './database.js';
import * as path from 'path';

export class GraphBuilder {
  private graph: GraphStore;
  private db: IndexDatabase;
  private nodeCache: Map<string, number> = new Map();

  constructor(db: IndexDatabase) {
    this.db = db;
    this.graph = db.graph;
  }

  /**
   * Build graph from AST parse result
   */
  async buildFromAST(filePath: string, parseResult: any, fileId: number): Promise<void> {
    const relativePath = filePath;
    
    // Create file node
    const fileNodeId = this.graph.upsertNode({
      kind: 'file',
      key: relativePath,
      label: path.basename(relativePath),
      source: 'ast',
      file_path: relativePath,
      meta_json: {
        line_count: parseResult.line_count || 0,
        file_type: parseResult.file_type
      }
    });

    // Process symbols
    if (parseResult.symbols) {
      for (const symbol of parseResult.symbols) {
        await this.processSymbol(symbol, fileNodeId, relativePath);
      }
    }

    // Process Rails associations
    if (parseResult.associations) {
      await this.processRailsAssociations(parseResult.associations, fileNodeId, relativePath);
    }

    // Process dependencies (requires, includes, extends)
    if (parseResult.dependencies) {
      await this.processDependencies(parseResult.dependencies, fileNodeId, relativePath);
    }
  }

  private async processSymbol(symbol: any, fileNodeId: number, filePath: string): Promise<void> {
    // Build node key based on symbol type and hierarchy
    const nodeKey = this.buildSymbolKey(symbol);
    
    // Create symbol node
    const symbolNodeId = this.graph.upsertNode({
      kind: symbol.type, // class, module, method
      key: nodeKey,
      label: symbol.name,
      source: 'ast',
      file_path: filePath,
      start_line: symbol.start_line,
      end_line: symbol.end_line,
      meta_json: {
        visibility: symbol.visibility || 'public',
        signature: symbol.signature,
        documentation: symbol.documentation,
        parent: symbol.parent_symbol || symbol.parent
      }
    });

    // Cache the node ID for later reference
    this.nodeCache.set(nodeKey, symbolNodeId);

    // Create defines edge from file to symbol
    this.graph.upsertEdge({
      kind: 'defines',
      src_id: fileNodeId,
      dst_id: symbolNodeId,
      src_loc: `${filePath}`,
      dst_loc: `${filePath}:${symbol.start_line}`
    });

    // Handle parent relationships
    if (symbol.parent_symbol || symbol.parent) {
      const parentKey = symbol.parent_symbol || symbol.parent;
      const parentNodeId = this.nodeCache.get(parentKey);
      
      if (parentNodeId) {
        // Create defines edge from parent to child
        this.graph.upsertEdge({
          kind: 'defines',
          src_id: parentNodeId,
          dst_id: symbolNodeId
        });
      }
    }

    // Handle inheritance
    if (symbol.superclass && symbol.type === 'class') {
      await this.createInheritanceEdge(symbolNodeId, symbol.superclass, filePath, symbol.start_line);
    }

    // Handle module includes/extends
    if (symbol.includes) {
      for (const includedModule of symbol.includes) {
        await this.createIncludeEdge(symbolNodeId, includedModule, filePath, symbol.start_line);
      }
    }

    if (symbol.extends) {
      for (const extendedModule of symbol.extends) {
        await this.createExtendEdge(symbolNodeId, extendedModule, filePath, symbol.start_line);
      }
    }
  }

  private buildSymbolKey(symbol: any): string {
    if (symbol.type === 'method') {
      const parent = symbol.parent_symbol || symbol.parent;
      if (parent) {
        const separator = symbol.method_type === 'class' ? '.' : '#';
        return `${parent}${separator}${symbol.name}`;
      }
      return symbol.name;
    }
    return symbol.name;
  }

  private async createInheritanceEdge(childId: number, superclass: string, filePath: string, line: number): Promise<void> {
    // Try to find or create the superclass node
    let parentNodeId = this.nodeCache.get(superclass);
    
    if (!parentNodeId) {
      // Create a placeholder node for the superclass
      parentNodeId = this.graph.upsertNode({
        kind: 'class',
        key: superclass,
        label: superclass,
        source: 'ast',
        meta_json: { inferred: true }
      });
      this.nodeCache.set(superclass, parentNodeId);
    }

    this.graph.upsertEdge({
      kind: 'inherits',
      src_id: childId,
      dst_id: parentNodeId,
      src_loc: `${filePath}:${line}`
    });
  }

  private async createIncludeEdge(classId: number, moduleName: string, filePath: string, line: number): Promise<void> {
    let moduleNodeId = this.nodeCache.get(moduleName);
    
    if (!moduleNodeId) {
      moduleNodeId = this.graph.upsertNode({
        kind: 'module',
        key: moduleName,
        label: moduleName,
        source: 'ast',
        meta_json: { inferred: true }
      });
      this.nodeCache.set(moduleName, moduleNodeId);
    }

    this.graph.upsertEdge({
      kind: 'includes',
      src_id: classId,
      dst_id: moduleNodeId as number,
      src_loc: `${filePath}:${line}`
    });
  }

  private async createExtendEdge(classId: number, moduleName: string, filePath: string, line: number): Promise<void> {
    let moduleNodeId = this.nodeCache.get(moduleName);
    
    if (!moduleNodeId) {
      moduleNodeId = this.graph.upsertNode({
        kind: 'module',
        key: moduleName,
        label: moduleName,
        source: 'ast',
        meta_json: { inferred: true }
      });
      this.nodeCache.set(moduleName, moduleNodeId);
    }

    this.graph.upsertEdge({
      kind: 'extends',
      src_id: classId,
      dst_id: moduleNodeId as number,
      src_loc: `${filePath}:${line}`
    });
  }

  private async processRailsAssociations(associations: any[], fileNodeId: number, filePath: string): Promise<void> {
    for (const assoc of associations) {
      // Get the model node (should already exist from symbol processing)
      const modelKey = assoc.class_name || assoc.model_name;
      if (!modelKey) continue;

      const modelNodeId = this.nodeCache.get(modelKey);
      if (!modelNodeId) continue;

      // Create or find the target model node
      const targetModel = assoc.target_model || assoc.class_name || this.inferModelFromAssociation(assoc);
      if (!targetModel) continue;

      let targetNodeId = this.nodeCache.get(targetModel);
      if (!targetNodeId) {
        targetNodeId = this.graph.upsertNode({
          kind: 'class',
          key: targetModel,
          label: targetModel,
          source: 'ast',
          meta_json: { inferred: true, model: true }
        });
        this.nodeCache.set(targetModel, targetNodeId);
      }

      // Create association edge
      const edgeKind = assoc.type || 'belongs_to'; // belongs_to, has_many, has_one, has_and_belongs_to_many
      this.graph.upsertEdge({
        kind: edgeKind,
        src_id: modelNodeId,
        dst_id: targetNodeId as number,
        meta_json: {
          options: assoc.options || {},
          foreign_key: assoc.foreign_key,
          through: assoc.through
        }
      });
    }
  }

  private inferModelFromAssociation(assoc: any): string | null {
    if (assoc.name && assoc.type) {
      // Simple inference based on association name
      const name = assoc.name;
      if (assoc.type === 'belongs_to') {
        // Singularize and capitalize
        return name.charAt(0).toUpperCase() + name.slice(1);
      } else if (assoc.type === 'has_many') {
        // Singularize and capitalize
        const singular = name.endsWith('s') ? name.slice(0, -1) : name;
        return singular.charAt(0).toUpperCase() + singular.slice(1);
      }
    }
    return null;
  }

  private async processDependencies(dependencies: any[], fileNodeId: number, filePath: string): Promise<void> {
    for (const dep of dependencies) {
      if (dep.type === 'require' || dep.type === 'require_relative') {
        // Handle file dependencies
        const targetPath = dep.path || dep.name;
        if (targetPath) {
          const targetNodeId = this.graph.upsertNode({
            kind: 'file',
            key: targetPath,
            label: path.basename(targetPath),
            source: 'ast',
            meta_json: { inferred: true }
          });

          this.graph.upsertEdge({
            kind: 'requires',
            src_id: fileNodeId,
            dst_id: targetNodeId,
            src_loc: `${filePath}:${dep.line}`
          });
        }
      }
    }
  }

  /**
   * Build graph from database schema
   */
  async buildFromSchema(schemaTables: any[]): Promise<void> {
    for (const table of schemaTables) {
      // Create table node
      const tableNodeId = this.graph.upsertNode({
        kind: 'table',
        key: table.name,
        label: table.name,
        source: 'db',
        meta_json: {
          primary_key: table.primary_key || 'id'
        }
      });

      // Create column nodes and edges
      if (table.columns) {
        for (const column of table.columns) {
          const columnKey = `${table.name}.${column.name}`;
          const columnNodeId = this.graph.upsertNode({
            kind: 'column',
            key: columnKey,
            label: column.name,
            source: 'db',
            meta_json: {
              type: column.column_type || column.type,
              nullable: column.nullable,
              default: column.default_value || column.default,
              limit: column.column_limit || column.limit,
              precision: column.precision,
              scale: column.scale
            }
          });

          // Create has_column edge
          this.graph.upsertEdge({
            kind: 'has_column',
            src_id: tableNodeId,
            dst_id: columnNodeId
          });

          // Handle foreign key references
          if (column.name.endsWith('_id')) {
            const referencedTable = column.name.slice(0, -3).replace(/_/g, '') + 's'; // Simple pluralization
            const referencedTableNode = this.graph.upsertNode({
              kind: 'table',
              key: referencedTable,
              label: referencedTable,
              source: 'db',
              meta_json: { inferred: true }
            });

            this.graph.upsertEdge({
              kind: 'references',
              src_id: columnNodeId,
              dst_id: referencedTableNode
            });
          }
        }
      }

      // Create backs edge between model and table
      const modelName = this.tableNameToModelName(table.name);
      const modelNode = this.nodeCache.get(modelName) || 
        (this.graph as any).getNodeByKey?.('class', modelName);

      if (modelNode) {
        const modelNodeId = typeof modelNode === 'number' ? modelNode : modelNode.id!;
        this.graph.upsertEdge({
          kind: 'backs',
          src_id: modelNodeId,
          dst_id: tableNodeId,
          meta_json: {
            convention: 'rails'
          }
        });
      }

      // Handle indexes
      if (table.indexes) {
        for (const index of table.indexes) {
          const indexNodeId = this.graph.upsertNode({
            kind: 'index',
            key: `${table.name}.${index.name || 'idx'}`,
            label: index.name || `index_on_${index.columns.join('_')}`,
            source: 'db',
            meta_json: {
              columns: index.columns,
              unique: index.unique,
              where: index.where
            }
          });

          this.graph.upsertEdge({
            kind: 'has_index',
            src_id: tableNodeId,
            dst_id: indexNodeId
          });
        }
      }
    }
  }

  private tableNameToModelName(tableName: string): string {
    // Simple Rails convention: pluralized table name to singular model name
    // users -> User, order_items -> OrderItem
    let modelName = tableName;
    
    // Simple singularization
    if (modelName.endsWith('ies')) {
      modelName = modelName.slice(0, -3) + 'y';
    } else if (modelName.endsWith('es')) {
      modelName = modelName.slice(0, -2);
    } else if (modelName.endsWith('s')) {
      modelName = modelName.slice(0, -1);
    }
    
    // Convert snake_case to CamelCase
    modelName = modelName.split('_').map(part => 
      part.charAt(0).toUpperCase() + part.slice(1)
    ).join('');
    
    return modelName;
  }

  /**
   * Clear and reset the graph
   */
  clearGraph(): void {
    this.graph.clearGraph();
    this.nodeCache.clear();
  }

  /**
   * Get graph statistics
   */
  getStats(): any {
    return (this.graph as any).getGraphStats ? (this.graph as any).getGraphStats() : {};
  }
}