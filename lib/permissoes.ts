import type { Papel, Situacao } from "./contas";

/**
 * Quem pode fazer o quê na gestão de usuários. Função pura, usada pelo
 * servidor antes de qualquer alteração (e pela tela, só para esconder botões).
 * O banco aplica as mesmas regras de novo (RLS + gatilho em profiles).
 */

export type AcaoUsuario =
  | "APROVAR"
  | "RECUSAR"
  | "SUSPENDER"
  | "PROMOVER"
  | "REBAIXAR"
  | "EDITAR"
  | "REDEFINIR_SENHA"
  | "REMOVER";

export const ACOES: readonly AcaoUsuario[] = [
  "APROVAR",
  "RECUSAR",
  "SUSPENDER",
  "PROMOVER",
  "REBAIXAR",
  "EDITAR",
  "REDEFINIR_SENHA",
  "REMOVER",
];

export interface Pessoa {
  id: string;
  papel: Papel;
  situacao: Situacao;
}

/** Devolve null se permitido, ou o motivo da recusa (vira resposta 403). */
export function motivoRecusa(ator: Pessoa, alvo: Pessoa, acao: AcaoUsuario): string | null {
  const gestor = ator.situacao === "APROVADO" && (ator.papel === "OWNER" || ator.papel === "ADMIN");
  if (!gestor) return "Apenas OWNER e ADMIN podem gerenciar usuários.";

  if (alvo.papel === "OWNER") {
    if (ator.id !== alvo.id) return "Apenas o próprio OWNER pode alterar o cadastro do OWNER.";
    if (acao === "EDITAR") return null;
    if (acao === "REDEFINIR_SENHA") return "Para trocar a sua senha, use Meu perfil.";
    return "O OWNER não pode rebaixar, suspender nem remover a si mesmo.";
  }
  if (ator.id === alvo.id) {
    return acao === "EDITAR" ? null : "Você não pode alterar o próprio papel nem a própria situação.";
  }
  if (ator.papel === "ADMIN" && alvo.papel === "ADMIN") return "Só o OWNER pode alterar um ADMIN.";

  switch (acao) {
    case "PROMOVER":
      if (ator.papel !== "OWNER") return "Só o OWNER pode promover usuários a ADMIN.";
      if (alvo.papel !== "USUARIO" || alvo.situacao !== "APROVADO") return "Só usuários aprovados podem ser promovidos.";
      return null;
    case "REBAIXAR":
      if (ator.papel !== "OWNER") return "Só o OWNER pode rebaixar um ADMIN.";
      return alvo.papel === "ADMIN" ? null : "Este usuário não é ADMIN.";
    case "APROVAR":
      return alvo.situacao === "APROVADO" ? "Este cadastro já está aprovado." : null;
    case "RECUSAR":
      return alvo.situacao === "PENDENTE" ? null : "Só cadastros pendentes podem ser recusados. Para bloquear um aprovado, suspenda.";
    case "SUSPENDER":
      return alvo.situacao === "APROVADO" ? null : "Só usuários aprovados podem ser suspensos.";
    case "EDITAR":
    case "REDEFINIR_SENHA":
    case "REMOVER":
      return null;
  }
}

export function podeGerenciar(p: { papel: Papel; situacao: Situacao }): boolean {
  return p.situacao === "APROVADO" && (p.papel === "OWNER" || p.papel === "ADMIN");
}
