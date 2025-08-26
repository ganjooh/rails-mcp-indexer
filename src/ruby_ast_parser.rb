#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'digest'

require 'rubygems'

# Check Ruby version and use appropriate parser
ruby_version = Gem::Version.new(RUBY_VERSION)
use_prism = ruby_version >= Gem::Version.new('3.3.0')

if use_prism
  require 'prism'
else
  # Fallback to parser gem for Ruby < 3.3
  begin
    require 'parser/current'
  rescue LoadError
    puts JSON.generate({ 
      error: "Ruby #{RUBY_VERSION} detected. Please install 'parser' gem: gem install parser",
      hint: "Or upgrade to Ruby 3.3+ for built-in Prism support"
    })
    exit 1
  end
end

# Ruby AST parser for extracting symbols and structure from Ruby files
class RubyASTParser
  def initialize(file_path)
    @file_path = file_path
    @content = File.read(file_path, mode: 'r:BOM|UTF-8')
    @symbols = []
    @associations = []
    @validations = []
    @callbacks = []
    @requires = []
    @require_relatives = []
    @includes = []
    @extends = []
  end

  def parse
    if use_prism
      parse_with_prism
    else
      parse_with_parser_gem
    end
    
    {
      hash: Digest::SHA256.hexdigest(@content),
      file_type: detect_file_type(@file_path),
      line_count: @content.lines.length,
      symbols: @symbols,
      requires: @requires,
      require_relatives: @require_relatives,
      includes: @includes,
      extends: @extends,
      classes: @symbols.select { |s| s[:type] == 'class' }.map { |s| s[:name] },
      modules: @symbols.select { |s| s[:type] == 'module' }.map { |s| s[:name] },
      methods: @symbols.select { |s| s[:type] =~ /method/ }.map { |s| s[:name] },
      associations: @associations,
      validations: @validations,
      callbacks: @callbacks
    }
  rescue => e
    { error: e.message, backtrace: e.backtrace.first(5) }
  end

  private

  def use_prism
    defined?(Prism) != nil
  end

  def parse_with_prism
    result = Prism.parse(@content)
    walk_prism(result.value) if result.value
  end

  def parse_with_parser_gem
    buffer = Parser::Source::Buffer.new(@file_path)
    buffer.source = @content
    parser = Parser::CurrentRuby.new
    ast = parser.parse(buffer)
    walk_parser_ast(ast) if ast
  rescue Parser::SyntaxError => e
    # Continue with partial results on syntax error
  end

  def walk_prism(node, parents = [])
    return unless node.respond_to?(:child_nodes)
    
    case node
    when Prism::ClassNode
      name = extract_const_path(node.constant_path)
      parent_name = node.superclass ? source(node.superclass) : nil
      
      @symbols << {
        name: name,
        type: 'class',
        parent: parent_name,
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        visibility: 'public',
        references: [],
        metadata: extract_class_metadata(node, name)
      }
      
    when Prism::ModuleNode
      name = extract_const_path(node.constant_path)
      
      @symbols << {
        name: name,
        type: 'module',
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
    when Prism::DefNode
      parent = find_enclosing_class_or_module(parents)
      visibility = determine_visibility(parents, node)
      
      @symbols << {
        name: node.name.to_s,
        type: 'method',
        parent: parent,
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        signature: build_method_signature(node),
        visibility: visibility,
        references: extract_method_references(node),
        metadata: []
      }
      
    when Prism::SingletonMethodDefNode
      receiver = source(node.receiver)
      
      @symbols << {
        name: node.name.to_s,
        type: 'class_method',
        parent: receiver,
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        signature: build_singleton_method_signature(node),
        visibility: 'public',
        references: extract_method_references(node),
        metadata: []
      }
      
    when Prism::ConstantWriteNode
      @symbols << {
        name: node.name.to_s,
        type: 'constant',
        parent: find_enclosing_class_or_module(parents),
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
    when Prism::CallNode
      handle_call_node(node)
    end
    
    parents.push(node)
    node.child_nodes.each { |child| walk_prism(child, parents) }
    parents.pop
  end

  def walk_parser_ast(node, parents = [], visibility = 'public')
    return unless node.is_a?(Parser::AST::Node)
    
    case node.type
    when :class
      const_node, superclass_node, body = node.children
      name = extract_const_name(const_node)
      parent_name = superclass_node ? extract_const_name(superclass_node) : nil
      
      @symbols << {
        name: name,
        type: 'class',
        parent: parent_name,
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
      parents.push(name)
      walk_parser_ast(body, parents, 'public') if body
      parents.pop
      return  # Prevent double traversal
      
    when :module
      const_node, body = node.children
      name = extract_const_name(const_node)
      
      @symbols << {
        name: name,
        type: 'module',
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
      parents.push(name)
      walk_parser_ast(body, parents, 'public') if body
      parents.pop
      return  # Prevent double traversal
      
    when :def
      method_name = node.children[0].to_s
      parent = parents.last
      
      @symbols << {
        name: method_name,
        type: 'method',
        parent: parent,
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        signature: extract_method_signature_parser(node),
        visibility: visibility,
        references: [],
        metadata: []
      }
      
    when :defs
      receiver_node, method_name, args, body = node.children
      receiver = extract_receiver_name(receiver_node)
      
      @symbols << {
        name: method_name.to_s,
        type: 'class_method',
        parent: receiver,
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        signature: extract_method_signature_parser(node),
        visibility: 'public',
        references: [],
        metadata: []
      }
      
    when :casgn
      if node.children[0].nil?  # Top-level constant
        const_name = node.children[1].to_s
        @symbols << {
          name: const_name,
          type: 'constant',
          parent: parents.last,
          start_line: node.loc.line,
          end_line: node.loc.line,
          visibility: 'public',
          references: [],
          metadata: []
        }
      end
      
    when :send
      handle_send_node_parser(node, parents, visibility)
      
    when :begin
      # Handle visibility changes in begin blocks
      current_vis = visibility
      node.children.each do |child|
        if child.is_a?(Parser::AST::Node) && child.type == :send
          receiver, method_name = child.children[0..1]
          if receiver.nil? && %i[private protected public].include?(method_name)
            current_vis = method_name.to_s
            next
          end
        end
        walk_parser_ast(child, parents, current_vis)
      end
      return  # Prevent double traversal for begin blocks
    end
    
    # Recursively walk children
    node.children.each do |child|
      walk_parser_ast(child, parents, visibility) if child.is_a?(Parser::AST::Node)
    end
  end

  def handle_call_node(node)
    method_name = node.name.to_s
    
    case method_name
    when 'require'
      if node.arguments&.arguments&.first&.is_a?(Prism::StringNode)
        @requires << node.arguments.arguments.first.unescaped
      end
    when 'require_relative'
      if node.arguments&.arguments&.first&.is_a?(Prism::StringNode)
        @require_relatives << node.arguments.arguments.first.unescaped
      end
    when 'include'
      if node.arguments&.arguments&.first
        @includes << extract_const_from_arg(node.arguments.arguments.first)
      end
    when 'extend'
      if node.arguments&.arguments&.first
        @extends << extract_const_from_arg(node.arguments.arguments.first)
      end
    when 'has_many', 'has_one', 'belongs_to', 'has_and_belongs_to_many'
      if node.arguments&.arguments&.first&.is_a?(Prism::SymbolNode)
        @associations << {
          type: method_name,
          name: node.arguments.arguments.first.value.to_s
        }
      end
    when 'validates', 'validate'
      if node.arguments
        node.arguments.arguments.each do |arg|
          if arg.is_a?(Prism::SymbolNode)
            @validations << arg.value.to_s
          end
        end
      end
    when /^(before|after|around)_(validation|save|create|update|destroy|commit|rollback)$/
      if node.arguments&.arguments&.first&.is_a?(Prism::SymbolNode)
        @callbacks << {
          type: method_name,
          method: node.arguments.arguments.first.value.to_s
        }
      end
    end
  end

  def handle_send_node_parser(node, parents, visibility)
    receiver, method_name, *args = node.children
    
    return unless receiver.nil?  # Only handle module-level calls
    
    case method_name
    when :require
      if args.first && args.first.type == :str
        @requires << args.first.children.first
      end
    when :require_relative
      if args.first && args.first.type == :str
        @require_relatives << args.first.children.first
      end
    when :include
      if args.first
        @includes << extract_const_name(args.first)
      end
    when :extend
      if args.first
        @extends << extract_const_name(args.first)
      end
    when :has_many, :has_one, :belongs_to, :has_and_belongs_to_many
      if args.first && args.first.type == :sym
        @associations << {
          type: method_name.to_s,
          name: args.first.children.first.to_s
        }
      end
    when :validates, :validate
      args.each do |arg|
        if arg.type == :sym
          @validations << arg.children.first.to_s
        end
      end
    when /^(before|after|around)_(validation|save|create|update|destroy|commit|rollback)$/
      if args.first && args.first.type == :sym
        @callbacks << {
          type: method_name.to_s,
          method: args.first.children.first.to_s
        }
      end
    end
  end

  def extract_const_path(node)
    return '' unless node
    source(node)
  end

  def extract_const_from_arg(node)
    case node
    when Prism::ConstantReadNode, Prism::ConstantPathNode
      source(node)
    else
      ''
    end
  end

  def extract_const_name(node)
    return '' unless node
    
    case node.type
    when :const
      parts = []
      current = node
      while current && current.type == :const
        parts.unshift(current.children[1].to_s)
        current = current.children[0]
      end
      parts.join('::')
    when :cbase
      '::' + extract_const_name(node.children[0]) if node.children[0]
    else
      node.to_s
    end
  end

  def extract_receiver_name(node)
    case node.type
    when :self
      'self'
    when :const
      extract_const_name(node)
    else
      node.to_s
    end
  end

  def extract_method_signature_parser(node)
    method_name = node.type == :def ? node.children[0] : node.children[1]
    args_node = node.type == :def ? node.children[1] : node.children[2]
    
    args_str = if args_node && args_node.type == :args
                 args_node.children.map { |arg| arg.children[0] }.join(', ')
               else
                 ''
               end
    
    args_str.empty? ? method_name.to_s : "#{method_name}(#{args_str})"
  end

  def source(node)
    node.respond_to?(:slice) ? node.slice : node.to_s
  end

  def find_enclosing_class_or_module(parents)
    parents.reverse.find do |p|
      p.is_a?(Prism::ClassNode) || p.is_a?(Prism::ModuleNode)
    end&.then do |node|
      case node
      when Prism::ClassNode
        extract_const_path(node.constant_path)
      when Prism::ModuleNode
        extract_const_path(node.constant_path)
      end
    end
  end

  def determine_visibility(parents, node)
    # Check for private def, protected def patterns
    # This is simplified - a full implementation would track visibility state
    'public'
  end

  def build_method_signature(node)
    params = if node.parameters
               format_parameters(node.parameters)
             else
               ''
             end
    
    params.empty? ? node.name.to_s : "#{node.name}(#{params})"
  end

  def build_singleton_method_signature(node)
    params = if node.parameters
               format_parameters(node.parameters)
             else
               ''
             end
    
    params.empty? ? node.name.to_s : "#{node.name}(#{params})"
  end

  def format_parameters(params_node)
    # Simplified parameter formatting
    # A full implementation would handle all parameter types
    return '' unless params_node
    
    if params_node.respond_to?(:requireds)
      parts = []
      parts.concat(params_node.requireds.map(&:name)) if params_node.requireds.any?
      parts.concat(params_node.optionals.map { |p| "#{p.name} = ..." }) if params_node.optionals.any?
      parts << "*#{params_node.rest.name}" if params_node.rest
      parts.concat(params_node.keywords.map { |p| "#{p.name}:" }) if params_node.keywords.any?
      parts << "**#{params_node.keyword_rest.name}" if params_node.keyword_rest
      parts << "&#{params_node.block.name}" if params_node.block
      parts.join(', ')
    else
      '...'
    end
  end

  def extract_method_references(node)
    # Extract method calls within this method
    # This would require deeper AST traversal
    []
  end

  def extract_class_metadata(node, class_name)
    metadata = []
    
    # Check for Rails-specific patterns
    if detect_file_type(@file_path) == 'model'
      # Look for STI, table_name overrides, etc.
      # This would require analyzing the class body
    end
    
    metadata
  end

  def detect_file_type(path)
    case path
    when %r{app/models/}
      'model'
    when %r{app/controllers/}
      'controller'
    when %r{app/services/}
      'service'
    when %r{app/jobs/}, %r{app/sidekiq/}
      'job'
    when %r{app/policies/}
      'policy'
    when %r{app/mailers/}
      'mailer'
    when %r{app/helpers/}
      'helper'
    when %r{app/controllers/concerns/}, %r{app/models/concerns/}
      'concern'
    when %r{spec/.*_spec\.rb$}
      'spec'
    when %r{test/.*_test\.rb$}
      'test'
    when %r{db/migrate/}
      'migration'
    else
      'other'
    end
  end
end

# Main execution
if ARGV.length != 1
  puts JSON.generate({ error: 'Usage: ruby_ast_parser.rb <file_path>' })
  exit 1
end

file_path = ARGV[0]

unless File.exist?(file_path)
  puts JSON.generate({ error: "File not found: #{file_path}" })
  exit 1
end

begin
  parser = RubyASTParser.new(file_path)
  result = parser.parse
  puts JSON.generate(result)
rescue => e
  puts JSON.generate({ error: e.message, backtrace: e.backtrace.first(10) })
  exit 1
end