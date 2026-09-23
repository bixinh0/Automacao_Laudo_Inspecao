/**
 * Acesso por senha única (variável SENHA_ACESSO). Depois de digitada, o
 * navegador guarda um cookie por 180 dias. Trocar a senha na Vercel invalida
 * todos os cookies, pois o valor guardado é derivado dela.
 *
 * Usa só Web Crypto para funcionar tanto no proxy quanto nas rotas.
 */

export const COOKIE_ACESSO = "laudo_acesso";
export const DURACAO_ACESSO_S = 180 * 24 * 60 * 60;

export function senhaAcesso(): string {
  return (process.env.SENHA_ACESSO ?? "").trim();
}

export async function tokenAcesso(senha: string): Promise<string> {
  const dados = new TextEncoder().encode(`laudo-inspecao:acesso:v1:${senha}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", dados));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante, para não vazar o valor pelo tempo de resposta. */
export function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export async function acessoValido(cookie: string | undefined): Promise<boolean> {
  const senha = senhaAcesso();
  if (!senha || !cookie) return false;
  return iguais(cookie, await tokenAcesso(senha));
}

/** Aceita só caminhos internos, para o redirecionamento pós-login não levar a outro site. */
export function destinoSeguro(destino: unknown): string {
  const d = typeof destino === "string" ? destino : "";
  return d.startsWith("/") && !d.startsWith("//") && !d.startsWith("/\\") ? d : "/";
}
