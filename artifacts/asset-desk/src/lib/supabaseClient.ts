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

// Production URL of the deployed portal. Password-reset / recovery emails must
// always point users here — NEVER at an admin's local dev origin.
const PRODUCTION_SITE_URL = "https://it-asset-hub-a7rf.onrender.com";

// Resolve the public site URL used for auth redirect links (e.g. password
// reset). Admins frequently trigger resets from a local dev build, where
// `window.location.origin` is `http://localhost:3000` — sending that link to an
// end user produces an unreachable "localhost refused to connect" page. We
// therefore prefer an explicit override, then the live origin, and fall back to
// the known production URL whenever we're on localhost/127.0.0.1.
export function getSiteUrl(): string {
  const override = sanitiseEnvValue(import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined);
  if (override) return override.replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(origin)) {
      return origin.replace(/\/+$/, "");
    }
  }
  return PRODUCTION_SITE_URL;
}

export const supabase = createClient(
  supabaseUrl  ?? 'https://placeholder.supabase.co',
  supabaseAnon ?? 'placeholder-anon-key',
);
