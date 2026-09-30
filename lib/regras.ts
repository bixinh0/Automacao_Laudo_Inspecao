/** Regras de validação compartilhadas entre o navegador e o servidor. */

/** Documento gerado pelo sistema: título e código que aparecem no cabeçalho e no rodapé do PDF. */
export const TITULO_LAUDO = "Laudo de Inspeção - Embarque Controlado";
export const CODIGO_LAUDO = "FM QUA 004 01 rev2";

/** Formulário de inspeção preenchido à mão e fotografado (documento controlado, não é alterado). */
export const CODIGO_FORMULARIO = "FM PRO 001 01";

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

export function limiteFotos(tipo: TipoImagem): number {
  return tipo === "FORMULARIO" ? MAX_FOLHAS_FORMULARIO : MAX_FOTOS_PECAS;
}

/** Lê e valida número da OP e observações vindos da tela (criar, atualizar e emitir o laudo). */
export function lerDadosLaudo(corpo: Record<string, unknown>): { numeroOP: string; observacoes: string | null } | { erro: string } {
  const numeroOP = String(corpo.numeroOP ?? "").trim();
  const observacoes = String(corpo.observacoes ?? "").trim() || null;
  if (!opValida(numeroOP)) return { erro: "O número da OP deve ter de 4 a 8 dígitos." };
  if (observacoes && observacoes.length > MAX_OBSERVACOES) return { erro: `Observações com no máximo ${MAX_OBSERVACOES} caracteres.` };
  return { numeroOP, observacoes };
}
