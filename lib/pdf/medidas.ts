import type { Area } from "../layout";

/** Medidas do PDF em pontos (1 pt = 1/72 pol). Página A4. */
export const A4 = { largura: 595.28, altura: 841.89 };

export const MARGEM = 36;
export const ALTURA_CABECALHO = 46;
export const ALTURA_RODAPE = 20;
/** Respiro entre a linha do cabeçalho e a primeira linha de fotos. */
export const ESPACO_APOS_CABECALHO = 10;

/** Área útil das páginas de registro fotográfico, descontados margens, cabeçalho e rodapé. */
export const AREA_FOTOS: Area = {
  largura: A4.largura - 2 * MARGEM,
  altura: A4.altura - 2 * MARGEM - ALTURA_CABECALHO - ESPACO_APOS_CABECALHO - ALTURA_RODAPE,
};

/** Páginas do formulário usam margem menor: legibilidade é prioridade. */
export const MARGEM_FORMULARIO = 20;
export const ALTURA_TITULO_FORMULARIO = 26;
