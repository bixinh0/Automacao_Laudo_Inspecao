import { describe, expect, it } from "vitest";
import { lerDadosLaudo, limiteFotos, MAX_FOLHAS_FORMULARIO, MAX_FOTOS_PECAS, MAX_OBSERVACOES } from "./regras";

describe("dados do laudo vindos da tela", () => {
  it("aceita OP de 4 a 8 dígitos e limpa observações vazias", () => {
    expect(lerDadosLaudo({ numeroOP: " 1234 ", observacoes: "   " })).toEqual({ numeroOP: "1234", observacoes: null });
    expect(lerDadosLaudo({ numeroOP: "12345678", observacoes: " Lote 2 " })).toEqual({ numeroOP: "12345678", observacoes: "Lote 2" });
  });

  it("recusa OP inválida e observações longas demais", () => {
    for (const numeroOP of ["", "123", "123456789", "12a4", undefined]) expect(lerDadosLaudo({ numeroOP })).toHaveProperty("erro");
    expect(lerDadosLaudo({ numeroOP: "1234", observacoes: "x".repeat(MAX_OBSERVACOES + 1) })).toHaveProperty("erro");
  });
});

it("limite de fotos por tipo", () => {
  expect(limiteFotos("FORMULARIO")).toBe(MAX_FOLHAS_FORMULARIO);
  expect(limiteFotos("PECA")).toBe(MAX_FOTOS_PECAS);
});
