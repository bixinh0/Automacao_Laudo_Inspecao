import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "laudos";

let cliente: SupabaseClient | null = null;

/**
 * Cliente do Supabase com a chave secreta. Usado apenas no servidor: o
 * navegador nunca recebe chave nenhuma, só URLs assinadas de upload/download.
 */
export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas variáveis de ambiente.");
  }
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

export function supabaseConfigurado(): boolean {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
}
