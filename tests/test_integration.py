#!/usr/bin/env python3
"""Integration tests for Rails MCP Indexer"""

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from database import IndexDatabase
from indexer import CodeIndexer


async def test_basic_indexing():
    """Test basic indexing functionality"""
    print("Testing basic indexing...")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create test Ruby files
        test_files = {
            "app/models/user.rb": """
class User < ApplicationRecord
  has_many :posts
  validates :email, presence: true
  
  def full_name
    "#{first_name} #{last_name}"
  end
end
""",
            "app/controllers/users_controller.rb": """
class UsersController < ApplicationController
  before_action :authenticate_user!
  
  def index
    @users = User.all
  end
  
  def show
    @user = User.find(params[:id])
  end
end
""",
            "app/services/user_service.rb": """
class UserService
  def self.call(params)
    new(params).call
  end
  
  def initialize(params)
    @params = params
  end
  
  def call
    User.create!(@params)
  end
end
"""
        }
        
        # Create directory structure and files
        for filepath, content in test_files.items():
            full_path = Path(tmpdir) / filepath
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content)
        
        # Create database and indexer
        db_path = Path(tmpdir) / "test.db"
        db = IndexDatabase(str(db_path))
        
        # Use the Ruby AST parser from src directory
        parser_path = Path(__file__).parent.parent / "src" / "ruby_ast_parser.rb"
        indexer = CodeIndexer(tmpdir, db, str(parser_path))
        
        # Index the files
        await indexer.reindex(full=True)
        
        # Test searches
        print("Testing search_symbols...")
        results = await indexer.search_symbols("User", k=5)
        assert len(results) > 0, "Should find User symbols"
        
        results = await indexer.search_symbols("validates", file_types=["model"])
        assert len(results) > 0, "Should find validation in model"
        
        print("Testing get_snippet...")
        snippet = await indexer.get_snippet(
            str(Path(tmpdir) / "app/models/user.rb"),
            symbol_name="full_name"
        )
        assert "first_name" in snippet, "Should extract full_name method"
        
        print("✓ All basic tests passed!")
        return True


async def test_rails_patterns():
    """Test Rails-specific pattern recognition"""
    print("Testing Rails pattern recognition...")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create Rails-specific test files
        test_files = {
            "app/models/post.rb": """
class Post < ApplicationRecord
  belongs_to :user
  has_many :comments, dependent: :destroy
  
  validates :title, presence: true
  validates :content, length: { minimum: 10 }
  
  scope :published, -> { where(published: true) }
  scope :recent, -> { order(created_at: :desc) }
  
  before_save :set_slug
  after_create :notify_subscribers
  
  private
  
  def set_slug
    self.slug = title.parameterize
  end
  
  def notify_subscribers
    UserMailer.new_post(self).deliver_later
  end
end
""",
            "app/controllers/api/v1/posts_controller.rb": """
module Api
  module V1
    class PostsController < ApiController
      def index
        @posts = Post.published.recent
        render json: @posts
      end
    end
  end
end
""",
            "app/jobs/cleanup_job.rb": """
class CleanupJob < ApplicationJob
  queue_as :default
  
  def perform(*args)
    Post.where("created_at < ?", 1.year.ago).destroy_all
  end
end
"""
        }
        
        # Create files
        for filepath, content in test_files.items():
            full_path = Path(tmpdir) / filepath
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content)
        
        # Create database and indexer
        db_path = Path(tmpdir) / "test.db"
        db = IndexDatabase(str(db_path))
        parser_path = Path(__file__).parent.parent / "src" / "ruby_ast_parser.rb"
        indexer = CodeIndexer(tmpdir, db, str(parser_path))
        
        # Index the files
        await indexer.reindex(full=True)
        
        # Test Rails-specific searches
        print("Testing associations...")
        results = await indexer.search_symbols("belongs_to", file_types=["model"])
        assert len(results) > 0, "Should find belongs_to associations"
        
        results = await indexer.search_symbols("has_many", file_types=["model"])
        assert len(results) > 0, "Should find has_many associations"
        
        print("Testing scopes...")
        results = await indexer.search_symbols("scope published", file_types=["model"])
        assert len(results) > 0, "Should find scopes"
        
        print("Testing callbacks...")
        results = await indexer.search_symbols("before_save after_create", file_types=["model"])
        assert len(results) > 0, "Should find callbacks"
        
        print("Testing API controllers...")
        results = await indexer.search_symbols("Api V1", file_types=["controller"])
        assert len(results) > 0, "Should find API controllers"
        
        print("✓ All Rails pattern tests passed!")
        return True


async def test_find_similar():
    """Test finding similar code patterns"""
    print("Testing find_similar functionality...")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create files with similar patterns
        test_files = {
            "app/services/user_creator.rb": """
class UserCreator
  def self.call(params)
    new(params).call
  end
  
  def initialize(params)
    @params = params
  end
  
  def call
    User.create!(@params)
  end
end
""",
            "app/services/post_creator.rb": """
class PostCreator
  def self.call(params)
    new(params).call
  end
  
  def initialize(params)
    @params = params
  end
  
  def call
    Post.create!(@params)
  end
end
""",
            "app/models/user.rb": """
class User < ApplicationRecord
  validates :email, presence: true, uniqueness: true
end
""",
            "app/models/admin.rb": """
class Admin < ApplicationRecord
  validates :email, presence: true, uniqueness: true
end
"""
        }
        
        # Create files
        for filepath, content in test_files.items():
            full_path = Path(tmpdir) / filepath
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content)
        
        # Create database and indexer
        db_path = Path(tmpdir) / "test.db"
        db = IndexDatabase(str(db_path))
        parser_path = Path(__file__).parent.parent / "src" / "ruby_ast_parser.rb"
        indexer = CodeIndexer(tmpdir, db, str(parser_path))
        
        # Index the files
        await indexer.reindex(full=True)
        
        # Test finding similar patterns
        print("Testing service object pattern...")
        similar = await indexer.find_similar(
            "def self.call(params)\n  new(params).call\nend",
            k=5,
            min_similarity=0.5
        )
        assert len(similar) >= 2, "Should find similar service patterns"
        
        print("Testing validation pattern...")
        similar = await indexer.find_similar(
            "validates :email, presence: true, uniqueness: true",
            k=5,
            min_similarity=0.7
        )
        assert len(similar) >= 2, "Should find similar validation patterns"
        
        print("✓ All similarity tests passed!")
        return True


async def main():
    """Run all tests"""
    print("=" * 50)
    print("Rails MCP Indexer Integration Tests")
    print("=" * 50)
    print()
    
    tests = [
        test_basic_indexing,
        test_rails_patterns,
        test_find_similar
    ]
    
    for test in tests:
        try:
            await test()
            print()
        except Exception as e:
            print(f"❌ Test failed: {e}")
            import traceback
            traceback.print_exc()
            return 1
    
    print("=" * 50)
    print("✅ All integration tests passed!")
    print("=" * 50)
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)