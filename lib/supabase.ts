import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "laudos";

let cliente: SupabaseClient | null = null;

/**
 * Aceita a URL como vier do painel ("https://xxxx.supabase.co",
 * ".../rest/v1/", com barra no fim ou espaços) e usa só o domínio,
 * que é o que o cliente do Supabase espera.
 */
export function urlSupabase(): string {
  const bruta = (process.env.SUPABASE_URL ?? "").trim();
  if (!bruta) return "";
  try {
    return new URL(/^https?:\/\//.test(bruta) ? bruta : `https://${bruta}`).origin;
  } catch {
    return bruta;
  }
}

function chaveSupabase(): string {
  return (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

/**
 * Cliente do Supabase com a chave secreta. Usado apenas no servidor: o
 * navegador nunca recebe chave nenhuma, só URLs assinadas de upload/download.
 */
export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = urlSupabase();
  const chave = chaveSupabase();
  if (!url || !chave) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas variáveis de ambiente.");
  }
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

export function supabaseConfigurado(): boolean {
  return Boolean(urlSupabase() && chaveSupabase());
}
