# Building a Personal RAG System for Claude Code Integration

## Overview: RAG System for Claude Code (No API Required)

Since i'm using Claude Code with Claude Pro, we'll build a **local RAG system** that creates searchable knowledge files that Claude Code can read directly from your project. This approach works by:

1. Building a local vector database and search system
2. Creating markdown "context files" that Claude Code can read
3. Setting up commands that generate relevant context on-demand
4. Using your existing tech stack (Next.js, Supabase, Firebase, Airtable)

**Key Advantage**: Claude Code excels at reading project files, so we'll create a system that generates contextual markdown files that Claude Code can automatically include in its analysis.

## Section 1: Development Environment Setup

### Prerequisites Installation

**Step 1: Install Required Tools**

```bash
# Install Node.js 18+ (if not already installed)
# Download from https://nodejs.org/

# Verify installation
node --version  # Should be 18+
npm --version

# Install pnpm (faster package manager)
npm install -g pnpm

# Install Git (if not already installed)
# Download from https://git-scm.com/

# Install Claude Code (if not already installed)
# Follow: https://docs.anthropic.com/en/docs/claude-code/installation
```

**Step 2: Project Structure Setup**

Create your main project directory:

```bash
# Create main project directory
mkdir personal-rag-system
cd personal-rag-system

# Initialize Node.js project
pnpm init -y

# Create folder structure
mkdir -p {lib,scripts,data,knowledge-base,config,.claude}
mkdir -p lib/{embeddings,retrieval,processors,database}
mkdir -p data/{projects,temp}
mkdir -p knowledge-base/{contexts,summaries,indexes}

# Create essential files
touch .env.local
touch .gitignore
touch README.md
```

Your folder structure should look like:

```
personal-rag-system/
├── .claude/
├── lib/
│   ├── embeddings/
│   ├── retrieval/
│   ├── processors/
│   └── database/
├── scripts/
├── data/
│   ├── projects/
│   └── temp/
├── knowledge-base/
│   ├── contexts/
│   ├── summaries/
│   └── indexes/
├── config/
├── .env.local
├── .gitignore
├── package.json
└── README.md
```

### Environment Configuration

**Step 3: Install Dependencies**

```bash
# Core dependencies
pnpm add @supabase/supabase-js dotenv
pnpm add openai  # For embeddings only
pnpm add langchain @langchain/community @langchain/openai
pnpm add pdf-parse  # For PDF processing
pnpm add simple-git  # For Git repository processing
pnpm add markdown-it  # For markdown processing
pnpm add airtable  # For Airtable integration

# Development dependencies
pnpm add -D typescript @types/node ts-node nodemon
pnpm add -D @types/markdown-it

# Initialize TypeScript
npx tsc --init
```

**Step 4: Environment Variables Setup**

Create `.env.local`:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# OpenAI for Embeddings Only (Required)
OPENAI_API_KEY=your_openai_api_key

# Airtable Integration
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=your_airtable_base_id

# Firebase Configuration (if using)
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY=your_firebase_private_key
FIREBASE_CLIENT_EMAIL=your_firebase_client_email

# Optional: GitHub for repository processing
GITHUB_TOKEN=your_github_personal_access_token
```

**Step 5: Supabase Database Setup**

```bash
# Install Supabase CLI
npm install -g supabase
# on MAC you may have to use homebrew to install it globally
# brew install supabase/tap/supabase

# Login to Supabase (if not already)
supabase login

# Initialize Supabase in your project
supabase init

# Create migration files
supabase migration new setup_vector_database
```

Create the database schema in `supabase/migrations/*_setup_vector_database.sql`:

```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  tech_stack JSONB DEFAULT '[]'::jsonb,
  repository_url TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Document chunks table
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('code', 'docs', 'issues', 'design', 'config')),
  file_path TEXT,
  chunk_content TEXT NOT NULL,
  contextual_content TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_document_chunks_project_id ON document_chunks(project_id);
CREATE INDEX idx_document_chunks_source_type ON document_chunks(source_type);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Knowledge base outputs table (for Claude Code to read)
CREATE TABLE knowledge_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  file_path TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Search function for similarity
CREATE OR REPLACE FUNCTION search_similar_chunks(
  query_embedding VECTOR(1536),
  project_filter UUID DEFAULT NULL,
  similarity_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  source_type TEXT,
  file_path TEXT,
  chunk_content TEXT,
  contextual_content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE SQL
AS $$
  SELECT
    dc.id,
    dc.project_id,
    dc.source_type,
    dc.file_path,
    dc.chunk_content,
    dc.contextual_content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE
    (project_filter IS NULL OR dc.project_id = project_filter)
    AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

Apply the migration:

```bash
# you may need to link your database
# go to your supabase dashboard, create a new project, copy database password

supabase link

# select your project and paste your password when prompted

supabase db push
```

## Section 2: Core Implementation

### Phase 1: Database Connection and Basic Services

**Step 6: Create Database Connection**

Create `lib/database/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Types
export interface Project {
  id: string;
  name: string;
  description?: string;
  tech_stack: string[];
  repository_url?: string;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface DocumentChunk {
  id: string;
  project_id: string;
  source_type: "code" | "docs" | "issues" | "design" | "config";
  file_path?: string;
  chunk_content: string;
  contextual_content?: string;
  metadata: Record<string, any>;
  embedding?: number[];
  created_at: string;
  updated_at: string;
}
```

**Step 7: Create Embedding Service**

Create `lib/embeddings/embedding-service.ts`:

```typescript
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export class EmbeddingService {
  private openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for embeddings");
    }

    this.openai = new OpenAI({ apiKey });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small", // More cost-effective
        input: text.substring(0, 8000), // Truncate to avoid token limits
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw error;
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      // Process in batches of 100 to stay within rate limits
      const batchSize = 100;
      const embeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);

        const response = await this.openai.embeddings.create({
          model: "text-embedding-3-small",
          input: batch.map((text) => text.substring(0, 8000)),
        });

        embeddings.push(...response.data.map((item) => item.embedding));

        // Rate limiting delay
        if (i + batchSize < texts.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      return embeddings;
    } catch (error) {
      console.error("Error generating batch embeddings:", error);
      throw error;
    }
  }
}
```

### Phase 2: Document Processing

**Step 8: Create Document Processors**

Create `lib/processors/code-processor.ts`:

```typescript
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import * as fs from "fs/promises";
import * as path from "path";
import { simpleGit } from "simple-git";

export interface ProcessedDocument {
  content: string;
  metadata: {
    filePath: string;
    fileType: string;
    projectId: string;
    sourceType: "code" | "docs" | "config";
    lastModified?: string;
  };
}

export class CodeProcessor {
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: [
        "\n\nclass ",
        "\n\nfunction ",
        "\n\nexport ",
        "\n\nconst ",
        "\n\nlet ",
        "\n\nvar ",
        "\n\n// ",
        "\n\n/*",
        "\n\n*/",
        "\n\n",
        "\n",
        " ",
        "",
      ],
    });
  }

  async processCodeRepository(repoPath: string, projectId: string): Promise<ProcessedDocument[]> {
    const documents: ProcessedDocument[] = [];
    const git = simpleGit(repoPath);

    try {
      // Get all tracked files
      const files = await git.raw(["ls-files"]);
      const fileList = files.trim().split("\n").filter(Boolean);

      for (const file of fileList) {
        if (this.shouldProcessFile(file)) {
          const fullPath = path.join(repoPath, file);
          const content = await fs.readFile(fullPath, "utf-8");
          const stats = await fs.stat(fullPath);

          // Split large files into chunks
          const chunks = await this.textSplitter.createDocuments([content]);

          for (let i = 0; i < chunks.length; i++) {
            documents.push({
              content: chunks[i].pageContent,
              metadata: {
                filePath: `${file}${chunks.length > 1 ? `#chunk-${i + 1}` : ""}`,
                fileType: path.extname(file),
                projectId,
                sourceType: this.getSourceType(file),
                lastModified: stats.mtime.toISOString(),
              },
            });
          }
        }
      }
    } catch (error) {
      console.error("Error processing repository:", error);
      throw error;
    }

    return documents;
  }

  private shouldProcessFile(filePath: string): boolean {
    const ignoredPatterns = [
      "node_modules/",
      ".git/",
      "dist/",
      "build/",
      ".next/",
      "coverage/",
      "*.log",
      "*.lock",
      "package-lock.json",
      "yarn.lock",
    ];

    const processedExtensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".py",
      ".java",
      ".cpp",
      ".c",
      ".md",
      ".mdx",
      ".txt",
      ".json",
      ".yaml",
      ".yml",
      ".sql",
      ".prisma",
    ];

    // Check if file should be ignored
    if (ignoredPatterns.some((pattern) => filePath.includes(pattern))) {
      return false;
    }

    // Check if file extension should be processed
    const ext = path.extname(filePath);
    return processedExtensions.includes(ext);
  }

  private getSourceType(filePath: string): "code" | "docs" | "config" {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath);

    if ([".md", ".mdx", ".txt"].includes(ext)) {
      return "docs";
    }

    if (
      [".json", ".yaml", ".yml", ".env"].includes(ext) ||
      ["package.json", "tsconfig.json", "next.config.js"].includes(fileName)
    ) {
      return "config";
    }

    return "code";
  }
}
```

**Step 9: Create Airtable Processor**

Create `lib/processors/airtable-processor.ts`:

```typescript
import Airtable from "airtable";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export class AirtableProcessor {
  private base: any;

  constructor() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
      throw new Error("Airtable API key and base ID are required");
    }

    Airtable.configure({ apiKey });
    this.base = Airtable.base(baseId);
  }

  async processTable(tableName: string, projectId: string): Promise<ProcessedDocument[]> {
    const documents: ProcessedDocument[] = [];

    try {
      const records = await this.base(tableName).select().all();

      for (const record of records) {
        const fields = record.fields;

        // Create content from all text fields
        const content = Object.entries(fields)
          .filter(([key, value]) => typeof value === "string" && value.length > 10)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n\n");

        if (content.trim()) {
          documents.push({
            content,
            metadata: {
              filePath: `airtable/${tableName}/${record.id}`,
              fileType: "airtable",
              projectId,
              sourceType: "design",
              recordId: record.id,
              table: tableName,
              fields: Object.keys(fields),
            },
          });
        }
      }
    } catch (error) {
      console.error(`Error processing Airtable table ${tableName}:`, error);
      throw error;
    }

    return documents;
  }
}
```

### Phase 3: Knowledge Base Generator for Claude Code

**Step 10: Create Knowledge Base Generator**

Create `lib/knowledge-base/generator.ts`:

````typescript
import * as fs from "fs/promises";
import * as path from "path";
import { supabase } from "../database/supabase";
import { EmbeddingService } from "../embeddings/embedding-service";

export class KnowledgeBaseGenerator {
  private embeddingService: EmbeddingService;

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  async generateContextFiles(projectId: string, query?: string): Promise<void> {
    const knowledgeBasePath = path.join(process.cwd(), "knowledge-base");

    // Create project-specific directory
    const projectPath = path.join(knowledgeBasePath, "contexts", projectId);
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
      const { data: relevantChunks, error } = await supabase.rpc("search_similar_chunks", {
        query_embedding: queryEmbedding,
        project_filter: projectId,
        similarity_threshold: 0.6,
        match_count: 20,
      });

      if (error) throw error;

      if (!relevantChunks || relevantChunks.length === 0) {
        console.log("No relevant chunks found for query:", query);
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
          content += `#### Source ${index + 1}: ${chunk.file_path || "Unknown"}\n`;
          content += `Similarity: ${(chunk.similarity * 100).toFixed(1)}%\n\n`;
          content += "```\n";
          content += chunk.chunk_content;
          content += "\n```\n\n";
        });
      }

      await fs.writeFile(filePath, content, "utf-8");
      console.log(`Generated query context: ${filePath}`);

      // Store in database for reference
      await supabase.from("knowledge_contexts").insert({
        project_id: projectId,
        context_type: "query",
        title: `Context for: ${query}`,
        content,
        file_path: filePath,
        tags: ["query", "generated"],
      });
    } catch (error) {
      console.error("Error generating query context:", error);
      throw error;
    }
  }

  private async generateProjectOverview(projectId: string, outputPath: string): Promise<void> {
    try {
      // Get project details
      const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();

      if (!project) throw new Error("Project not found");

      // Get chunk statistics
      const { data: stats } = await supabase.from("document_chunks").select("source_type").eq("project_id", projectId);

      const sourceStats =
        stats?.reduce((acc: any, item: any) => {
          acc[item.source_type] = (acc[item.source_type] || 0) + 1;
          return acc;
        }, {}) || {};

      // Generate overview content
      let content = `# ${project.name} - Project Overview\n\n`;
      content += `**Description**: ${project.description || "No description provided"}\n\n`;
      content += `**Tech Stack**: ${project.tech_stack?.join(", ") || "Not specified"}\n\n`;
      content += `**Repository**: ${project.repository_url || "Not specified"}\n\n`;
      content += `## Knowledge Base Statistics\n\n`;

      Object.entries(sourceStats).forEach(([type, count]) => {
        content += `- **${type}**: ${count} documents\n`;
      });

      content += `\n**Last Updated**: ${new Date().toISOString()}\n`;

      const filePath = path.join(outputPath, "project-overview.md");
      await fs.writeFile(filePath, content, "utf-8");

      console.log(`Generated project overview: ${filePath}`);
    } catch (error) {
      console.error("Error generating project overview:", error);
      throw error;
    }
  }

  private async generateCodeSummaries(projectId: string, outputPath: string): Promise<void> {
    try {
      // Get code chunks
      const { data: codeChunks } = await supabase
        .from("document_chunks")
        .select("*")
        .eq("project_id", projectId)
        .eq("source_type", "code")
        .order("file_path");

      if (!codeChunks || codeChunks.length === 0) return;

      // Group by file
      const fileGroups = codeChunks.reduce((acc: any, chunk: any) => {
        const filePath = chunk.file_path?.split("#")[0] || "unknown";
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
          content += "```\n";
          content += firstChunk.chunk_content.substring(0, 500);
          if (firstChunk.chunk_content.length > 500) content += "...";
          content += "\n```\n\n";
        }
      });

      const filePath = path.join(outputPath, "code-summary.md");
      await fs.writeFile(filePath, content, "utf-8");

      console.log(`Generated code summary: ${filePath}`);
    } catch (error) {
      console.error("Error generating code summaries:", error);
      throw error;
    }
  }

  private async generateIssueSummaries(projectId: string, outputPath: string): Promise<void> {
    try {
      const { data: issueChunks } = await supabase
        .from("document_chunks")
        .select("*")
        .eq("project_id", projectId)
        .eq("source_type", "issues")
        .order("created_at", { ascending: false });

      if (!issueChunks || issueChunks.length === 0) return;

      let content = `# Issues and Tasks Summary\n\n`;
      content += `Generated: ${new Date().toISOString()}\n\n`;
      content += `**Total Issues**: ${issueChunks.length}\n\n`;

      issueChunks.slice(0, 10).forEach((chunk, index) => {
        content += `## Issue ${index + 1}\n\n`;
        content += `**Path**: ${chunk.file_path}\n\n`;
        content += chunk.chunk_content;
        content += "\n\n---\n\n";
      });

      const filePath = path.join(outputPath, "issues-summary.md");
      await fs.writeFile(filePath, content, "utf-8");

      console.log(`Generated issues summary: ${filePath}`);
    } catch (error) {
      console.error("Error generating issue summaries:", error);
      throw error;
    }
  }
}
````

### Phase 4: CLI Scripts and Commands

**Step 11: Create CLI Scripts**

Create `scripts/ingest-project.ts`:

```typescript
#!/usr/bin/env ts-node

import { Command } from "commander";
import { supabase } from "../lib/database/supabase";
import { CodeProcessor } from "../lib/processors/code-processor";
import { AirtableProcessor } from "../lib/processors/airtable-processor";
import { EmbeddingService } from "../lib/embeddings/embedding-service";
import { KnowledgeBaseGenerator } from "../lib/knowledge-base/generator";

const program = new Command();

async function ingestProject(options: any) {
  console.log("Starting project ingestion...");

  try {
    // Create or get project
    let project;
    const { data: existingProject } = await supabase.from("projects").select("*").eq("name", options.name).single();

    if (existingProject) {
      project = existingProject;
      console.log(`Using existing project: ${project.name}`);
    } else {
      const { data: newProject, error } = await supabase
        .from("projects")
        .insert({
          name: options.name,
          description: options.description,
          tech_stack: options.techStack?.split(",") || [],
          repository_url: options.repo,
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
      const repoPath = options.path || "./";
      console.log(`Processing code repository: ${repoPath}`);
      const codeDocuments = await codeProcessor.processCodeRepository(repoPath, project.id);
      processors.push(...codeDocuments);
    }

    // Process Airtable
    if (options.airtable) {
      const airtableProcessor = new AirtableProcessor();
      const tables = options.airtable.split(",");

      for (const table of tables) {
        console.log(`Processing Airtable table: ${table}`);
        const airtableDocuments = await airtableProcessor.processTable(table.trim(), project.id);
        processors.push(...airtableDocuments);
      }
    }

    console.log(`Processing ${processors.length} documents...`);

    // Generate embeddings and store in database
    for (let i = 0; i < processors.length; i += 50) {
      // Process in batches
      const batch = processors.slice(i, i + 50);
      console.log(`Processing batch ${Math.floor(i / 50) + 1}/${Math.ceil(processors.length / 50)}`);

      for (const doc of batch) {
        try {
          const embedding = await embeddingService.generateEmbedding(doc.content);

          await supabase.from("document_chunks").upsert({
            project_id: doc.metadata.projectId,
            source_type: doc.metadata.sourceType,
            file_path: doc.metadata.filePath,
            chunk_content: doc.content,
            metadata: doc.metadata,
            embedding,
          });
        } catch (error) {
          console.error(`Error processing document ${doc.metadata.filePath}:`, error);
        }
      }

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Generate knowledge base files
    console.log("Generating knowledge base files...");
    const kbGenerator = new KnowledgeBaseGenerator();
    await kbGenerator.generateContextFiles(project.id);

    console.log(`✅ Successfully ingested project: ${project.name}`);
    console.log(`📁 Knowledge base files generated in: knowledge-base/contexts/${project.id}`);
  } catch (error) {
    console.error("❌ Error during ingestion:", error);
    process.exit(1);
  }
}

program
  .name("ingest-project")
  .description("Ingest a project into the RAG system")
  .option("-n, --name <name>", "Project name (required)")
  .option("-d, --description <desc>", "Project description")
  .option("-p, --path <path>", "Local repository path")
  .option("-r, --repo <url>", "Git repository URL")
  .option("-t, --tech-stack <stack>", "Comma-separated tech stack")
  .option("-a, --airtable <tables>", "Comma-separated Airtable table names")
  .action(ingestProject);

program.parse();
```

**Step 12: Create Search Script**

Create `scripts/search.ts`:

```typescript
#!/usr/bin/env ts-node

import { Command } from "commander";
import { supabase } from "../lib/database/supabase";
import { EmbeddingService } from "../lib/embeddings/embedding-service";
import { KnowledgeBaseGenerator } from "../lib/knowledge-base/generator";

const program = new Command();

async function searchProjects(query: string, options: any) {
  console.log(`Searching for: "${query}"`);

  try {
    const embeddingService = new EmbeddingService();
    const queryEmbedding = await embeddingService.generateEmbedding(query);

    // Get project ID if specified
    let projectId;
    if (options.project) {
      const { data: project } = await supabase.from("projects").select("id").eq("name", options.project).single();

      if (!project) {
        console.error(`Project "${options.project}" not found`);
        process.exit(1);
      }
      projectId = project.id;
    }

    // Search similar chunks
    const { data: results, error } = await supabase.rpc("search_similar_chunks", {
      query_embedding: queryEmbedding,
      project_filter: projectId,
      similarity_threshold: options.threshold || 0.6,
      match_count: options.limit || 10,
    });

    if (error) throw error;

    if (!results || results.length === 0) {
      console.log("No results found.");
      return;
    }

    console.log(`\n📋 Found ${results.length} results:\n`);

    results.forEach((result: any, index: number) => {
      console.log(`${index + 1}. 📄 ${result.file_path || "Unknown file"}`);
      console.log(`   📊 Similarity: ${(result.similarity * 100).toFixed(1)}%`);
      console.log(`   📂 Type: ${result.source_type}`);
      console.log(`   📝 Content: ${result.chunk_content.substring(0, 150)}...`);
      console.log("");
    });

    // Generate context file for Claude Code
    if (options.generateContext && projectId) {
      console.log("🔄 Generating context file for Claude Code...");
      const kbGenerator = new KnowledgeBaseGenerator();
      await kbGenerator.generateContextFiles(projectId, query);
      console.log("✅ Context file generated in knowledge-base/contexts/");
    }
  } catch (error) {
    console.error("❌ Search error:", error);
    process.exit(1);
  }
}

program
  .name("search")
  .description("Search the RAG knowledge base")
  .argument("<query>", "Search query")
  .option("-p, --project <name>", "Limit search to specific project")
  .option("-t, --threshold <number>", "Similarity threshold (default: 0.6)", parseFloat)
  .option("-l, --limit <number>", "Maximum results (default: 10)", parseInt)
  .option("-c, --generate-context", "Generate context file for Claude Code")
  .action(searchProjects);

program.parse();
```

**Step 13: Add Package Scripts**

Update your `package.json`:

```json
{
  "name": "personal-rag-system",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "ingest": "ts-node scripts/ingest-project.ts",
    "search": "ts-node scripts/search.ts",
    "generate-context": "ts-node scripts/generate-context.ts",
    "dev": "nodemon --exec ts-node scripts/search.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.38.0",
    "airtable": "^0.12.2",
    "commander": "^11.1.0",
    "dotenv": "^16.3.1",
    "langchain": "^0.0.208",
    "@langchain/community": "^0.0.28",
    "@langchain/openai": "^0.0.14",
    "markdown-it": "^13.0.2",
    "openai": "^4.20.1",
    "pdf-parse": "^1.1.1",
    "simple-git": "^3.20.0"
  },
  "devDependencies": {
    "@types/markdown-it": "^13.0.7",
    "@types/node": "^20.8.10",
    "nodemon": "^3.0.1",
    "ts-node": "^10.9.1",
    "typescript": "^5.2.2"
  }
}
```

### Phase 5: Claude Code Integration

**Step 14: Configure Claude Code**

Create `.claude/CLAUDE.md`:

```markdown
# Personal RAG System

This project implements a personal Retrieval-Augmented Generation (RAG) system optimized for developer workflows with Claude Code integration.

## System Overview

The RAG system creates searchable knowledge bases from:

- Code repositories (local files)
- Airtable design documents
- Firebase configurations
- Project documentation

## Key Features

- **Local Vector Database**: Uses Supabase with pgvector for semantic search
- **Knowledge Base Generation**: Creates markdown context files that Claude Code can read
- **Multi-Project Support**: Manages multiple projects with isolated knowledge bases
- **Real-time Context**: Generates relevant context files on-demand

## Architecture
```

Data Sources → Processing → Vector Storage → Context Generation → Claude Code ↓ ↓ ↓ ↓ ↓

- Code files - Chunking - Embeddings - Markdown files - Enhanced AI
- Airtable - Metadata - Similarity - Search results - Project context
- Docs - Cleaning - Indexing - Summaries - Code awareness

````

## Usage with Claude Code

### 1. Ingest Project Data
```bash
npm run ingest -- --name "My Project" --path ./my-project --description "Next.js app"
````

### 2. Search for Context

```bash
npm run search "authentication implementation" --project "My Project" --generate-context
```

### 3. Use Generated Context

Claude Code will automatically read the generated context files from `knowledge-base/contexts/` when analyzing your project.

## Available Commands

- `npm run ingest`: Add project data to the knowledge base
- `npm run search`: Search and generate context files
- `npm run generate-context`: Create summary context files

## Context Files for Claude Code

The system generates several types of context files:

### Project Overview (`project-overview.md`)

High-level project information, tech stack, and statistics.

### Code Summary (`code-summary.md`)

Structure and organization of the codebase.

### Query Context (`query-context-*.md`)

Specific context generated for search queries.

### Issues Summary (`issues-summary.md`)

Recent issues, tasks, and project discussions.

## Integration Points

- **Supabase**: Vector database and metadata storage
- **OpenAI**: Embedding generation for semantic search
- **Airtable**: Design and planning document integration
- **Git**: Automatic code repository processing

## File Structure

```
knowledge-base/
├── contexts/
│   └── [project-id]/
│       ├── project-overview.md
│       ├── code-summary.md
│       ├── issues-summary.md
│       └── query-context-*.md
├── summaries/
└── indexes/
```

When you need project context, search for relevant information and the system will generate markdown files that I can read and use to provide better assistance.

**Step 15: Create Claude Code Commands**

Create `.claude/commands/search-knowledge.md`:

```markdown
# Search Knowledge Base

Search the project's RAG knowledge base and generate context files for the current query.

**Usage**: `search-knowledge [query]`

## What this does:

1. Searches the vector database for content related to your query
2. Generates a context file with relevant code, documentation, and project information
3. Creates a markdown file that Claude Code can read for enhanced context

## Examples:

- `search-knowledge authentication flow`
- `search-knowledge database schema`
- `search-knowledge API endpoints`
- `search-knowledge deployment configuration`

## Output:

The command generates a timestamped context file in `knowledge-base/contexts/[project]/` that contains:

- Relevant code snippets with file paths
- Related documentation sections
- Issue/task references
- Similarity scores for each result

After running this command, Claude Code will have access to all the relevant project context needed to provide accurate, project-specific assistance.
```

Create `.claude/commands/generate-overview.md`:

```markdown
# Generate Project Overview

Generate comprehensive project overview and summary files for Claude Code to reference.

**Usage**: `generate-overview [project-name]`

## What this does:

1. Creates a complete project overview with:

   - Tech stack and architecture
   - Code structure summary
   - Recent issues and tasks
   - Project statistics

2. Updates the knowledge base with current project state

3. Generates multiple context files:
   - `project-overview.md`: High-level project information
   - `code-summary.md`: Code structure and organization
   - `issues-summary.md`: Current tasks and discussions

## Usage with Claude Code:

After running this command, Claude Code will have comprehensive context about your project structure, making it much more effective at:

- Understanding your codebase architecture
- Suggesting appropriate solutions
- Maintaining consistency with existing patterns
- Referencing relevant project history

Run this command whenever you start working on a project or when significant changes have been made.
```

## Section 3: Real-World Usage Guide

### Folder Structure Setup

Here's how to organize your workspace:

```
your-development-workspace/
├── personal-rag-system/          # RAG processing system (set up once)
│   ├── lib/
│   ├── scripts/
│   ├── .env.local
│   └── package.json
│
├── my-ecommerce-app/             # Your actual Next.js project
│   ├── .claude/                  # Claude Code reads from here
│   │   ├── CLAUDE.md
│   │   └── contexts/             # Generated context files appear here
│   ├── src/
│   ├── components/
│   └── package.json
│
└── my-api-service/               # Another project
    ├── .claude/
    │   └── contexts/
    ├── routes/
    └── package.json
```

### Getting Started

**Step 16: Initial Workspace Setup**

```bash
# 1. Create your development workspace
mkdir your-development-workspace
cd your-development-workspace

# 2. Set up the RAG system
git clone <your-rag-repo> personal-rag-system
# OR create it from scratch:
mkdir personal-rag-system
cd personal-rag-system
# ... follow steps 1-15 from above

# 3. Install dependencies and configure
cd personal-rag-system
pnpm install
# Configure .env.local with your API keys
supabase db push
```

**Step 17: Ingest Your First Project**

```bash
# From the RAG system directory
cd personal-rag-system

# Ingest your Next.js project (located as sibling folder)
npm run ingest -- \
  --name "My Ecommerce App" \
  --description "Next.js e-commerce with Supabase" \
  --path ../my-ecommerce-app \
  --tech-stack "Next.js,TypeScript,Supabase,Tailwind" \
  --airtable "Features,User Stories"

# This processes the code but doesn't generate context files yet
```

**Step 18: Working in Your Actual Project**

Now you can work in your actual project and generate context on-demand:

```bash
# 1. Go to your actual project
cd ../my-ecommerce-app

# 2. Search for context from the RAG system
../personal-rag-system/npm run search "user authentication flow" \
  --project "My Ecommerce App" \
  --generate-context \
  --target-path .

# This creates: .claude/contexts/query-context-[timestamp].md
```

**Step 19: Using with Claude Code**

1. **Open your actual project** in VS Code/Cursor:

   ```bash
   cd my-ecommerce-app
   code .  # or cursor .
   ```

2. **Generate context for your current task**:

   ```bash
   # From your project root
   ../personal-rag-system/npm run search "authentication patterns" \
     --project "My Ecommerce App" \
     --generate-context \
     --target-path .
   ```

3. **Ask Claude Code** (it automatically reads `.claude/contexts/`):

   ```
   "Help me implement OAuth authentication. I want to follow the existing patterns in this codebase."
   ```

4. **Claude Code will respond with context** from your actual project files and knowledge base!

### Advanced Workflow: Project-Specific Scripts

**Step 20: Add RAG Commands to Your Project**

In your actual project's `package.json`, add convenience scripts:

```json
{
  "name": "my-ecommerce-app",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "rag:search": "../personal-rag-system/npm run search",
    "rag:context": "../personal-rag-system/npm run search --generate-context --target-path .",
    "rag:update": "../personal-rag-system/npm run ingest -- --name 'My Ecommerce App' --path ."
  }
}
```

Now from your project directory:

```bash
# Update the knowledge base with recent changes
npm run rag:update

# Search and generate context for Claude Code
npm run rag:context "payment processing" --project "My Ecommerce App"

# Just search without generating files
npm run rag:search "database schema" --project "My Ecommerce App"
```

### Real Example Workflow

**Scenario**: You're working on adding a new payment feature

```bash
# 1. You're in your project
cd my-ecommerce-app

# 2. Generate context about existing payment code
npm run rag:context "payment stripe integration" --project "My Ecommerce App"

# 3. Ask Claude Code
# "Show me how to add Apple Pay to the existing Stripe integration"

# 4. Claude Code responds with:
# - Your existing Stripe setup code
# - Related payment components
# - Database schema for payments
# - Relevant Airtable design specs

# 5. Implement the feature with Claude Code's help

# 6. Update the knowledge base with new code
npm run rag:update
```

### Context File Examples

After running the search, you'll see files like:

```
my-ecommerce-app/
├── .claude/
│   ├── CLAUDE.md
│   └── contexts/
│       ├── query-context-1704123456789.md    # "payment processing"
│       ├── query-context-1704123567890.md    # "authentication flow"
│       └── project-overview.md
```

**Example generated context file**:

````markdown
# Context for: "payment processing"

Generated: 2024-01-01T12:00:00.000Z

## Relevant Information

### CODE Sources

#### Source 1: lib/stripe/payment-handler.ts

Similarity: 94.2%

```typescript
export async function processPayment(amount: number, customerId: string) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount * 100, // Convert to cents
    currency: "usd",
    customer: customerId,
    metadata: { source: "ecommerce-app" },
  });
  return paymentIntent;
}
```

#### Source 2: components/checkout/PaymentForm.tsx

Similarity: 87.1%

tsx

```tsx
export function PaymentForm({ onSuccess }: PaymentFormProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  // ... existing payment form logic
}
```

### DESIGN Sources

#### Source 1: airtable/Features/Payment Integration

Similarity: 82.3%

Feature: Enhanced Payment Processing Requirements: Support for Stripe, Apple Pay, and Google Pay Priority: High Status: In Progress
````

This context makes Claude Code incredibly effective at understanding your specific codebase and providing relevant suggestions!

### Advanced Usage

**Step 20: Automated Workflows**

Create `scripts/daily-update.sh`:

```bash
#!/bin/bash

# Daily knowledge base update script
echo "🔄 Updating knowledge base..."

# Get list of all projects
PROJECTS=$(npx ts-node -e "
import { supabase } from './lib/database/supabase';
supabase.from('projects').select('name').then(data => {
  data.data?.forEach(p => console.log(p.name));
});
")

# Re-ingest each project to catch new changes
for project in $PROJECTS; do
  echo "Updating project: $project"
  npm run ingest -- --name "$project" --path "./"
done

echo "✅ Knowledge base updated!"
```

**Step 21: Integration with Development Workflow**

Add to your project's `package.json`:

```json
{
  "scripts": {
    "rag:update": "cd ../personal-rag-system && npm run ingest -- --name 'Current Project' --path ../current-project",
    "rag:search": "cd ../personal-rag-system && npm run search",
    "rag:context": "cd ../personal-rag-system && npm run search --generate-context --project 'Current Project'"
  }
}
```

Now you can run from any project:

```bash
# Update the knowledge base with current project
npm run rag:update

# Search for specific context
npm run rag:search "component state management"

# Generate context for Claude Code
npm run rag:context
```

This implementation creates a powerful, local RAG system that works seamlessly with Claude Code without requiring API access. The system generates markdown context files that Claude Code can read to provide much more accurate, project-specific assistance.
