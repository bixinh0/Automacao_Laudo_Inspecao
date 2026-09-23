/** Regras de validação compartilhadas entre o navegador e o servidor. */

/** Código do formulário de inspeção controlado, como aparece no laudo e na tela. */
export const CODIGO_FORMULARIO = "FM QUA 004 01 rev2";

export const REGEX_OP = /^\d{4,8}$/;
export const MAX_OBSERVACOES = 3000;
export const MAX_FOLHAS_FORMULARIO = 10;
export const MAX_FOTOS_PECAS = 100;
/** Limite por arquivo do plano gratuito do Supabase Storage. */
export const MAX_BYTES_ARQUIVO = 50 * 1024 * 1024;

export type TipoImagem = "FORMULARIO" | "PECA";
export const TIPOS: readonly TipoImagem[] = ["FORMULARIO", "PECA"];

/**
 * O formulário leva resolução e qualidade maiores: é a única fonte dos dados
 * de inspeção e a escrita à mão precisa continuar legível. As peças aparecem
 * no máximo na largura da página (~18 cm), onde 1280 px já dão ~180 dpi.
 * Os mesmos valores são usados pelo navegador ao reduzir antes do envio.
 */
export const PERFIS: Record<TipoImagem, { maiorLado: number; qualidade: number }> = {
  FORMULARIO: { maiorLado: 2000, qualidade: 85 },
  PECA: { maiorLado: 1280, qualidade: 78 },
};


export function opValida(op: string): boolean {
  return REGEX_OP.test(op);
}
