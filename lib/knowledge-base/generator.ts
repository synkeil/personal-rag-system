import * as fs from 'fs/promises';
import * as path from 'path';
import { supabase } from '../database/supabase';
import { EmbeddingService } from '../embeddings/embedding-service';

export class KnowledgeBaseGenerator {
  private embeddingService: EmbeddingService;

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  async generateContextFiles(projectId: string, query?: string): Promise<void> {
    const knowledgeBasePath = path.join(process.cwd(), 'knowledge-base');
    
    // Create project-specific directory
    const projectPath = path.join(knowledgeBasePath, 'contexts', projectId);
    await fs.mkdir(projectPath, { recursive: true });

    if (query) {
      // Generate context for specific query
      await this.generateQueryContext(projectId, query, projectPath);
    } else {
      // Generate general project contexts
      await this.generateProjectOverview(projectId, projectPath);
      await this.generateCodeSummaries(projectId, projectPath);
      await this.generateIssueSummaries(projectId, projectPath);
    }
  }

  private async generateQueryContext(projectId: string, query: string, outputPath: string): Promise<void> {
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);

      // Search for relevant chunks
      const { data: relevantChunks, error } = await supabase
        .rpc('search_similar_chunks', {
          query_embedding: queryEmbedding,
          project_filter: projectId,
          similarity_threshold: 0.6,
          match_count: 20
        });

      if (error) throw error;

      if (!relevantChunks || relevantChunks.length === 0) {
        console.log('No relevant chunks found for query:', query);
        return;
      }

      // Group by source type
      const groupedChunks = relevantChunks.reduce((acc: any, chunk: any) => {
        if (!acc[chunk.source_type]) acc[chunk.source_type] = [];
        acc[chunk.source_type].push(chunk);
        return acc;
      }, {});

      // Generate context file
      const fileName = `query-context-${Date.now()}.md`;
      const filePath = path.join(outputPath, fileName);

      let content = `# Context for: "${query}"\n\n`;
      content += `Generated: ${new Date().toISOString()}\n\n`;
      content += `## Relevant Information\n\n`;

      for (const [sourceType, chunks] of Object.entries(groupedChunks)) {
        content += `### ${sourceType.toUpperCase()} Sources\n\n`;
        
        (chunks as any[]).forEach((chunk, index) => {
          content += `#### Source ${index + 1}: ${chunk.file_path || 'Unknown'}\n`;
          content += `Similarity: ${(chunk.similarity * 100).toFixed(1)}%\n\n`;
          content += '```\n';
          content += chunk.chunk_content;
          content += '\n```\n\n';
        });
      }

      await fs.writeFile(filePath, content, 'utf-8');
      console.log(`Generated query context: ${filePath}`);

      // Store in database for reference
      await supabase
        .from('knowledge_contexts')
        .insert({
          project_id: projectId,
          context_type: 'query',
          title: `Context for: ${query}`,
          content,
          file_path: filePath,
          tags: ['query', 'generated']
        });

    } catch (error) {
      console.error('Error generating query context:', error);
      throw error;
    }
  }

  private async generateProjectOverview(projectId: string, outputPath: string): Promise<void> {
    try {
      // Get project details
      const { data: project } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (!project) throw new Error('Project not found');

      // Get chunk statistics
      const { data: stats } = await supabase
        .from('document_chunks')
        .select('source_type')
        .eq('project_id', projectId);

      const sourceStats = stats?.reduce((acc: any, item: any) => {
        acc[item.source_type] = (acc[item.source_type] || 0) + 1;
        return acc;
      }, {}) || {};

      // Generate overview content
      let content = `# ${project.name} - Project Overview\n\n`;
      content += `**Description**: ${project.description || 'No description provided'}\n\n`;
      content += `**Tech Stack**: ${project.tech_stack?.join(', ') || 'Not specified'}\n\n`;
      content += `**Repository**: ${project.repository_url || 'Not specified'}\n\n`;
      content += `## Knowledge Base Statistics\n\n`;
      
      Object.entries(sourceStats).forEach(([type, count]) => {
        content += `- **${type}**: ${count} documents\n`;
      });

      content += `\n**Last Updated**: ${new Date().toISOString()}\n`;

      const filePath = path.join(outputPath, 'project-overview.md');
      await fs.writeFile(filePath, content, 'utf-8');

      console.log(`Generated project overview: ${filePath}`);
    } catch (error) {
      console.error('Error generating project overview:', error);
      throw error;
    }
  }

  private async generateCodeSummaries(projectId: string, outputPath: string): Promise<void> {
    try {
      // Get code chunks
      const { data: codeChunks } = await supabase
        .from('document_chunks')
        .select('*')
        .eq('project_id', projectId)
        .eq('source_type', 'code')
        .order('file_path');

      if (!codeChunks || codeChunks.length === 0) return;

      // Group by file
      const fileGroups = codeChunks.reduce((acc: any, chunk: any) => {
        const filePath = chunk.file_path?.split('#')[0] || 'unknown';
        if (!acc[filePath]) acc[filePath] = [];
        acc[filePath].push(chunk);
        return acc;
      }, {});

      let content = `# Code Structure Summary\n\n`;
      content += `Generated: ${new Date().toISOString()}\n\n`;

      Object.entries(fileGroups).forEach(([filePath, chunks]) => {
        content += `## ${filePath}\n\n`;
        content += `**Chunks**: ${(chunks as any[]).length}\n\n`;
        
        // Add first chunk as preview
        const firstChunk = (chunks as any[])[0];
        if (firstChunk) {
          content += `### Preview\n\n`;
          content += '```\n';
          content += firstChunk.chunk_content.substring(0, 500);
          if (firstChunk.chunk_content.length > 500) content += '...';
          content += '\n```\n\n';
        }
      });

      const filePath = path.join(outputPath, 'code-summary.md');
      await fs.writeFile(filePath, content, 'utf-8');

      console.log(`Generated code summary: ${filePath}`);
    } catch (error) {
      console.error('Error generating code summaries:', error);
      throw error;
    }
  }

  private async generateIssueSummaries(projectId: string, outputPath: string): Promise<void> {
    try {
      const { data: issueChunks } = await supabase
        .from('document_chunks')
        .select('*')
        .eq('project_id', projectId)
        .eq('source_type', 'issues')
        .order('created_at', { ascending: false });

      if (!issueChunks || issueChunks.length === 0) return;

      let content = `# Issues and Tasks Summary\n\n`;
      content += `Generated: ${new Date().toISOString()}\n\n`;
      content += `**Total Issues**: ${issueChunks.length}\n\n`;

      issueChunks.slice(0, 10).forEach((chunk, index) => {
        content += `## Issue ${index + 1}\n\n`;
        content += `**Path**: ${chunk.file_path}\n\n`;
        content += chunk.chunk_content;
        content += '\n\n---\n\n';
      });

      const filePath = path.join(outputPath, 'issues-summary.md');
      await fs.writeFile(filePath, content, 'utf-8');

      console.log(`Generated issues summary: ${filePath}`);
    } catch (error) {
      console.error('Error generating issue summaries:', error);
      throw error;
    }
  }
}