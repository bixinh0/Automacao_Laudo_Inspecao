/**
 * Regras da tela de envio que não dependem do navegador: estados de cada
 * foto, o que falta para gerar o laudo e o rascunho guardado no sessionStorage.
 */

import { MAX_OBSERVACOES, opValida, type TipoImagem } from "./regras";

/**
 * Caminho de cada foto:
 *   aguardando → reservando → fila → reduzindo → enviando → processando → pronta
 * aguardando: escolhida, esperando o número da OP (sem rascunho ainda) ou a vez de reservar;
 * reservando: pedindo ao servidor a vaga no rascunho e a URL de envio;
 * fila: com vaga, esperando a vez (poucos envios ao mesmo tempo);
 * reduzindo: reduzindo no próprio aparelho antes de enviar;
 * processando: enviada; o servidor corrige, comprime e devolve a miniatura.
 */
export type EstadoFoto =
  | "aguardando"
  | "reservando"
  | "fila"
  | "reduzindo"
  | "enviando"
  | "processando"
  | "pronta"
  | "erro"
  | "removendo";

export const EM_ANDAMENTO: readonly EstadoFoto[] = ["aguardando", "reservando", "fila", "reduzindo", "enviando", "processando"];

export const emAndamento = (estado: EstadoFoto) => EM_ANDAMENTO.includes(estado);

/** Progresso da foto de 0 a 1: preparar vale 5%, enviar 85% e o processamento no servidor fecha os 10% finais. */
export function progressoFoto(estado: EstadoFoto, fracaoEnvio: number): number {
  switch (estado) {
    case "reduzindo":
      return 0.05;
    case "enviando":
      return 0.05 + Math.min(1, Math.max(0, fracaoEnvio)) * 0.85;
    case "processando":
      return 0.9;
    case "pronta":
      return 1;
    default:
      return 0;
  }
}

export function rotuloEstado(estado: EstadoFoto, fracaoEnvio: number, opInformada: boolean): string {
  switch (estado) {
    case "aguardando":
      return opInformada ? "Na fila" : "Aguardando OP";
    case "reservando":
    case "fila":
      return "Na fila";
    case "reduzindo":
      return "Preparando…";
    case "enviando":
      // Mesma porcentagem da barra da foto.
      return `Enviando ${Math.round(progressoFoto(estado, fracaoEnvio) * 100)}%`;
    case "processando":
      return "Processando…";
    case "pronta":
      return "Enviada";
    case "erro":
      return "Falhou";
    case "removendo":
      return "Removendo…";
  }
}

/** O que ainda impede gerar o laudo, em texto para a pessoa. Vazio = pode gerar. */
export function pendencias(op: string, fotos: { tipo: TipoImagem; estado: EstadoFoto }[]): string[] {
  const validas = fotos.filter((f) => f.estado !== "removendo");
  const faltando: string[] = [];
  if (!opValida(op)) faltando.push("número da OP (4 a 8 dígitos)");
  if (!validas.some((f) => f.tipo === "FORMULARIO")) faltando.push("foto do formulário");
  if (!validas.some((f) => f.tipo === "PECA")) faltando.push("fotos das peças");
  if (validas.some((f) => emAndamento(f.estado))) faltando.push("terminar o envio das fotos");
  if (validas.some((f) => f.estado === "erro")) faltando.push("reenviar ou remover as fotos com falha");
  return faltando;
}

/** Guardado no sessionStorage: some ao fechar a aba e sobrevive a recarregar a página. */
export const CHAVE_RASCUNHO_LOCAL = "laudo-inspecao:rascunho";

export interface RascunhoLocal {
  op: string;
  observacoes: string;
  /** Laudo em rascunho no banco, para recuperar as fotos já enviadas. */
  rascunhoId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê o que foi guardado, descartando qualquer valor que a tela não aceitaria. */
export function lerRascunhoLocal(bruto: string | null): RascunhoLocal | null {
  if (!bruto) return null;
  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!dados || typeof dados !== "object") return null;
  const d = dados as Record<string, unknown>;
  const op = typeof d.op === "string" ? d.op.replace(/\D/g, "").slice(0, 8) : "";
  const observacoes = typeof d.observacoes === "string" ? d.observacoes.slice(0, MAX_OBSERVACOES) : "";
  const rascunhoId = typeof d.rascunhoId === "string" && UUID.test(d.rascunhoId) ? d.rascunhoId : null;
  if (!op && !observacoes && !rascunhoId) return null;
  return { op, observacoes, rascunhoId };
}

export function gravarRascunhoLocal(r: RascunhoLocal): string {
  return JSON.stringify({ op: r.op, observacoes: r.observacoes, rascunhoId: r.rascunhoId });
}
