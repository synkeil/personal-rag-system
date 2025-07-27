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
