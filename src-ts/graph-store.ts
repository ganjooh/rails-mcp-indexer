/**
 * Knowledge Graph Store for Rails MCP Indexer
 */

import Database from 'better-sqlite3';

export interface KGNode {
  id?: number;
  kind: string;
  key: string;
  label?: string;
  source: "ast" | "db" | "manual";
  file_path?: string;
  start_line?: number;
  end_line?: number;
  meta_json?: any;
}

export interface KGEdge {
  id?: number;
  kind: string;
  src_id: number;
  dst_id: number;
  src_loc?: string;
  dst_loc?: string;
  meta_json?: any;
}

export interface GraphStore {
  upsertNode(n: KGNode): number;
  upsertEdge(e: KGEdge): number;
  findNodes(opts: { kind?: string; q?: string; limit?: number }): KGNode[];
  neighbors(nodeId: number, edgeKinds?: string[], dir?: "out" | "in" | "both", depth?: number): { nodes: KGNode[]; edges: KGEdge[] };
  getNode(id: number): KGNode | null;
  clearGraph(): void;
}

export class SQLiteGraphStore implements GraphStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsertNode(n: KGNode): number {
    const meta = typeof n.meta_json === 'object' ? JSON.stringify(n.meta_json) : (n.meta_json || '{}');
    
    const stmt = this.db.prepare(`
      INSERT INTO kg_nodes (kind, key, label, source, file_path, start_line, end_line, meta_json)
      VALUES (@kind, @key, @label, @source, @file_path, @start_line, @end_line, @meta)
      ON CONFLICT(kind, key) DO UPDATE SET
        label = excluded.label,
        source = excluded.source,
        file_path = excluded.file_path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        meta_json = excluded.meta_json
      RETURNING id
    `);
    
    const result = stmt.get({
      kind: n.kind,
      key: n.key,
      label: n.label || n.key,
      source: n.source,
      file_path: n.file_path || null,
      start_line: n.start_line || null,
      end_line: n.end_line || null,
      meta: meta
    }) as { id: number };
    
    return result.id;
  }

  upsertEdge(e: KGEdge): number {
    const meta = typeof e.meta_json === 'object' ? JSON.stringify(e.meta_json) : (e.meta_json || '{}');
    
    const stmt = this.db.prepare(`
      INSERT INTO kg_edges (kind, src_id, dst_id, src_loc, dst_loc, meta_json)
      VALUES (@kind, @src_id, @dst_id, @src_loc, @dst_loc, @meta)
      ON CONFLICT(kind, src_id, dst_id) DO UPDATE SET
        src_loc = excluded.src_loc,
        dst_loc = excluded.dst_loc,
        meta_json = excluded.meta_json
      RETURNING id
    `);
    
    const result = stmt.get({
      kind: e.kind,
      src_id: e.src_id,
      dst_id: e.dst_id,
      src_loc: e.src_loc || null,
      dst_loc: e.dst_loc || null,
      meta: meta
    }) as { id: number };
    
    return result.id;
  }

  findNodes(opts: { kind?: string; q?: string; limit?: number }): KGNode[] {
    const limit = opts.limit || 50;
    let sql = 'SELECT * FROM kg_nodes WHERE 1=1';
    const params: any[] = [];
    
    if (opts.kind) {
      sql += ' AND kind = ?';
      params.push(opts.kind);
    }
    
    if (opts.q) {
      sql += ' AND (key LIKE ? OR label LIKE ?)';
      const pattern = `%${opts.q}%`;
      params.push(pattern, pattern);
    }
    
    sql += ' ORDER BY kind, key LIMIT ?';
    params.push(limit);
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => ({
      ...row,
      meta_json: row.meta_json ? JSON.parse(row.meta_json) : {}
    }));
  }

  neighbors(
    nodeId: number, 
    edgeKinds?: string[], 
    dir: "out" | "in" | "both" = "both", 
    depth: number = 1
  ): { nodes: KGNode[]; edges: KGEdge[] } {
    if (depth < 1 || depth > 3) {
      depth = 1; // Limit depth for performance
    }
    
    const visitedNodes = new Set<number>();
    const visitedEdges = new Set<number>();
    const nodes: KGNode[] = [];
    const edges: KGEdge[] = [];
    
    // BFS traversal
    const queue: { nodeId: number; level: number }[] = [{ nodeId, level: 0 }];
    visitedNodes.add(nodeId);
    
    // Add the starting node
    const startNode = this.getNode(nodeId);
    if (startNode) {
      nodes.push(startNode);
    }
    
    while (queue.length > 0) {
      const { nodeId: currentId, level } = queue.shift()!;
      
      if (level >= depth) continue;
      
      // Build edge query based on direction
      let edgeSql = '';
      const params: any[] = [];
      
      if (dir === 'out' || dir === 'both') {
        edgeSql = 'SELECT * FROM kg_edges WHERE src_id = ?';
        params.push(currentId);
        
        if (edgeKinds && edgeKinds.length > 0) {
          const placeholders = edgeKinds.map(() => '?').join(',');
          edgeSql += ` AND kind IN (${placeholders})`;
          params.push(...edgeKinds);
        }
        
        const outEdges = this.db.prepare(edgeSql).all(...params) as any[];
        
        for (const edge of outEdges) {
          if (!visitedEdges.has(edge.id)) {
            visitedEdges.add(edge.id);
            edges.push({
              ...edge,
              meta_json: edge.meta_json ? JSON.parse(edge.meta_json) : {}
            });
            
            if (!visitedNodes.has(edge.dst_id)) {
              visitedNodes.add(edge.dst_id);
              const node = this.getNode(edge.dst_id);
              if (node) {
                nodes.push(node);
                queue.push({ nodeId: edge.dst_id, level: level + 1 });
              }
            }
          }
        }
      }
      
      if (dir === 'in' || dir === 'both') {
        edgeSql = 'SELECT * FROM kg_edges WHERE dst_id = ?';
        params.length = 0;
        params.push(currentId);
        
        if (edgeKinds && edgeKinds.length > 0) {
          const placeholders = edgeKinds.map(() => '?').join(',');
          edgeSql += ` AND kind IN (${placeholders})`;
          params.push(...edgeKinds);
        }
        
        const inEdges = this.db.prepare(edgeSql).all(...params) as any[];
        
        for (const edge of inEdges) {
          if (!visitedEdges.has(edge.id)) {
            visitedEdges.add(edge.id);
            edges.push({
              ...edge,
              meta_json: edge.meta_json ? JSON.parse(edge.meta_json) : {}
            });
            
            if (!visitedNodes.has(edge.src_id)) {
              visitedNodes.add(edge.src_id);
              const node = this.getNode(edge.src_id);
              if (node) {
                nodes.push(node);
                queue.push({ nodeId: edge.src_id, level: level + 1 });
              }
            }
          }
        }
      }
    }
    
    return { nodes, edges };
  }

  getNode(id: number): KGNode | null {
    const stmt = this.db.prepare('SELECT * FROM kg_nodes WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return {
      ...row,
      meta_json: row.meta_json ? JSON.parse(row.meta_json) : {}
    };
  }

  clearGraph(): void {
    this.db.prepare('DELETE FROM kg_edges').run();
    this.db.prepare('DELETE FROM kg_nodes').run();
  }

  // Helper method to get node by kind and key
  getNodeByKey(kind: string, key: string): KGNode | null {
    const stmt = this.db.prepare('SELECT * FROM kg_nodes WHERE kind = ? AND key = ?');
    const row = stmt.get(kind, key) as any;
    
    if (!row) return null;
    
    return {
      ...row,
      meta_json: row.meta_json ? JSON.parse(row.meta_json) : {}
    };
  }

  // Get all edges for a node
  getEdges(nodeId: number, kind?: string): KGEdge[] {
    let sql = 'SELECT * FROM kg_edges WHERE (src_id = ? OR dst_id = ?)';
    const params: any[] = [nodeId, nodeId];
    
    if (kind) {
      sql += ' AND kind = ?';
      params.push(kind);
    }
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => ({
      ...row,
      meta_json: row.meta_json ? JSON.parse(row.meta_json) : {}
    }));
  }

  // Get statistics
  getGraphStats(): any {
    const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM kg_nodes').get() as { count: number };
    const edgeCount = this.db.prepare('SELECT COUNT(*) as count FROM kg_edges').get() as { count: number };
    
    const nodeKindStats = this.db.prepare(`
      SELECT kind, COUNT(*) as count 
      FROM kg_nodes 
      GROUP BY kind
      ORDER BY count DESC
    `).all();
    
    const edgeKindStats = this.db.prepare(`
      SELECT kind, COUNT(*) as count 
      FROM kg_edges 
      GROUP BY kind
      ORDER BY count DESC
    `).all();
    
    return {
      nodes: nodeCount.count,
      edges: edgeCount.count,
      nodeKinds: nodeKindStats,
      edgeKinds: edgeKindStats
    };
  }
}