import { describe, expect, it } from "vitest";
import {
  agruparPorOrientacao,
  alocarFotos,
  distribuirPaginas,
  estruturaLinhas,
  OPCOES_PADRAO,
  repartirAltura,
  type FotoEntrada,
  type PaginaFotos,
} from "./layout";
import { AREA_FOTOS as AREA } from "./pdf/medidas";

const EPS = 1e-6;

const RETRATO = { largura: 1200, altura: 1600 };
const PAISAGEM = { largura: 1600, altura: 1200 };

function gerarFotos(n: number, padrao: (i: number) => { largura: number; altura: number } = () => PAISAGEM): FotoEntrada[] {
  return Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, ...padrao(i) }));
}

/** Mistura realista: proporções variadas de celular, em pé e deitadas. */
function mistura(i: number) {
  const tipos = [RETRATO, PAISAGEM, { largura: 1080, altura: 1920 }, { largura: 2000, altura: 1500 }, { largura: 1500, altura: 1500 }];
  return tipos[(i * 7) % tipos.length];
}

function retangulosSobrepoem(a: { x: number; y: number; largura: number; altura: number }, b: typeof a) {
  return a.x < b.x + b.largura - EPS && b.x < a.x + a.largura - EPS && a.y < b.y + b.altura - EPS && b.y < a.y + a.altura - EPS;
}

function verificarInvariantes(fotos: FotoEntrada[], paginas: PaginaFotos[], tamanhoMinimo = 40) {
  const porId = new Map(fotos.map((f) => [f.id, f]));

  // Nenhuma página vazia, nenhuma com mais de 9.
  for (const p of paginas) {
    expect(p.fotos.length).toBeGreaterThan(0);
    expect(p.fotos.length).toBeLessThanOrEqual(9);
  }

  // Nenhuma foto órfã sozinha na última página (quando há mais de uma foto).
  if (fotos.length > 1) expect(paginas.at(-1)!.fotos.length).toBeGreaterThan(1);

  // Cada foto aparece exatamente uma vez; numeração sequencial 1..N.
  const todas = paginas.flatMap((p) => p.fotos);
  expect(todas.map((f) => f.numero)).toEqual(Array.from({ length: fotos.length }, (_, i) => i + 1));
  expect(new Set(todas.map((f) => f.id)).size).toBe(fotos.length);
  expect(todas.length).toBe(fotos.length);

  for (const p of paginas) {
    for (const f of p.fotos) {
      const original = porId.get(f.id)!;
      // Proporção preservada (sem distorção).
      expect(f.largura / f.altura).toBeCloseTo(original.largura / original.altura, 6);
      // Tamanho útil (não degenerado).
      expect(Math.min(f.largura, f.altura)).toBeGreaterThan(tamanhoMinimo);
      // Imagem e legenda dentro da área útil (sem corte).
      expect(f.x).toBeGreaterThanOrEqual(-EPS);
      expect(f.y).toBeGreaterThanOrEqual(-EPS);
      expect(f.x + f.largura).toBeLessThanOrEqual(AREA.largura + EPS);
      expect(f.legenda.y + f.legenda.altura).toBeLessThanOrEqual(AREA.altura + EPS);
    }
    // Nenhuma sobreposição entre imagens nem entre imagem e legenda.
    const blocos = p.fotos.map((f) => ({ x: f.x, y: f.y, largura: f.largura, altura: f.altura + f.legenda.altura }));
    for (let i = 0; i < blocos.length; i++) {
      for (let j = i + 1; j < blocos.length; j++) {
        expect(retangulosSobrepoem(blocos[i], blocos[j])).toBe(false);
      }
    }
  }
}

describe("distribuirPaginas", () => {
  it.each([
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [4]],
    [7, [7]],
    [9, [9]],
    [10, [8, 2]],
    [15, [9, 6]],
    [18, [9, 9]],
    [19, [9, 8, 2]],
    [30, [9, 9, 9, 3]],
    [37, [9, 9, 9, 8, 2]],
  ])("%i fotos → %j", (n, esperado) => {
    expect(distribuirPaginas(n)).toEqual(esperado);
  });

  it("nunca deixa página vazia nem foto órfã, de 1 a 200 fotos", () => {
    for (let n = 1; n <= 200; n++) {
      const paginas = distribuirPaginas(n);
      expect(paginas.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.min(...paginas)).toBeGreaterThan(0);
      expect(Math.max(...paginas)).toBeLessThanOrEqual(9);
      if (n > 1) expect(paginas.at(-1)).toBeGreaterThan(1);
    }
  });
});

describe("estruturaLinhas", () => {
  it("segue a tabela de disposição", () => {
    expect(estruturaLinhas(3)).toEqual([2, 1]);
    expect(estruturaLinhas(4)).toEqual([2, 2]);
    expect(estruturaLinhas(5)).toEqual([2, 2, 1]);
    expect(estruturaLinhas(6)).toEqual([2, 2, 2]);
    expect(estruturaLinhas(7)).toEqual([3, 3, 1]);
    expect(estruturaLinhas(9)).toEqual([3, 3, 3]);
  });
});

describe("agruparPorOrientacao", () => {
  it("coloca fotos de mesma orientação na mesma linha", () => {
    // P = paisagem, R = retrato, intercaladas: P R P R P R
    const fotos = gerarFotos(6, (i) => (i % 2 === 0 ? PAISAGEM : RETRATO));
    const linhas = agruparPorOrientacao(fotos, [3, 3]);
    expect(linhas[0].map((f) => f.id)).toEqual(["f1", "f3", "f5"]);
    expect(linhas[1].map((f) => f.id)).toEqual(["f2", "f4", "f6"]);
  });

  it("escolhe a ordem de grupos que evita linhas mistas", () => {
    // 1 paisagem + 6 retratos em [3,3,1]: retratos primeiro, paisagem sozinha na última linha.
    const fotos = gerarFotos(7, (i) => (i === 0 ? PAISAGEM : RETRATO));
    const linhas = agruparPorOrientacao(fotos, [3, 3, 1]);
    expect(linhas[2].map((f) => f.id)).toEqual(["f1"]);
  });
});

describe("alocarFotos — agrupamento por orientação", () => {
  it("7 fotos (5 deitadas, 2 em pé): usa [3,2,2] para não misturar orientações", () => {
    const fotos = gerarFotos(7, (i) => (i === 1 || i === 4 ? RETRATO : PAISAGEM));
    const [p] = alocarFotos(fotos, AREA);
    const linhas = new Map<string, string[]>();
    for (const f of p.fotos) {
      const chave = (f.y + f.altura).toFixed(2); // fotos da mesma linha têm a mesma base
      linhas.set(chave, [...(linhas.get(chave) ?? []), f.id]);
    }
    const orientacoes = [...linhas.values()].map((ids) => new Set(ids.map((id) => (id === "f2" || id === "f5" ? "R" : "P"))));
    expect(orientacoes.every((o) => o.size === 1)).toBe(true);
    expect([...linhas.values()].map((l) => l.length)).toEqual([3, 2, 2]);
  });
});

describe("repartirAltura", () => {
  it("dá a cada linha o que ela precisa quando cabe", () => {
    expect(repartirAltura([100, 200], 500)).toEqual([100, 200]);
  });
  it("preserva linhas baixas e divide a sobra entre as altas", () => {
    const r = repartirAltura([100, 400, 400], 600);
    expect(r[0]).toBe(100);
    expect(r[1]).toBeCloseTo(250);
    expect(r[2]).toBeCloseTo(250);
  });
});

describe("alocarFotos — quantidades exigidas nos critérios de aceite", () => {
  // [nome, gerador de dimensões, menor lado mínimo aceitável em pt]
  const cenarios: Array<[string, (i: number) => { largura: number; altura: number }, number]> = [
    ["paisagem", () => PAISAGEM, 40],
    ["retrato", () => RETRATO, 40],
    ["mistura", mistura, 40],
    // Proporções de 5:1 e 1:4 só cabem pequenas com contain; exige-se apenas que não sumam.
    ["panorâmica extrema", (i) => (i % 2 ? { largura: 4000, altura: 800 } : { largura: 700, altura: 3000 }), 15],
  ];

  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 30]) {
    for (const [nome, padrao, minimo] of cenarios) {
      it(`${n} foto(s) — ${nome}`, () => {
        const fotos = gerarFotos(n, padrao);
        const paginas = alocarFotos(fotos, AREA);
        verificarInvariantes(fotos, paginas, minimo);
      });
    }
  }

  it("sustenta as invariantes para qualquer quantidade de 1 a 60", () => {
    for (let n = 1; n <= 60; n++) {
      const fotos = gerarFotos(n, mistura);
      verificarInvariantes(fotos, alocarFotos(fotos, AREA));
    }
  });

  it("1 foto: largura útil, no máximo meia página de altura", () => {
    // 16:9 cabe na largura útil sem passar de meia página.
    const [p] = alocarFotos(gerarFotos(1, () => ({ largura: 1920, altura: 1080 })), AREA);
    expect(p.fotos[0].largura).toBeCloseTo(AREA.largura);
    // 4:3 e retrato: a altura é que limita, em meia página.
    for (const dim of [PAISAGEM, RETRATO]) {
      const [q] = alocarFotos(gerarFotos(1, () => dim), AREA);
      expect(q.fotos[0].altura).toBeCloseTo(AREA.altura / 2);
      expect(q.fotos[0].x + q.fotos[0].largura / 2).toBeCloseTo(AREA.largura / 2);
    }
  });

  it("2 fotos: lado a lado, mesma altura, mesmo com orientações diferentes", () => {
    const [p] = alocarFotos(gerarFotos(2, (i) => (i ? RETRATO : PAISAGEM)), AREA);
    expect(p.fotos[0].y).toBeCloseTo(p.fotos[1].y);
    expect(p.fotos[0].altura).toBeCloseTo(p.fotos[1].altura);
    expect(p.fotos[0].largura + p.fotos[1].largura + OPCOES_PADRAO.espacoHorizontal).toBeCloseTo(AREA.largura);
  });

  it("3 fotos: 2 em cima e 1 centralizada abaixo", () => {
    const [p] = alocarFotos(gerarFotos(3), AREA);
    const [a, b, c] = p.fotos;
    expect(a.y).toBeCloseTo(b.y);
    expect(c.y).toBeGreaterThan(a.y + a.altura);
    expect(c.x + c.largura / 2).toBeCloseTo(AREA.largura / 2);
  });

  it("4 fotos: grade 2 × 2", () => {
    const [p] = alocarFotos(gerarFotos(4), AREA);
    expect(new Set(p.fotos.map((f) => f.y.toFixed(3))).size).toBe(2);
    expect(new Set(p.fotos.map((f) => f.x.toFixed(3))).size).toBe(2);
  });

  it("6 fotos: 3 linhas × 2 colunas", () => {
    const [p] = alocarFotos(gerarFotos(6), AREA);
    expect(new Set(p.fotos.map((f) => f.y.toFixed(3))).size).toBe(3);
    expect(new Set(p.fotos.map((f) => f.x.toFixed(3))).size).toBe(2);
  });

  it("7 fotos: grade 3 × 3 numa única página", () => {
    const paginas = alocarFotos(gerarFotos(7), AREA);
    expect(paginas).toHaveLength(1);
    expect(new Set(paginas[0].fotos.map((f) => f.y.toFixed(3))).size).toBe(3);
  });

  it("15 fotos: 9 + 6, numeração contínua entre páginas", () => {
    const paginas = alocarFotos(gerarFotos(15), AREA);
    expect(paginas.map((p) => p.fotos.length)).toEqual([9, 6]);
    expect(paginas[1].fotos[0].numero).toBe(10);
  });

  it("30 fotos: 9 + 9 + 9 + 3", () => {
    const paginas = alocarFotos(gerarFotos(30), AREA);
    expect(paginas.map((p) => p.fotos.length)).toEqual([9, 9, 9, 3]);
  });

  it("rejeita foto sem dimensões", () => {
    expect(() => alocarFotos([{ id: "x", largura: 0, altura: 10 }], AREA)).toThrow();
  });
});
