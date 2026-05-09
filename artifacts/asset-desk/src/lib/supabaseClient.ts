import { createClient } from '@supabase/supabase-js';

// Strip any non-ISO-8859-1 / invisible Unicode characters that sneak in when
// values are copy-pasted from rich-text editors into Render (or similar) env
// dashboards.  Those characters cause fetch() to throw
// "String contains non ISO-8859-1 code point" when the value is used as a
// header (apikey / Authorization).
function sanitiseEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Keep only printable ASCII (0x20–0x7E) plus the Base64 chars used in JWTs
  // (letters, digits, +, /, =, .) — this covers every valid Supabase key/URL.
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[^\x20-\x7E]/g, "").trim() || undefined;
}

const supabaseUrl  = sanitiseEnvValue(import.meta.env.VITE_SUPABASE_URL  as string | undefined);
const supabaseAnon = sanitiseEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

// RLS (Row Level Security) policies MUST be configured in the Supabase dashboard.
// This client uses the anon key only — the service role key must NEVER be placed here.
export const supabaseConfigured = !!supabaseUrl && !!supabaseAnon;

export const supabase = createClient(
  supabaseUrl  ?? 'https://placeholder.supabase.co',
  supabaseAnon ?? 'placeholder-anon-key',
);
