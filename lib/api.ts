import "server-only";
import { NextResponse } from "next/server";
import { ErroLaudo } from "./laudos";

export function erro(mensagem: string, status = 400) {
  return NextResponse.json({ erro: mensagem }, { status });
}

/**
 * Traduz as falhas de configuração mais comuns (variáveis de ambiente,
 * migration não executada, chave errada, bucket ausente) em mensagens que
 * dizem o que corrigir. Devolve null para erros desconhecidos.
 */
export function explicarErroConfiguracao(e: unknown): string | null {
  const x = (e ?? {}) as { message?: string; code?: string; status?: number; statusCode?: string };
  const msg = `${x.message ?? ""} ${x.code ?? ""}`;
  if (/Configure SUPABASE_URL/.test(msg)) {
    return "Servidor sem configuração: defina SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel e faça Redeploy.";
  }
  if (/PGRST205|42P01|schema cache|does not exist/i.test(msg)) {
    return "Tabelas não encontradas no Supabase: rode o arquivo supabase/migrations/0001_estrutura_inicial.sql no SQL Editor.";
  }
  if (/Invalid API key|invalid.*(jwt|key)|Unauthorized|No API key/i.test(msg) || x.status === 401) {
    return "Chave do Supabase inválida: confira SUPABASE_SECRET_KEY (chave secreta sb_secret_… ou service_role) na Vercel e faça Redeploy.";
  }
  if (/Bucket not found/i.test(msg)) {
    return 'Bucket "laudos" não encontrado no Supabase Storage: rode a migration no SQL Editor.';
  }
  if (/fetch failed|ENOTFOUND|getaddrinfo|Invalid URL/i.test(msg)) {
    return "Não foi possível conectar ao Supabase: confira SUPABASE_URL (https://xxxx.supabase.co) na Vercel e faça Redeploy.";
  }
  return null;
}

/** Converte exceções em resposta JSON; detalhes internos vão para o log da Vercel. */
export function tratarErro(e: unknown) {
  if (e instanceof ErroLaudo) return erro(e.message, e.status);
  console.error(e);
  const explicacao = explicarErroConfiguracao(e);
  if (explicacao) return erro(explicacao, 500);
  const detalhe = (e as { message?: string })?.message;
  return erro(`Erro inesperado no servidor${detalhe ? ` (${detalhe.slice(0, 160)})` : ""}. Tente novamente em instantes.`, 500);
}

export async function lerJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const corpo = await req.json();
    return corpo && typeof corpo === "object" ? corpo : {};
  } catch {
    return {};
  }
}
