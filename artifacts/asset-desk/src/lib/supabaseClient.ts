import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// RLS (Row Level Security) policies MUST be configured in the Supabase dashboard.
// This client uses the anon key only — the service role key must NEVER be placed here.
export const supabaseConfigured = !!supabaseUrl && !!supabaseAnon;

export const supabase = createClient(
  supabaseUrl  ?? 'https://placeholder.supabase.co',
  supabaseAnon ?? 'placeholder-anon-key',
);
