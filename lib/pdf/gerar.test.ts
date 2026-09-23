import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { gerarPdfLaudo, type ImagemPdf } from "./gerar";

async function imagem(id: string, largura: number, altura: number): Promise<ImagemPdf> {
  const dados = await sharp({ create: { width: largura, height: altura, channels: 3, background: "#4a7" } })
    .jpeg()
    .toBuffer();
  return { id, dados, largura, altura };
}

function paginas(pdf: Buffer) {
  const texto = pdf.toString("latin1");
  return [...texto.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => ({
    largura: Math.round(Number(m[1])),
    altura: Math.round(Number(m[2])),
  }));
}

const A4_RETRATO = { largura: 595, altura: 842 };
const A4_PAISAGEM = { largura: 842, altura: 595 };

describe("gerarPdfLaudo", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [7, 1],
    [10, 2],
    [15, 2],
    [30, 4],
  ])("%i fotos → identificação + formulário + %i página(s) de fotos, todas A4", async (n, paginasFotos) => {
    const formularios = [await imagem("f1", 300, 400), await imagem("f2", 400, 300)];
    const pecas = await Promise.all(Array.from({ length: n }, (_, i) => imagem(`p${i}`, i % 3 ? 400 : 300, i % 3 ? 300 : 400)));
    const pdf = await gerarPdfLaudo({ numeroOP: "12345", observacoes: null, emitidoEm: new Date(), formularios, pecas });

    const lista = paginas(pdf);
    expect(lista).toHaveLength(1 + formularios.length + paginasFotos);
    expect(lista[0]).toEqual(A4_RETRATO);
    // Folha em pé → página retrato; folha deitada → página paisagem.
    expect(lista[1]).toEqual(A4_RETRATO);
    expect(lista[2]).toEqual(A4_PAISAGEM);
    for (const p of lista.slice(3)) expect(p).toEqual(A4_RETRATO);
  });

  it("com ou sem observações, a identificação ocupa uma única página", async () => {
    const base = { numeroOP: "12345", emitidoEm: new Date(), formularios: [await imagem("f", 300, 400)], pecas: [await imagem("p", 400, 300)] };
    const texto = async (observacoes: string | null) => {
      const pdf = await gerarPdfLaudo({ ...base, observacoes });
      return paginas(pdf).length;
    };
    expect(await texto(null)).toBe(3);
    expect(await texto("Peça conferida.")).toBe(3);
  });
});
