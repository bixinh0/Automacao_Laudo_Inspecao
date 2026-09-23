import type { Area } from "../layout";

/** Medidas do PDF em pontos (1 pt = 1/72 pol). Página A4. */
export const A4 = { largura: 595.28, altura: 841.89 };

export const MARGEM = 36;
export const ALTURA_CABECALHO = 46;
export const ALTURA_RODAPE = 20;
/** Distância do rodapé até a borda inferior da página. */
export const DISTANCIA_RODAPE = 22;
/** Espaço que o conteúdo precisa deixar livre no pé da página (rodapé + folga). */
export const RESERVA_RODAPE = DISTANCIA_RODAPE + ALTURA_RODAPE + 6;
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

/** Caixa onde a foto do formulário é encaixada, conforme a orientação da página. */
export function caixaFormulario(paisagem: boolean) {
  const larguraPagina = paisagem ? A4.altura : A4.largura;
  const alturaPagina = paisagem ? A4.largura : A4.altura;
  return {
    larguraPagina,
    alturaPagina,
    topo: MARGEM_FORMULARIO + ALTURA_TITULO_FORMULARIO,
    largura: larguraPagina - 2 * MARGEM_FORMULARIO,
    altura: alturaPagina - MARGEM_FORMULARIO - ALTURA_TITULO_FORMULARIO - RESERVA_RODAPE,
  };
}
