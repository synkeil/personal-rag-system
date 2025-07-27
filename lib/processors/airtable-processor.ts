import Airtable from 'airtable';
import dotenv from 'dotenv';
import { ProcessedDocument } from "./code-processor";

dotenv.config({ path: '.env.local' });

export class AirtableProcessor {
  private base: any;

  constructor() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
      throw new Error('Airtable API key and base ID are required');
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
          .filter(([key, value]) => typeof value === 'string' && value.length > 10)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n\n');

        if (content.trim()) {
          documents.push({
            content,
            metadata: {
              filePath: `airtable/${tableName}/${record.id}`,
              fileType: 'airtable',
              projectId,
              sourceType: 'design',
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