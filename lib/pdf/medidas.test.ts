import { describe, expect, it } from "vitest";
import {
  A4,
  ALTURA_CABECALHO,
  ALTURA_RODAPE,
  AREA_FOTOS,
  caixaFormulario,
  DISTANCIA_RODAPE,
  ESPACO_APOS_CABECALHO,
  MARGEM,
} from "./medidas";

describe("medidas do PDF", () => {
  it.each([false, true])("foto do formulário termina acima do rodapé (paisagem = %s)", (paisagem) => {
    const c = caixaFormulario(paisagem);
    const topoRodape = c.alturaPagina - DISTANCIA_RODAPE - ALTURA_RODAPE;
    expect(c.topo + c.altura).toBeLessThan(topoRodape);
  });

  it("área das fotos das peças termina acima do rodapé", () => {
    const fim = MARGEM + ALTURA_CABECALHO + ESPACO_APOS_CABECALHO + AREA_FOTOS.altura;
    expect(fim).toBeLessThan(A4.altura - DISTANCIA_RODAPE - ALTURA_RODAPE);
  });
});
