/**
 * Ruby Parser using regex patterns
 * No external dependencies required!
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

export interface RubySymbol {
  name: string;
  type: string;
  parent?: string | null;
  parent_symbol?: string | null;
  start_line: number;
  end_line: number;
  signature?: string | null;
  visibility: string;
  documentation?: string | null;
  references?: string[];
  metadata?: any[];
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
  private currentVisibility: string = 'public';
  private currentClass: string | null = null;
  private currentModule: string | null = null;

  constructor(rubyParserPath?: string) {
    // rubyParserPath is ignored (kept for compatibility)
  }

  /**
   * Check if parser is available
   */
  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    return {
      available: true,
      version: 'regex-based-parser-1.0'
    };
  }

  /**
   * Parse a Ruby file and extract symbols
   */
  async parseFile(filePath: string): Promise<RubyParseResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return this.emptyResult(`File not found: ${filePath}`);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      const result: RubyParseResult = {
        symbols: [],
        associations: [],
        validations: [],
        callbacks: [],
        requires: [],
        require_relatives: [],
        includes: [],
        extends: [],
        line_count: lines.length,
        hash: crypto.createHash('sha256').update(content).digest('hex')
      };

      this.parseContent(lines, result);
      return result;
    } catch (error: any) {
      return this.emptyResult(`Parse error: ${error.message}`);
    }
  }

  private parseContent(lines: string[], result: RubyParseResult) {
    const classStack: string[] = [];
    let currentVisibility = 'public';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') continue;

      // Class definition
      const classMatch = line.match(/^\s*class\s+(\w+)(?:\s*<\s*(\w+))?/);
      if (classMatch) {
        const className = classMatch[1];
        const superClass = classMatch[2] || null;
        classStack.push(className);
        
        result.symbols.push({
          name: className,
          type: 'class',
          parent_symbol: superClass,
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
          signature: null,
          visibility: 'public',
          documentation: null
        });
        continue;
      }

      // Module definition
      const moduleMatch = line.match(/^\s*module\s+(\w+)/);
      if (moduleMatch) {
        const moduleName = moduleMatch[1];
        classStack.push(moduleName);
        
        result.symbols.push({
          name: moduleName,
          type: 'module',
          parent_symbol: null,
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
          signature: null,
          visibility: 'public',
          documentation: null
        });
        continue;
      }

      // Method definition
      const methodMatch = line.match(/^\s*def\s+(self\.)?(\w+[\w?!=]*)\s*(\([^)]*\))?/);
      if (methodMatch) {
        const isClassMethod = !!methodMatch[1];
        const methodName = methodMatch[2];
        const params = methodMatch[3] || '';
        const fullName = isClassMethod ? `self.${methodName}` : methodName;
        
        result.symbols.push({
          name: fullName,
          type: 'method',
          parent_symbol: classStack.length > 0 ? classStack[classStack.length - 1] : null,
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
          signature: `${fullName}${params}`,
          visibility: currentVisibility,
          documentation: null
        });
        continue;
      }

      // Rails associations
      const associationMatch = line.match(/^\s*(has_many|has_one|belongs_to|has_and_belongs_to_many)\s+:(\w+)/);
      if (associationMatch) {
        result.associations.push({
          type: associationMatch[1],
          name: associationMatch[2]
        });
        continue;
      }

      // Rails validations
      const validationMatch = line.match(/^\s*validates?\s+:(\w+)/);
      if (validationMatch) {
        result.validations.push(validationMatch[1]);
        continue;
      }

      // Rails callbacks
      const callbackMatch = line.match(/^\s*(before_|after_|around_)(save|create|update|destroy|validation|commit|rollback)\s+:(\w+)/);
      if (callbackMatch) {
        result.callbacks.push({
          type: `${callbackMatch[1]}${callbackMatch[2]}`,
          method: callbackMatch[3]
        });
        continue;
      }

      // Scope definitions
      const scopeMatch = line.match(/^\s*scope\s+:(\w+)/);
      if (scopeMatch) {
        result.symbols.push({
          name: scopeMatch[1],
          type: 'scope',
          parent_symbol: classStack.length > 0 ? classStack[classStack.length - 1] : null,
          start_line: lineNum,
          end_line: lineNum,
          signature: null,
          visibility: 'public',
          documentation: 'scope'
        });
        continue;
      }

      // Attr accessors
      const attrMatch = line.match(/^\s*(attr_reader|attr_writer|attr_accessor)\s+:(\w+)/);
      if (attrMatch) {
        result.symbols.push({
          name: attrMatch[2],
          type: 'attr',
          parent_symbol: classStack.length > 0 ? classStack[classStack.length - 1] : null,
          start_line: lineNum,
          end_line: lineNum,
          signature: null,
          visibility: currentVisibility,
          documentation: attrMatch[1]
        });
        continue;
      }

      // Include statements
      const includeMatch = line.match(/^\s*include\s+(\w+)/);
      if (includeMatch) {
        result.includes.push(includeMatch[1]);
        continue;
      }

      // Extend statements
      const extendMatch = line.match(/^\s*extend\s+(\w+)/);
      if (extendMatch) {
        result.extends.push(extendMatch[1]);
        continue;
      }

      // Require statements
      const requireMatch = line.match(/^\s*require\s+['"]([^'"]+)['"]/);
      if (requireMatch) {
        result.requires.push(requireMatch[1]);
        continue;
      }

      // Require_relative statements
      const requireRelativeMatch = line.match(/^\s*require_relative\s+['"]([^'"]+)['"]/);
      if (requireRelativeMatch) {
        result.require_relatives.push(requireRelativeMatch[1]);
        continue;
      }

      // Visibility modifiers
      if (line.match(/^\s*private\s*$/)) {
        currentVisibility = 'private';
        continue;
      }
      if (line.match(/^\s*protected\s*$/)) {
        currentVisibility = 'protected';
        continue;
      }
      if (line.match(/^\s*public\s*$/)) {
        currentVisibility = 'public';
        continue;
      }

      // End statements
      if (line.match(/^\s*end\s*$/)) {
        if (classStack.length > 0) {
          classStack.pop();
          currentVisibility = 'public'; // Reset visibility when leaving class/module
        }
      }
    }
  }

  private findEndLine(lines: string[], startIndex: number): number {
    let depth = 1;
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^\s*(class|module|def|if|unless|while|until|for|begin|case)\b/)) {
        depth++;
      }
      if (line === 'end' || line.match(/^\s*end\s*$/)) {
        depth--;
        if (depth === 0) {
          return i + 1;
        }
      }
    }
    return lines.length;
  }

  private emptyResult(error?: string): RubyParseResult {
    return {
      symbols: [],
      associations: [],
      validations: [],
      callbacks: [],
      requires: [],
      require_relatives: [],
      includes: [],
      extends: [],
      line_count: 0,
      hash: '',
      error
    };
  }
}