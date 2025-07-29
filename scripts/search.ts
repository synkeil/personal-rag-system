#!/usr/bin/env ts-node

import { Command } from 'commander';
import { supabase } from '../lib/database/supabase';
import { EmbeddingService } from '../lib/embeddings/embedding-service';
import { KnowledgeBaseGenerator } from '../lib/knowledge-base/generator';

const program = new Command();

async function searchProjects(query: string, options: any) {
  console.log(`Searching for: "${query}"`);
  
  try {
    const embeddingService = new EmbeddingService();
    const queryEmbedding = await embeddingService.generateEmbedding(query);

    // Get project ID if specified
    let projectId;
    if (options.project) {
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('name', options.project)
        .single();
      
      if (!project) {
        console.error(`Project "${options.project}" not found`);
        process.exit(1);
      }
      projectId = project.id;
    }

    // Search similar chunks
    const { data: results, error } = await supabase
      .rpc('search_similar_chunks', {
        query_embedding: queryEmbedding,
        project_filter: projectId,
        similarity_threshold: options.threshold || 0.6,
        match_count: options.limit || 10
      });

    if (error) throw error;

    if (!results || results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`\n📋 Found ${results.length} results:\n`);

    results.forEach((result: any, index: number) => {
      console.log(`${index + 1}. 📄 ${result.file_path || 'Unknown file'}`);
      console.log(`   📊 Similarity: ${(result.similarity * 100).toFixed(1)}%`);
      console.log(`   📂 Type: ${result.source_type}`);
      console.log(`   📝 Content: ${result.chunk_content.substring(0, 150)}...`);
      console.log('');
    });

    // Generate context file for Claude Code
    if (options.generateContext && projectId) {
      console.log('🔄 Generating context file for Claude Code...');
      const kbGenerator = new KnowledgeBaseGenerator();
      await kbGenerator.generateContextFiles(projectId, query, options.outputPath, options.threshold || 0.6);
      const outputLocation = options.outputPath 
        ? `${options.outputPath}/.claude/`
        : 'knowledge-base/contexts/';
      console.log(`✅ Context file generated in ${outputLocation}`);
    }

  } catch (error) {
    console.error('❌ Search error:', error);
    process.exit(1);
  }
}

program
  .name('search')
  .description('Search the RAG knowledge base')
  .argument('<query>', 'Search query')
  .option('-p, --project <name>', 'Limit search to specific project')
  .option('-t, --threshold <number>', 'Similarity threshold (default: 0.6)', parseFloat)
  .option('-l, --limit <number>', 'Maximum results (default: 10)', parseInt)
  .option('-c, --generate-context', 'Generate context file for Claude Code')
  .option('-o, --output-path <path>', 'Custom output path for context files')
  .action(searchProjects);

program.parse();