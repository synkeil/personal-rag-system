import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import * as fs from 'fs/promises';
import * as path from 'path';
import { simpleGit } from 'simple-git';

export interface ProcessedDocument {
  content: string;
  metadata: {
    filePath: string;
    fileType: string;
    projectId: string;
    sourceType: 'code' | 'docs' | 'config' | 'design';
    lastModified?: string;
    recordId?: string;
    table?: string;
    fields?: string[]
  };
}

export class CodeProcessor {
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: [
        '\n\nclass ', '\n\nfunction ', '\n\nexport ',
        '\n\nconst ', '\n\nlet ', '\n\nvar ',
        '\n\n// ', '\n\n/*', '\n\n*/',
        '\n\n', '\n', ' ', ''
      ],
    });
  }

  async processCodeRepository(repoPath: string, projectId: string): Promise<ProcessedDocument[]> {
    const documents: ProcessedDocument[] = [];
    const git = simpleGit(repoPath);
    
    try {
      // Get all tracked files
      const files = await git.raw(['ls-files']);
      const fileList = files.trim().split('\n').filter(Boolean);

      for (const file of fileList) {
        if (this.shouldProcessFile(file)) {
          const fullPath = path.join(repoPath, file);
          const content = await fs.readFile(fullPath, 'utf-8');
          const stats = await fs.stat(fullPath);

          // Split large files into chunks
          const chunks = await this.textSplitter.createDocuments([content]);

          for (let i = 0; i < chunks.length; i++) {
            documents.push({
              content: chunks[i].pageContent,
              metadata: {
                filePath: `${file}${chunks.length > 1 ? `#chunk-${i + 1}` : ''}`,
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
      console.error('Error processing repository:', error);
      throw error;
    }

    return documents;
  }

  private shouldProcessFile(filePath: string): boolean {
    const ignoredPatterns = [
      'node_modules/',
      '.git/',
      'dist/',
      'build/',
      '.next/',
      'coverage/',
      '*.log',
      '*.lock',
      'package-lock.json',
      'yarn.lock',
    ];

    const processedExtensions = [
      '.ts', '.tsx', '.js', '.jsx',
      '.py', '.java', '.cpp', '.c',
      '.md', '.mdx', '.txt',
      '.json', '.yaml', '.yml',
      '.sql', '.prisma',
    ];

    // Check if file should be ignored
    if (ignoredPatterns.some(pattern => filePath.includes(pattern))) {
      return false;
    }

    // Check if file extension should be processed
    const ext = path.extname(filePath);
    return processedExtensions.includes(ext);
  }

  private getSourceType(filePath: string): 'code' | 'docs' | 'config' | 'design' {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath);

    if (['.md', '.mdx', '.txt'].includes(ext)) {
      return 'docs';
    }

    if (['.json', '.yaml', '.yml', '.env'].includes(ext) || 
        ['package.json', 'tsconfig.json', 'next.config.js'].includes(fileName)) {
      return 'config';
    }

    return 'code';
  }
}