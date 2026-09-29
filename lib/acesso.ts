/** Utilitários de segurança sem dependência do servidor (usados também no proxy). */

/** Comparação em tempo constante, para não vazar o valor pelo tempo de resposta. */
export function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/** Aceita só caminhos internos, para o redirecionamento pós-login não levar a outro site. */
export function destinoSeguro(destino: unknown): string {
  const d = typeof destino === "string" ? destino : "";
  return d.startsWith("/") && !d.startsWith("//") && !d.startsWith("/\\") ? d : "/";
}

/** IP de quem fez a requisição (a Vercel informa em x-forwarded-for). */
export function ipDaRequisicao(req: Request): string {
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return encaminhado || req.headers.get("x-real-ip") || "desconhecido";
}
