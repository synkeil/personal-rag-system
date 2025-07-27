#!/usr/bin/env ts-node

import { Command } from 'commander';
import { supabase } from '../lib/database/supabase';
import { CodeProcessor } from '../lib/processors/code-processor';
import { AirtableProcessor } from '../lib/processors/airtable-processor';
import { EmbeddingService } from '../lib/embeddings/embedding-service';
import { KnowledgeBaseGenerator } from '../lib/knowledge-base/generator';

const program = new Command();

async function ingestProject(options: any) {
  console.log('Starting project ingestion...');
  
  try {
    // Create or get project
    let project;
    const { data: existingProject } = await supabase
      .from('projects')
      .select('*')
      .eq('name', options.name)
      .single();

    if (existingProject) {
      project = existingProject;
      console.log(`Using existing project: ${project.name}`);
    } else {
      const { data: newProject, error } = await supabase
        .from('projects')
        .insert({
          name: options.name,
          description: options.description,
          tech_stack: options.techStack?.split(',') || [],
          repository_url: options.repo
        })
        .select()
        .single();

      if (error) throw error;
      project = newProject;
      console.log(`Created new project: ${project.name}`);
    }

    const processors = [];
    const embeddingService = new EmbeddingService();

    // Process code repository
    if (options.repo || options.path) {
      const codeProcessor = new CodeProcessor();
      const repoPath = options.path || './';
      console.log(`Processing code repository: ${repoPath}`);
      const codeDocuments = await codeProcessor.processCodeRepository(repoPath, project.id);
      processors.push(...codeDocuments);
    }

    // Process Airtable
    if (options.airtable) {
      const airtableProcessor = new AirtableProcessor();
      const tables = options.airtable.split(',');
      
      for (const table of tables) {
        console.log(`Processing Airtable table: ${table}`);
        const airtableDocuments = await airtableProcessor.processTable(table.trim(), project.id);
        processors.push(...airtableDocuments);
      }
    }

    console.log(`Processing ${processors.length} documents...`);

    // Generate embeddings and store in database
    for (let i = 0; i < processors.length; i += 50) { // Process in batches
      const batch = processors.slice(i, i + 50);
      console.log(`Processing batch ${Math.floor(i / 50) + 1}/${Math.ceil(processors.length / 50)}`);

      for (const doc of batch) {
        try {
          const embedding = await embeddingService.generateEmbedding(doc.content);
          
          await supabase
            .from('document_chunks')
            .upsert({
              project_id: doc.metadata.projectId,
              source_type: doc.metadata.sourceType,
              file_path: doc.metadata.filePath,
              chunk_content: doc.content,
              metadata: doc.metadata,
              embedding
            });
        } catch (error) {
          console.error(`Error processing document ${doc.metadata.filePath}:`, error);
        }
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Generate knowledge base files
    console.log('Generating knowledge base files...');
    const kbGenerator = new KnowledgeBaseGenerator();
    await kbGenerator.generateContextFiles(project.id);

    console.log(`✅ Successfully ingested project: ${project.name}`);
    console.log(`📁 Knowledge base files generated in: knowledge-base/contexts/${project.id}`);

  } catch (error) {
    console.error('❌ Error during ingestion:', error);
    process.exit(1);
  }
}

program
  .name('ingest-project')
  .description('Ingest a project into the RAG system')
  .option('-n, --name <name>', 'Project name (required)')
  .option('-d, --description <desc>', 'Project description')
  .option('-p, --path <path>', 'Local repository path')
  .option('-r, --repo <url>', 'Git repository URL')
  .option('-t, --tech-stack <stack>', 'Comma-separated tech stack')
  .option('-a, --airtable <tables>', 'Comma-separated Airtable table names')
  .action(ingestProject);

program.parse();