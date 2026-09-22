// Supabase client for 49S Predictor.
//
// Only the publishable (anon) key is used here — it is safe to ship to the
// browser. All privileged database access remains server-side (DATABASE_URL,
// service-role keys) and is never referenced in frontend code.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jhiormooyjiuclwpfwbr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_HLvQ8TbRuEc7MIEm4TlJuA_lHfy7AgA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});