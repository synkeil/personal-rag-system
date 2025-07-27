# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal RAG (Retrieval-Augmented Generation) system built with TypeScript, LangChain, and Supabase. The system ingests project documentation, code, and other knowledge sources to create contextual embeddings that can be retrieved for AI-powered development assistance.

## Core Architecture

- **Database Layer**: Supabase with pgvector for vector storage and similarity search
- **Embeddings**: OpenAI embeddings (1536 dimensions) for document chunks
- **Processing Pipeline**: LangChain-based document processing and chunking
- **Knowledge Organization**: Projects contain categorized document chunks (code, docs, issues, design, config)

### Key Data Models

- `projects`: Project metadata and settings
- `document_chunks`: Vectorized content chunks with embeddings and metadata
- `knowledge_contexts`: Generated context files for Claude Code consumption

## Development Commands

**Setup**:
```bash
pnpm install       # Install dependencies
supabase start     # Start local Supabase stack (required for all operations)
```

**Core Operations**:
```bash
pnpm run ingest    # Ingest project code/docs into vector database
pnpm run search    # Interactive search interface
pnpm run dev       # Development mode (nodemon + search interface)
```

**Database Management**:
```bash
supabase stop      # Stop local Supabase stack
supabase reset     # Reset database and run migrations
supabase status    # Check service status
```

**TypeScript Development**:
```bash
npx tsc            # Compile TypeScript
npx ts-node <file> # Run TypeScript file directly
```

## Implementation Status

**Fully Implemented**:
- `lib/database/` - Supabase client, TypeScript interfaces for Project and DocumentChunk models
- `lib/embeddings/` - OpenAI embedding service with batch processing and rate limiting
- `lib/processors/` - Code processor (Git repos) and Airtable processor for data ingestion
- `lib/knowledge-base/` - Context file generator for Claude Code integration
- `scripts/ingest-project.ts` - CLI tool for project ingestion with Commander.js
- `scripts/search.ts` - Interactive search interface with context generation

**Not Implemented**:
- `lib/retrieval/` - Directory exists but empty (missing advanced retrieval strategies)
- `scripts/generate-context.ts` - Referenced in package.json but file doesn't exist

## Processing Pipeline

1. **Ingestion**: Use `pnpm run ingest` to process code repositories or Airtable data
   - Code files are chunked using LangChain RecursiveCharacterTextSplitter (1000 chars, 200 overlap)
   - Smart separators detect code structures (classes, functions, exports)
   - Files categorized by source type: code, docs, config, design
   - Supports: .ts, .tsx, .js, .jsx, .py, .java, .cpp, .c, .md, .json, .yaml, .sql, .prisma

2. **Embedding**: OpenAI text-embedding-3-small model generates 1536-dim vectors
   - Batch processing (100 items) with rate limiting
   - 8000 character truncation to avoid token limits

3. **Storage**: Supabase with pgvector extension
   - `search_similar_chunks()` function performs cosine similarity search
   - Configurable similarity thresholds and result limits

4. **Retrieval**: Context generation creates Claude Code-compatible markdown files
   - Query-specific context with similarity search
   - Project overviews with statistics
   - Code structure summaries grouped by file

## Environment Setup

Required environment variables (create `.env.local`):
- `OPENAI_API_KEY` - OpenAI API key for embeddings
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key

## Key Technical Details

**Vector Database Schema**:
- `projects` table: Project metadata with JSONB tech_stack and settings
- `document_chunks` table: Content chunks with 1536-dim vector embeddings and JSONB metadata
- `knowledge_contexts` table: Generated context files for Claude Code consumption
- `search_similar_chunks()` function: Cosine similarity search with configurable thresholds

**Code Architecture**:
- Uses Commander.js for CLI interfaces
- LangChain for document processing and text splitting
- Simple-git for repository traversal
- Airtable integration for external data sources
- Markdown-it for content processing