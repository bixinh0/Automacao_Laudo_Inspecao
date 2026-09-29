/**
 * Regras de contas compartilhadas entre navegador e servidor: domínio do
 * e-mail, política e força de senha, departamentos, papéis e situações.
 * O servidor sempre revalida — a checagem no navegador é só para dar
 * retorno imediato a quem está digitando.
 */

export const DEPARTAMENTOS = {
  ADMINISTRATIVO: "Administrativo",
  COMERCIAL: "Comercial",
  ENGENHARIA: "Engenharia",
  PRODUCAO: "Produção",
  QUALIDADE: "Qualidade",
  RECURSOS_HUMANOS: "Recursos Humanos",
  SUPORTE_TECNICO: "Suporte Técnico",
  SUPRIMENTOS: "Suprimentos",
} as const;
export type Departamento = keyof typeof DEPARTAMENTOS;

/** Em ordem alfabética do nome exibido. */
export const LISTA_DEPARTAMENTOS = (Object.keys(DEPARTAMENTOS) as Departamento[]).sort((a, b) =>
  DEPARTAMENTOS[a].localeCompare(DEPARTAMENTOS[b], "pt-BR"),
);

export function departamentoValido(valor: unknown): valor is Departamento {
  return typeof valor === "string" && valor in DEPARTAMENTOS;
}

export type Papel = "OWNER" | "ADMIN" | "USUARIO";
export type Situacao = "PENDENTE" | "APROVADO" | "RECUSADO" | "SUSPENSO";

export const ROTULO_PAPEL: Record<Papel, string> = { OWNER: "Owner", ADMIN: "Administrador", USUARIO: "Usuário" };
export const ROTULO_SITUACAO: Record<Situacao, string> = {
  PENDENTE: "Pendente",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  SUSPENSO: "Suspenso",
};

export const MENSAGEM_DOMINIO = (dominio: string) => `Use seu e-mail corporativo @${dominio}`;

export function normalizarEmail(email: unknown): string {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * E-mail no domínio exato: "@dominio" no fim, nada de subdomínio
 * ("@sub.dominio") nem variação ("@vanderhulst.com" para "vanderhulst.com.br").
 */
export function emailDoDominio(email: string, dominio: string): boolean {
  const d = dominio.trim().toLowerCase();
  if (!d) return false;
  const partes = normalizarEmail(email).split("@");
  return partes.length === 2 && /^[^\s@]+$/.test(partes[0]) && partes[1] === d;
}

export const TAMANHO_MINIMO_SENHA = 8;

/** Política mínima: 8 caracteres, ao menos uma letra e um número. Devolve o problema ou null. */
export function problemaSenha(senha: string): string | null {
  if (senha.length < TAMANHO_MINIMO_SENHA) return `A senha precisa ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
  if (!/\p{L}/u.test(senha)) return "A senha precisa ter pelo menos uma letra.";
  if (!/\d/.test(senha)) return "A senha precisa ter pelo menos um número.";
  return null;
}

/** Força de 0 a 4, para o indicador durante a digitação. */
export function forcaSenha(senha: string): { nivel: 0 | 1 | 2 | 3 | 4; rotulo: string } {
  if (!senha) return { nivel: 0, rotulo: "" };
  let pontos = 0;
  if (senha.length >= TAMANHO_MINIMO_SENHA) pontos++;
  if (senha.length >= 12) pontos++;
  if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) pontos++;
  if (/\d/.test(senha) && /[^\p{L}\d]/u.test(senha)) pontos++;
  if (problemaSenha(senha)) pontos = Math.min(pontos, 1);
  const nivel = Math.max(1, Math.min(4, pontos)) as 1 | 2 | 3 | 4;
  return { nivel, rotulo: ["", "Fraca", "Razoável", "Boa", "Forte"][nivel] };
}
