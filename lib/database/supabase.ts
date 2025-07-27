import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
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
  source_type: 'code' | 'docs' | 'issues' | 'design' | 'config';
  file_path?: string;
  chunk_content: string;
  contextual_content?: string;
  metadata: Record<string, any>;
  embedding?: number[];
  created_at: string;
  updated_at: string;
}