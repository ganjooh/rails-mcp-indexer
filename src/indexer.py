"""
Code indexing logic for Ruby/Rails projects
"""

import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

class CodeIndexer:
    """Handles code indexing and retrieval operations"""
    
    def __init__(self, repo_path: Path, db, ruby_parser: str):
        self.repo_path = repo_path
        self.db = db
        self.ruby_parser = ruby_parser
        
        # Rails-specific patterns - aligned with Ruby parser
        self.rails_patterns = {
            'model': r'app/models/.*\.rb$',
            'controller': r'app/controllers/.*\.rb$',
            'service': r'app/services/.*\.rb$',
            'job': r'(app/jobs/|app/sidekiq/).*\.rb$',  # Fixed: both paths
            'policy': r'app/policies/.*\.rb$',
            'mailer': r'app/mailers/.*\.rb$',
            'helper': r'app/helpers/.*\.rb$',
            'concern': r'app/(controllers|models)/concerns/.*\.rb$',
            'spec': r'(spec|test)/.*_(spec|test)\.rb$',
            'migration': r'db/migrate/.*\.rb$'
        }
    
    async def search_symbols(
        self, 
        query: str, 
        k: int = 10,
        file_types: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Search for symbols in the codebase"""
        
        # Build search query
        search_terms = query.lower().split()
        
        # Get matching symbols from database
        results = self.db.search_symbols(search_terms, k * 2)  # Get more for filtering
        
        # Filter by file types if specified
        if file_types:
            filtered = []
            for result in results:
                file_path = result['file_path']
                for file_type in file_types:
                    if file_type in self.rails_patterns:
                        pattern = self.rails_patterns[file_type]
                        if re.search(pattern, file_path):  # Fixed: use search not match
                            filtered.append(result)
                            break
            results = filtered
        
        # Rank results
        ranked = self._rank_results(results, search_terms)
        
        # Return top k
        return ranked[:k]
    
    async def get_snippet(
        self,
        file_path: str,
        start_line: Optional[int] = None,
        end_line: Optional[int] = None,
        symbol_name: Optional[str] = None
    ) -> str:
        """Get a code snippet from a file"""
        
        full_path = self.repo_path / file_path
        
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        if symbol_name:
            # Get symbol boundaries from AST
            boundaries = await self._get_symbol_boundaries(file_path, symbol_name)
            if boundaries:
                start_line, end_line = boundaries
            else:
                return f"Symbol '{symbol_name}' not found in {file_path}"
        
        # Read file and extract lines
        with open(full_path, 'r') as f:
            lines = f.readlines()
        
        if start_line is None:
            start_line = 1
        if end_line is None:
            end_line = len(lines)
        
        # Adjust for 0-based indexing
        start_idx = max(0, start_line - 1)
        end_idx = min(len(lines), end_line)
        
        # Safety limit: cap at 400 lines
        MAX_LINES = 400
        if end_idx - start_idx > MAX_LINES:
            end_idx = start_idx + MAX_LINES
        
        # Extract snippet
        snippet_lines = lines[start_idx:end_idx]
        
        # Add line numbers
        numbered_lines = []
        for i, line in enumerate(snippet_lines, start=start_line):
            numbered_lines.append(f"{i:4d}→ {line.rstrip()}")
        
        return '\n'.join(numbered_lines)
    
    async def get_call_graph(
        self,
        symbol: str,
        direction: str = "both",
        depth: int = 1
    ) -> Dict[str, Any]:
        """Get call graph for a symbol"""
        
        graph = {
            'symbol': symbol,
            'callers': [],
            'callees': []
        }
        
        # Parse symbol (e.g., "Campaign#update" -> class: Campaign, method: update)
        parts = self._parse_symbol(symbol)
        
        if direction in ['callers', 'both']:
            callers = await self._find_callers(parts, depth)
            graph['callers'] = callers
        
        if direction in ['callees', 'both']:
            callees = await self._find_callees(parts, depth)
            graph['callees'] = callees
        
        return graph
    
    async def find_similar(
        self,
        code_snippet: str,
        k: int = 5,
        min_similarity: float = 0.7
    ) -> List[Dict[str, Any]]:
        """Find similar code patterns"""
        
        # Extract features from snippet
        snippet_features = await self._extract_features_from_snippet(code_snippet)
        
        # Search for similar patterns in database
        similar = self.db.find_similar_patterns(snippet_features, k * 2)
        
        # Calculate similarity scores
        results = []
        for item in similar:
            similarity = self._calculate_similarity(snippet_features, item)
            if similarity >= min_similarity:
                results.append({
                    'file_path': item['file_path'],
                    'symbol': item['symbol'],
                    'line': item['line'],
                    'similarity': similarity
                })
        
        # Sort by similarity and return top k
        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:k]
    
    async def get_file_summary(self, file_path: str) -> Dict[str, Any]:
        """Get a summary of a file"""
        
        full_path = self.repo_path / file_path
        
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        # Extract file data using Ruby parser
        file_data = await self._extract_file_ast(file_path)
        
        if not file_data:
            return {
                'file': file_path,
                'type': self._detect_file_type(file_path),
                'error': 'Failed to parse file'
            }
        
        summary = {
            'file': file_path,
            'type': file_data.get('file_type', self._detect_file_type(file_path)),
            'classes': file_data.get('classes', []),
            'modules': file_data.get('modules', []),
            'methods': file_data.get('methods', []),
            'associations': file_data.get('associations', []),
            'validations': file_data.get('validations', []),
            'callbacks': file_data.get('callbacks', []),
            'dependencies': file_data.get('requires', []) + file_data.get('require_relatives', []),
            'line_count': file_data.get('line_count', 0)
        }
        
        return summary
    
    async def find_associated_tests(self, file_path: str) -> List[str]:
        """Find test files for an implementation file"""
        
        # Convert implementation path to test path
        test_paths = []
        
        # Standard Rails conventions
        if 'app/' in file_path:
            # app/models/user.rb -> spec/models/user_spec.rb
            test_path = file_path.replace('app/', 'spec/').replace('.rb', '_spec.rb')
            test_paths.append(test_path)
            
            # Also check for integration tests
            if '/models/' in file_path:
                model_name = Path(file_path).stem
                test_paths.append(f'spec/requests/{model_name}s_spec.rb')
                test_paths.append(f'spec/integration/{model_name}s_spec.rb')
        
        # Filter existing files
        existing_tests = []
        for test_path in test_paths:
            full_path = self.repo_path / test_path
            if full_path.exists():
                existing_tests.append(test_path)
        
        return existing_tests
    
    async def get_index_status(self) -> Dict[str, Any]:
        """Get index status and statistics"""
        
        stats = self.db.get_statistics()
        
        return {
            'indexed_files': stats['file_count'],
            'total_symbols': stats['symbol_count'],
            'last_update': stats['last_update'],
            'index_size_mb': stats['db_size_mb'],
            'file_types': self._get_file_type_counts()
        }
    
    async def reindex(
        self,
        paths: Optional[List[str]] = None,
        full: bool = False
    ) -> Dict[str, Any]:
        """Reindex the codebase"""
        
        start_time = datetime.now()
        
        if full:
            # Clear existing index
            self.db.clear_index()
            paths = None
        
        # Get files to index
        if paths:
            files_to_index = [self.repo_path / p for p in paths]
        else:
            # Find all Ruby files
            files_to_index = list(self.repo_path.glob('**/*.rb'))
            
            # Exclude vendor, node_modules, etc.
            excluded_dirs = ['vendor', 'node_modules', 'tmp', 'log', '.git']
            files_to_index = [
                f for f in files_to_index
                if not any(ex in str(f) for ex in excluded_dirs)
            ]
        
        # Index files with concurrency control
        indexed_count = 0
        error_count = 0
        
        # Use semaphore for concurrency control (8 concurrent Ruby processes)
        sem = asyncio.Semaphore(8)
        
        async def index_with_sem(file_path):
            async with sem:
                try:
                    await self._index_file(file_path)
                    return True
                except Exception as e:
                    logger.error(f"Error indexing {file_path}: {e}")
                    return False
        
        # Process files concurrently
        tasks = [index_with_sem(f) for f in files_to_index]
        results = await asyncio.gather(*tasks)
        
        indexed_count = sum(1 for r in results if r)
        error_count = sum(1 for r in results if not r)
        
        # Commit changes
        self.db.commit()
        
        elapsed = (datetime.now() - start_time).total_seconds()
        
        return {
            'files_indexed': indexed_count,
            'errors': error_count,
            'elapsed_seconds': elapsed,
            'files_per_second': indexed_count / elapsed if elapsed > 0 else 0
        }
    
    # Private methods
    
    async def _run_ruby(self, args: List[str], *, timeout: float = 20.0) -> Optional[Dict]:
        """Run Ruby parser asynchronously without blocking event loop"""
        ruby = os.environ.get("RUBY_BIN", "ruby")
        
        proc = await asyncio.create_subprocess_exec(
            ruby, *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            logger.error(f"Ruby parser timeout for args: {args}")
            return None
        
        if proc.returncode != 0:
            # Log stderr for diagnostics
            logger.error("Ruby parser failed: %s", stderr.decode(errors="ignore")[:4000])
            return None
        
        try:
            return json.loads(stdout.decode())
        except json.JSONDecodeError:
            logger.error("Invalid JSON from Ruby parser")
            return None
    
    async def _index_file(self, file_path: Path):
        """Index a single file"""
        
        # Get relative path
        rel_path = file_path.relative_to(self.repo_path)
        
        # Extract file data
        file_data = await self._extract_file_ast(str(rel_path))
        
        if not file_data:
            return
        
        # Store in database
        self.db.index_file(str(rel_path), file_data)
    
    async def _extract_file_ast(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Extract AST from a Ruby file using the Ruby parser"""
        
        full_path = str(self.repo_path / file_path)
        return await self._run_ruby([self.ruby_parser, full_path])
    
    async def _extract_features_from_snippet(self, snippet: str) -> Dict[str, Any]:
        """Extract features from a code snippet"""
        
        # Write snippet to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.rb', delete=False) as f:
            f.write(snippet)
            temp_path = f.name
        
        try:
            # Parse with Ruby parser
            result = await self._run_ruby([self.ruby_parser, temp_path])
            return result or {}
        finally:
            os.unlink(temp_path)
    
    async def _get_symbol_boundaries(
        self, 
        file_path: str, 
        symbol_name: str
    ) -> Optional[Tuple[int, int]]:
        """Get line boundaries for a symbol"""
        
        # Query database for symbol location
        symbol_info = self.db.get_symbol_info(file_path, symbol_name)
        
        if symbol_info:
            return (symbol_info['start_line'], symbol_info['end_line'])
        
        return None
    
    async def _find_callers(
        self, 
        symbol_parts: Dict[str, str], 
        depth: int
    ) -> List[Dict[str, Any]]:
        """Find callers of a symbol"""
        
        # Search for references to this symbol
        callers = self.db.find_symbol_references(
            symbol_parts['class'],
            symbol_parts.get('method')
        )
        
        # Format results
        results = []
        for caller in callers:
            results.append({
                'file': caller['file_path'],
                'line': caller['line'],
                'context': caller['context']
            })
        
        return results
    
    async def _find_callees(
        self,
        symbol_parts: Dict[str, str],
        depth: int
    ) -> List[Dict[str, Any]]:
        """Find what a symbol calls"""
        
        # Get symbol implementation
        impl = self.db.get_symbol_implementation(
            symbol_parts['class'],
            symbol_parts.get('method')
        )
        
        if not impl:
            return []
        
        # Extract called methods from stored references
        callees = self._extract_method_calls(impl)
        
        return callees
    
    def _parse_symbol(self, symbol: str) -> Dict[str, str]:
        """Parse a symbol string"""
        
        parts = {}
        
        if '#' in symbol:
            # Instance method: Class#method
            class_name, method = symbol.split('#')
            parts['class'] = class_name
            parts['method'] = method
            parts['type'] = 'instance_method'
        elif '.' in symbol:
            # Class method: Class.method
            class_name, method = symbol.split('.')
            parts['class'] = class_name
            parts['method'] = method
            parts['type'] = 'class_method'
        else:
            # Just a class/module name
            parts['class'] = symbol
            parts['type'] = 'class'
        
        return parts
    
    def _rank_results(
        self, 
        results: List[Dict], 
        search_terms: List[str]
    ) -> List[Dict]:
        """Rank search results by relevance"""
        
        for result in results:
            score = 0
            
            # Score based on term matches
            symbol_lower = result['symbol'].lower()
            for term in search_terms:
                if term in symbol_lower:
                    score += 10
                if term in result['file_path'].lower():
                    score += 5
            
            # Boost for exact matches
            if ' '.join(search_terms) in symbol_lower:
                score += 20
            
            # Boost for common Rails patterns
            if '/models/' in result['file_path']:
                score += 3
            elif '/controllers/' in result['file_path']:
                score += 2
            
            result['score'] = score
        
        # Sort by score
        results.sort(key=lambda x: x['score'], reverse=True)
        
        return results
    
    def _calculate_similarity(
        self, 
        features_a: Dict[str, Any], 
        features_b: Dict[str, Any]
    ) -> float:
        """Calculate similarity between two feature sets using Jaccard similarity"""
        
        # Extract feature sets
        feats_a = set(self._extract_feature_tokens(features_a))
        feats_b = set(self._extract_feature_tokens(features_b))
        
        if not feats_a or not feats_b:
            return 0.0
        
        # Jaccard similarity
        intersection = len(feats_a & feats_b)
        union = len(feats_a | feats_b)
        
        return intersection / union if union > 0 else 0.0
    
    def _extract_feature_tokens(self, data: Dict[str, Any]) -> List[str]:
        """Extract feature tokens from parsed Ruby data"""
        
        features = []
        
        # Symbol features
        for symbol in data.get('symbols', []):
            features.append(f"{symbol.get('type')}:{symbol.get('parent')}::{symbol.get('name')}")
        
        # Association features
        for assoc in data.get('associations', []):
            features.append(f"assoc:{assoc.get('type')}:{assoc.get('name')}")
        
        # Validation features
        for validation in data.get('validations', []):
            features.append(f"valid:{validation}")
        
        # Callback features
        for callback in data.get('callbacks', []):
            features.append(f"cb:{callback.get('type')}:{callback.get('method')}")
        
        return features
    
    def _detect_file_type(self, file_path: str) -> str:
        """Detect the type of Rails file"""
        
        for file_type, pattern in self.rails_patterns.items():
            if re.search(pattern, file_path):  # Fixed: use search not match
                return file_type
        
        return 'other'
    
    
    def _extract_method_calls(self, impl: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract method calls from implementation data"""
        
        calls = []
        
        # If impl contains the parsed file data
        if 'symbols' in impl:
            for symbol in impl.get('symbols', []):
                if symbol.get('type') in ('method', 'class_method'):
                    for ref in symbol.get('references', []):
                        calls.append({
                            'method': ref.get('to', ''),
                            'receiver': None,
                            'context': f"{impl.get('file_type')}:{symbol.get('name')}"
                        })
        
        return calls
    
    def _get_file_type_counts(self) -> Dict[str, int]:
        """Get counts of different file types in index"""
        
        counts = {}
        for file_type in self.rails_patterns.keys():
            count = self.db.count_files_by_pattern(self.rails_patterns[file_type])
            if count > 0:
                counts[file_type] = count
        
        return counts