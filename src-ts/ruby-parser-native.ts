/**
 * Native Ruby AST parser integration
 * Uses actual Ruby parser gem or Prism for accurate AST parsing
 */

import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the package root by looking for package.json
function findPackageRoot(): string {
  let dir = __dirname;
  while (dir !== '/') {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return __dirname;
}

const packageRoot = findPackageRoot();
const RUBY_CLI = join(packageRoot, 'ruby', 'ruby_ast_cli.rb');

export interface NativeParseResult {
  hash: string;
  file_type: string;
  line_count: number;
  symbols: Array<{
    name: string;
    type: string;
    parent: string | null;
    start_line: number;
    end_line: number;
    visibility: string;
    references: string[];
    metadata: any[];
  }>;
  requires: string[];
  require_relatives: string[];
  includes: string[];
  extends: string[];
  classes: string[];
  modules: string[];
  methods: string[];
  associations: Array<{
    type: string;
    name: string;
    options: Record<string, any>;
  }>;
  validations: Array<{
    field: string;
    options: Record<string, any>;
  }>;
  callbacks: Array<{
    type: string;
    method: string;
  }>;
  scopes: string[];
}

export class NativeRubyParser {
  private rubyAvailable: boolean = false;
  private rubyVersion: string | null = null;
  
  constructor() {
    this.checkRubyAvailability();
  }
  
  private checkRubyAvailability(): void {
    try {
      const version = execSync('ruby -v', { stdio: 'pipe' }).toString().trim();
      this.rubyVersion = version;
      this.rubyAvailable = true;
      
      // Check if Ruby CLI exists
      if (!existsSync(RUBY_CLI)) {
        console.warn('[NativeRubyParser] Ruby CLI script not found at:', RUBY_CLI);
        console.warn('[NativeRubyParser] Looking in package root:', packageRoot);
        this.rubyAvailable = false;
      }
    } catch (error) {
      this.rubyAvailable = false;
      console.warn('[NativeRubyParser] Ruby not available, will use fallback parser');
      console.warn('[NativeRubyParser] Error:', error);
    }
  }
  
  public isAvailable(): boolean {
    return this.rubyAvailable;
  }
  
  public getVersion(): string | null {
    return this.rubyVersion;
  }
  
  public async parseFile(filePath: string): Promise<NativeParseResult> {
    if (!this.rubyAvailable) {
      throw new Error('Ruby runtime not available');
    }
    
    return new Promise((resolve, reject) => {
      const rubyProcess = spawn('ruby', [RUBY_CLI, filePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          RUBY_AST_BACKEND: process.env.RUBY_AST_BACKEND || 'parser'
        }
      });
      
      let stdout = '';
      let stderr = '';
      
      rubyProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      rubyProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      rubyProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse Ruby output: ${e}`));
          }
        } else {
          reject(new Error(`Ruby parser failed: ${stderr || `exit code ${code}`}`));
        }
      });
      
      rubyProcess.on('error', (err) => {
        reject(new Error(`Failed to spawn Ruby process: ${err.message}`));
      });
    });
  }
  
  public async parseFileWithFallback(
    filePath: string, 
    fallbackParser: (path: string) => Promise<any>
  ): Promise<NativeParseResult | any> {
    if (this.rubyAvailable) {
      try {
        return await this.parseFile(filePath);
      } catch (error) {
        console.warn(`[NativeRubyParser] Native parse failed for ${filePath}, using fallback:`, error);
        return fallbackParser(filePath);
      }
    } else {
      return fallbackParser(filePath);
    }
  }
}