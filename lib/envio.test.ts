import { describe, expect, it } from "vitest";
import { gravarRascunhoLocal, lerRascunhoLocal, pendencias, progressoFoto, rotuloEstado, type EstadoFoto } from "./envio";
import { MAX_OBSERVACOES } from "./regras";

const ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("progresso por foto", () => {
  it("cresce do início ao fim do caminho da foto", () => {
    const caminho: [EstadoFoto, number][] = [
      ["fila", 0],
      ["reduzindo", 0],
      ["enviando", 0],
      ["enviando", 0.5],
      ["enviando", 1],
      ["processando", 0],
      ["pronta", 0],
    ];
    const valores = caminho.map(([e, f]) => progressoFoto(e, f));
    for (let i = 1; i < valores.length; i++) expect(valores[i]).toBeGreaterThanOrEqual(valores[i - 1]);
    expect(valores.at(-1)).toBe(1);
  });

  it("não sai de 0 a 1 mesmo com fração fora da faixa", () => {
    expect(progressoFoto("enviando", 7)).toBeCloseTo(0.9);
    expect(progressoFoto("enviando", -1)).toBeCloseTo(0.05);
  });

  it("rótulos mostram a porcentagem e esperam a OP", () => {
    expect(rotuloEstado("enviando", 0.456, true)).toBe(`Enviando ${Math.round(progressoFoto("enviando", 0.456) * 100)}%`);
    expect(rotuloEstado("enviando", 1, true)).toBe("Enviando 90%");
    expect(rotuloEstado("aguardando", 0, false)).toBe("Aguardando OP");
    expect(rotuloEstado("aguardando", 0, true)).toBe("Na fila");
    expect(rotuloEstado("erro", 0, true)).toBe("Falhou");
  });
});

describe("pendências para gerar o laudo", () => {
  const pronta = (tipo: "FORMULARIO" | "PECA", estado: EstadoFoto = "pronta") => ({ tipo, estado });

  it("libera com OP válida e uma foto pronta de cada tipo", () => {
    expect(pendencias("123456", [pronta("FORMULARIO"), pronta("PECA")])).toEqual([]);
  });

  it("lista OP e fotos que faltam", () => {
    expect(pendencias("12", [])).toEqual(["número da OP (4 a 8 dígitos)", "foto do formulário", "fotos das peças"]);
  });

  it("espera envios em andamento e cobra as fotos com falha", () => {
    expect(pendencias("1234", [pronta("FORMULARIO"), pronta("PECA", "enviando")])).toEqual(["terminar o envio das fotos"]);
    expect(pendencias("1234", [pronta("FORMULARIO"), pronta("PECA"), pronta("PECA", "erro")])).toEqual([
      "reenviar ou remover as fotos com falha",
    ]);
  });

  it("foto sendo removida não conta", () => {
    expect(pendencias("1234", [pronta("FORMULARIO"), pronta("PECA", "removendo")])).toEqual(["fotos das peças"]);
  });
});

describe("rascunho no sessionStorage", () => {
  it("ida e volta", () => {
    const r = { op: "123456", observacoes: "Lote 2\nSem avarias", rascunhoId: ID };
    expect(lerRascunhoLocal(gravarRascunhoLocal(r))).toEqual(r);
  });

  it("ignora conteúdo vazio, corrompido ou de outro formato", () => {
    expect(lerRascunhoLocal(null)).toBeNull();
    expect(lerRascunhoLocal("")).toBeNull();
    expect(lerRascunhoLocal("{quebrado")).toBeNull();
    expect(lerRascunhoLocal("[1,2]")).toBeNull();
    expect(lerRascunhoLocal(JSON.stringify({ op: "", observacoes: "", rascunhoId: null }))).toBeNull();
  });

  it("limpa valores que a tela não aceitaria", () => {
    const r = lerRascunhoLocal(
      JSON.stringify({ op: "12a34567890", observacoes: "x".repeat(MAX_OBSERVACOES + 50), rascunhoId: "../../outro" }),
    );
    expect(r).toEqual({ op: "12345678", observacoes: "x".repeat(MAX_OBSERVACOES), rascunhoId: null });
  });
});
