/**
 * Ruby AST Parser Wrapper
 * Spawns Ruby subprocess to parse AST and extract symbols
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RubySymbol {
  name: string;
  type: string;
  parent_symbol: string | null;
  start_line: number;
  end_line: number;
  signature: string | null;
  visibility: string;
  documentation: string | null;
}

export interface RubyParseResult {
  symbols: RubySymbol[];
  associations: any[];
  validations: any[];
  callbacks: any[];
  requires: string[];
  require_relatives: string[];
  includes: string[];
  extends: string[];
  line_count: number;
  hash: string;
  error?: string;
}

export class RubyParser {
  private rubyParserPath: string;
  private rubyBin: string;

  constructor(rubyParserPath: string) {
    this.rubyParserPath = rubyParserPath;
    this.rubyBin = process.env.RUBY_BIN || 'ruby';
    
    // Verify parser script exists
    if (!fs.existsSync(this.rubyParserPath)) {
      throw new Error(`Ruby parser script not found at: ${this.rubyParserPath}`);
    }
  }

  /**
   * Check if Ruby is installed and get version info
   */
  async checkRubyVersion(): Promise<{ version: string; hasPrism: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.rubyBin, ['--version']);
      let output = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('Ruby not found or not executable'));
          return;
        }

        const versionMatch = output.match(/ruby (\d+\.\d+\.\d+)/);
        if (!versionMatch) {
          reject(new Error('Could not parse Ruby version'));
          return;
        }

        const version = versionMatch[1];
        const [major, minor] = version.split('.').map(Number);
        const hasPrism = major > 3 || (major === 3 && minor >= 3);

        resolve({ version, hasPrism });
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to check Ruby version: ${error.message}`));
      });
    });
  }

  /**
   * Parse a Ruby file and extract AST information
   */
  async parseFile(filePath: string): Promise<RubyParseResult> {
    return new Promise((resolve, reject) => {
      // Ensure file exists
      if (!fs.existsSync(filePath)) {
        reject(new Error(`File not found: ${filePath}`));
        return;
      }

      const child = spawn(this.rubyBin, [this.rubyParserPath, filePath]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          // Check if it's a parser gem missing error
          try {
            const errorData = JSON.parse(stdout);
            if (errorData.error && errorData.error.includes('parser gem')) {
              reject(new Error(
                'Ruby parser gem not installed. Run: gem install parser\n' +
                'Or upgrade to Ruby 3.3+ for built-in Prism support'
              ));
              return;
            }
          } catch {
            // Not a JSON error response
          }

          reject(new Error(`Ruby parser failed: ${stderr || stdout}`));
          return;
        }

        try {
          const result = JSON.parse(stdout) as RubyParseResult;
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Ruby output: ${error}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to spawn Ruby parser: ${error.message}`));
      });
    });
  }

  /**
   * Parse multiple files in parallel
   */
  async parseFiles(filePaths: string[], concurrency: number = 5): Promise<Map<string, RubyParseResult>> {
    const results = new Map<string, RubyParseResult>();
    const errors = new Map<string, Error>();

    // Process files in batches
    for (let i = 0; i < filePaths.length; i += concurrency) {
      const batch = filePaths.slice(i, i + concurrency);
      const promises = batch.map(async (filePath) => {
        try {
          const result = await this.parseFile(filePath);
          results.set(filePath, result);
        } catch (error) {
          errors.set(filePath, error as Error);
        }
      });

      await Promise.all(promises);
    }

    // Log errors but don't fail the entire operation
    if (errors.size > 0) {
      console.error(`Failed to parse ${errors.size} files:`);
      errors.forEach((error, filePath) => {
        console.error(`  ${filePath}: ${error.message}`);
      });
    }

    return results;
  }

  /**
   * Validate that Ruby environment is properly set up
   */
  async validateEnvironment(): Promise<{ valid: boolean; message: string }> {
    try {
      const { version, hasPrism } = await this.checkRubyVersion();
      
      // Try to parse a simple Ruby snippet
      const testFile = path.join(require('os').tmpdir(), 'test_ruby_parser.rb');
      fs.writeFileSync(testFile, 'class Test; def hello; "world"; end; end');
      
      try {
        await this.parseFile(testFile);
        fs.unlinkSync(testFile);
        
        return {
          valid: true,
          message: `Ruby ${version} detected. ${hasPrism ? 'Using built-in Prism parser' : 'Using parser gem'}`
        };
      } catch (error) {
        fs.unlinkSync(testFile);
        
        if ((error as Error).message.includes('parser gem')) {
          return {
            valid: false,
            message: `Ruby ${version} detected but parser gem is missing. Run: gem install parser`
          };
        }
        
        throw error;
      }
    } catch (error) {
      return {
        valid: false,
        message: `Ruby environment validation failed: ${(error as Error).message}`
      };
    }
  }
}