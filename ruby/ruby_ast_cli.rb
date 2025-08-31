#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'digest'

# Choose backend based on Ruby version and environment
backend = ENV['RUBY_AST_BACKEND'] || (RUBY_VERSION >= '3.3.0' ? 'prism' : 'parser')

# Load the appropriate parser
begin
  if backend == 'prism' && RUBY_VERSION >= '3.3.0'
    require 'prism'
  else
    require 'parser/current'
    Parser::Builders::Default.emit_lambda = true
    Parser::Builders::Default.emit_procarg0 = true
  end
rescue LoadError => e
  STDERR.puts "Error loading #{backend}: #{e.message}"
  STDERR.puts "Run 'bundle install' in the ruby directory"
  exit 1
end

class RubyASTExtractor
  attr_reader :symbols, :associations, :validations, :callbacks, :requires, 
              :require_relatives, :includes, :extends, :methods, :classes, 
              :modules, :scopes, :file_type

  def initialize(file_path)
    @file_path = file_path
    @symbols = []
    @associations = []
    @validations = []
    @callbacks = []
    @requires = []
    @require_relatives = []
    @includes = []
    @extends = []
    @methods = []
    @classes = []
    @modules = []
    @scopes = []
    @file_type = detect_file_type(file_path)
  end

  def detect_file_type(path)
    case path
    when %r{app/models/} then 'model'
    when %r{app/controllers/} then 'controller'
    when %r{app/services/} then 'service'
    when %r{app/jobs/}, %r{app/sidekiq/} then 'job'
    when %r{app/policies/} then 'policy'
    when %r{app/mailers/} then 'mailer'
    when %r{app/helpers/} then 'helper'
    when %r{/concerns/} then 'concern'
    when %r{spec/.*_spec\.rb$}, %r{test/.*_test\.rb$} then 'spec'
    when %r{db/migrate/} then 'migration'
    else 'ruby'
    end
  end

  def parse(source)
    if defined?(Prism)
      parse_with_prism(source)
    else
      parse_with_parser(source)
    end
  end

  private

  def parse_with_parser(source)
    begin
      buffer = Parser::Source::Buffer.new(@file_path, source: source)
      parser = Parser::CurrentRuby.new
      ast = parser.parse(buffer)
      
      walk_parser_ast(ast) if ast
    rescue Parser::SyntaxError => e
      STDERR.puts "Parse error: #{e.message}"
    end
  end

  def parse_with_prism(source)
    begin
      result = Prism.parse(source)
      walk_prism_ast(result.value) if result.success?
    rescue => e
      STDERR.puts "Prism parse error: #{e.message}"
    end
  end

  def walk_parser_ast(node, parent_class = nil, visibility = :public)
    return unless node.is_a?(Parser::AST::Node)

    case node.type
    when :class
      class_name = extract_const_name(node.children[0])
      parent = extract_const_name(node.children[1]) if node.children[1]
      
      @classes << class_name
      @symbols << {
        name: class_name,
        type: 'class',
        parent: parent,
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
      walk_parser_ast(node.children[2], class_name, :public) if node.children[2]

    when :module
      module_name = extract_const_name(node.children[0])
      @modules << module_name
      @symbols << {
        name: module_name,
        type: 'module',
        parent: nil,
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
      walk_parser_ast(node.children[1], module_name, :public) if node.children[1]

    when :def
      method_name = node.children[0].to_s
      @methods << method_name
      @symbols << {
        name: method_name,
        type: 'method',
        parent: parent_class,
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        visibility: visibility.to_s,
        references: [],
        metadata: []
      }

    when :defs
      # Class method
      method_name = node.children[1].to_s
      @methods << "self.#{method_name}"
      @symbols << {
        name: "self.#{method_name}",
        type: 'method',
        parent: parent_class,
        start_line: node.loc.line,
        end_line: node.loc.last_line,
        visibility: visibility.to_s,
        references: [],
        metadata: []
      }

    when :send
      handle_send_node(node, parent_class)

    when :begin
      # Handle visibility changes
      new_visibility = visibility
      node.children.each do |child|
        if child.is_a?(Parser::AST::Node) && child.type == :send
          receiver, method = child.children[0], child.children[1]
          if receiver.nil? && [:private, :protected, :public].include?(method)
            new_visibility = method
          else
            walk_parser_ast(child, parent_class, new_visibility)
          end
        else
          walk_parser_ast(child, parent_class, new_visibility)
        end
      end
      return
    end

    # Walk children
    node.children.each do |child|
      walk_parser_ast(child, parent_class, visibility) if child.is_a?(Parser::AST::Node)
    end
  end

  def walk_prism_ast(node)
    # Simplified Prism walker - would need full implementation
    case node
    when Prism::ClassNode
      class_name = node.constant_path.name.to_s
      @classes << class_name
      @symbols << {
        name: class_name,
        type: 'class',
        parent: node.superclass&.name&.to_s,
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
      walk_prism_ast(node.body) if node.body
      
    when Prism::ModuleNode
      module_name = node.constant_path.name.to_s
      @modules << module_name
      @symbols << {
        name: module_name,
        type: 'module',
        parent: nil,
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
      
      walk_prism_ast(node.body) if node.body
      
    when Prism::DefNode
      @methods << node.name.to_s
      @symbols << {
        name: node.name.to_s,
        type: 'method',
        parent: nil,
        start_line: node.location.start_line,
        end_line: node.location.end_line,
        visibility: 'public',
        references: [],
        metadata: []
      }
    end
    
    # Walk children for other node types
    if node.respond_to?(:child_nodes)
      node.child_nodes.each { |child| walk_prism_ast(child) if child }
    end
  end

  def handle_send_node(node, parent_class)
    receiver, method, *args = node.children
    
    # Rails DSL detection
    case method
    when :has_many, :has_one, :belongs_to, :has_and_belongs_to_many
      if receiver.nil? && args[0]
        assoc_name = extract_symbol_or_string(args[0])
        @associations << {
          type: method.to_s,
          name: assoc_name,
          options: extract_hash_options(args[1])
        }
      end
      
    when :validates, :validate
      if receiver.nil? && args[0]
        field = extract_symbol_or_string(args[0])
        @validations << {
          field: field,
          options: extract_hash_options(args[1])
        }
      end
      
    when :before_save, :after_save, :before_create, :after_create,
         :before_update, :after_update, :before_destroy, :after_destroy,
         :before_validation, :after_validation
      if receiver.nil? && args[0]
        callback = extract_symbol_or_string(args[0])
        @callbacks << {
          type: method.to_s,
          method: callback
        }
      end
      
    when :scope
      if receiver.nil? && args[0]
        scope_name = extract_symbol_or_string(args[0])
        @scopes << scope_name
        @symbols << {
          name: scope_name,
          type: 'scope',
          parent: parent_class,
          start_line: node.loc.line,
          end_line: node.loc.line,
          visibility: 'public',
          references: [],
          metadata: []
        }
      end
      
    when :require
      if receiver.nil? && args[0]
        @requires << extract_symbol_or_string(args[0])
      end
      
    when :require_relative
      if receiver.nil? && args[0]
        @require_relatives << extract_symbol_or_string(args[0])
      end
      
    when :include
      if receiver.nil? && args[0]
        @includes << extract_const_name(args[0])
      end
      
    when :extend
      if receiver.nil? && args[0]
        @extends << extract_const_name(args[0])
      end
    end
  end

  def extract_const_name(node)
    return nil unless node
    
    case node.type
    when :const
      parts = []
      current = node
      while current && current.type == :const
        parts.unshift(current.children[1].to_s)
        current = current.children[0]
      end
      parts.join('::')
    else
      nil
    end
  end

  def extract_symbol_or_string(node)
    return nil unless node
    
    case node.type
    when :sym
      node.children[0].to_s
    when :str
      node.children[0]
    else
      nil
    end
  end

  def extract_hash_options(node)
    return {} unless node && node.type == :hash
    
    options = {}
    node.children.each do |pair|
      next unless pair.type == :pair
      key = extract_symbol_or_string(pair.children[0])
      value = extract_value(pair.children[1])
      options[key] = value if key
    end
    options
  end

  def extract_value(node)
    return nil unless node
    
    case node.type
    when :sym
      node.children[0].to_s
    when :str
      node.children[0]
    when :true
      true
    when :false
      false
    when :int, :float
      node.children[0]
    when :array
      node.children.map { |child| extract_value(child) }
    else
      nil
    end
  end
end

# Main execution
if ARGV.empty?
  STDERR.puts "Usage: #{$0} <file_path>"
  exit 1
end

file_path = ARGV[0]

unless File.exist?(file_path)
  STDERR.puts "File not found: #{file_path}"
  exit 1
end

begin
  source = File.read(file_path)
  extractor = RubyASTExtractor.new(file_path)
  extractor.parse(source)
  
  # Build output JSON
  output = {
    hash: Digest::SHA256.hexdigest(source),
    file_type: extractor.file_type,
    line_count: source.lines.count,
    symbols: extractor.symbols,
    requires: extractor.requires,
    require_relatives: extractor.require_relatives,
    includes: extractor.includes,
    extends: extractor.extends,
    classes: extractor.classes,
    modules: extractor.modules,
    methods: extractor.methods,
    associations: extractor.associations,
    validations: extractor.validations,
    callbacks: extractor.callbacks,
    scopes: extractor.scopes
  }
  
  puts JSON.pretty_generate(output)
rescue => e
  STDERR.puts "Error: #{e.message}"
  STDERR.puts e.backtrace.first(5)
  exit 1
end