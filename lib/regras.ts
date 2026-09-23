/** Regras de validação compartilhadas entre o navegador e o servidor. */

export const REGEX_OP = /^\d{4,8}$/;
export const MAX_OBSERVACOES = 3000;
export const MAX_FOLHAS_FORMULARIO = 10;
export const MAX_FOTOS_PECAS = 100;
/** Limite por arquivo do plano gratuito do Supabase Storage. */
export const MAX_BYTES_ARQUIVO = 50 * 1024 * 1024;

export type TipoImagem = "FORMULARIO" | "PECA";
export const TIPOS: readonly TipoImagem[] = ["FORMULARIO", "PECA"];

export function opValida(op: string): boolean {
  return REGEX_OP.test(op);
}
