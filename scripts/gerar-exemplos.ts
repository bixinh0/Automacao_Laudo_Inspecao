/**
 * Gera laudos de exemplo com fotos sintéticas, sem precisar de Supabase.
 *
 *   npm run exemplos            → 1, 2, 3, 4, 7, 15 e 30 fotos
 *   npm run exemplos -- 5 12    → quantidades escolhidas
 *
 * As fotos imitam as de celular: 4032×3024, JPEG de alguns MB, e as tiradas
 * "em pé" são gravadas deitadas com a tag EXIF de orientação 6, como faz a
 * câmera. Se a correção de rotação falhar, a seta "TOPO" aparece deitada.
 * Os PDFs saem em exemplos/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { processarImagem } from "../lib/imagem";
import type { TipoImagem } from "../lib/regras";
import { gerarPdfLaudo, type ImagemPdf } from "../lib/pdf/gerar";

const CORES = ["#2f6690", "#3a7d44", "#9c6644", "#6d597a", "#b56576", "#457b9d", "#8d99ae", "#bc6c25"];

function svgFoto(largura: number, altura: number, rotulo: string, cor: string) {
  const f = Math.min(largura, altura) / 10;
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">
      <rect x="${f * 0.4}" y="${f * 0.4}" width="${largura - f * 0.8}" height="${altura - f * 0.8}"
            fill="none" stroke="${cor}" stroke-width="${f / 5}"/>
      <polygon points="${largura / 2},${f * 1.2} ${largura / 2 - f},${f * 2.6} ${largura / 2 + f},${f * 2.6}" fill="#111"/>
      <text x="50%" y="${f * 3.6}" font-size="${f * 0.8}" font-family="sans-serif" text-anchor="middle" fill="#111">TOPO</text>
      <text x="50%" y="55%" font-size="${f * 2}" font-family="sans-serif" font-weight="bold"
            text-anchor="middle" fill="${cor}">${rotulo}</text>
      <text x="50%" y="${altura - f * 1.2}" font-size="${f * 0.6}" font-family="sans-serif"
            text-anchor="middle" fill="#111">${largura > altura ? "PAISAGEM" : "RETRATO"}</text>
    </svg>`);
}

function svgFormulario(largura: number, altura: number, folha: number) {
  const linhas = Array.from({ length: 28 }, (_, i) => {
    const y = 420 + i * 110;
    return `<line x1="120" y1="${y}" x2="${largura - 120}" y2="${y}" stroke="#333" stroke-width="3"/>
            <text x="140" y="${y - 25}" font-size="48" font-family="serif" fill="#1a3d8f">Medida ${i + 1}: ${(120 + i * 3.5).toFixed(1)} mm  ✓</text>`;
  }).join("");
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">
      <rect width="100%" height="100%" fill="#f4f1ea"/>
      <rect x="100" y="100" width="${largura - 200}" height="${altura - 200}" fill="none" stroke="#000" stroke-width="6"/>
      <text x="140" y="260" font-size="80" font-family="sans-serif" font-weight="bold">FM QUA 004 01 rev2 — LAUDO DE INSPEÇÃO DE PRODUÇÃO</text>
      <text x="140" y="340" font-size="54" font-family="sans-serif">Rev. 001 · Folha ${folha} (exemplo sintético)</text>
      ${linhas}
    </svg>`);
}

/** Foto "de celular": ruído (para o JPEG ter tamanho realista) + desenho por cima. */
async function fotoCelular(emPe: boolean, svg: (l: number, a: number) => Buffer): Promise<Buffer> {
  const [l, a] = emPe ? [3024, 4032] : [4032, 3024];
  const exibida = await sharp({ create: { width: l, height: a, channels: 3, background: "#dddddd" } })
    .composite([
      {
        input: await sharp({ create: { width: l, height: a, channels: 3, background: "#000", noise: { type: "gaussian", mean: 215, sigma: 18 } } })
          .png()
          .toBuffer(),
      },
      { input: svg(l, a) },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  if (!emPe) return exibida;
  // Como a câmera faz: grava os pixels deitados e marca EXIF orientação 6 (girar 90° horário ao exibir).
  return sharp(exibida).rotate(270).withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer();
}

async function processar(entradas: Buffer[], tipo: TipoImagem, prefixo: string): Promise<ImagemPdf[]> {
  // Mesma concorrência usada no envio real (3 por vez).
  const saida: ImagemPdf[] = new Array(entradas.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (proximo < entradas.length) {
        const i = proximo++;
        const r = await processarImagem(entradas[i], tipo);
        saida[i] = { id: `${prefixo}${i + 1}`, dados: r.buffer, largura: r.largura, altura: r.altura };
      }
    }),
  );
  return saida;
}

async function main() {
  const argumentos = process.argv.slice(2).map(Number).filter((n) => n > 0);
  const quantidades = argumentos.length ? argumentos : [1, 2, 3, 4, 7, 15, 30];
  const pasta = path.join(process.cwd(), "exemplos");
  await mkdir(pasta, { recursive: true });

  const formulariosBrutos = [
    await fotoCelular(true, (l, a) => svgFormulario(l, a, 1)),
    await fotoCelular(false, (l, a) => svgFormulario(l, a, 2)),
  ];

  for (const n of quantidades) {
    // Padrão irregular de orientações: ~1/3 das fotos tiradas em pé.
    const brutas = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        fotoCelular(i % 3 === 1, (l, a) => svgFoto(l, a, `#${i + 1}`, CORES[i % CORES.length])),
      ),
    );
    const mb = brutas.reduce((t, b) => t + b.length, 0) / 1024 / 1024;

    const inicio = performance.now();
    const formularios = await processar(formulariosBrutos, "FORMULARIO", "form");
    const pecas = await processar(brutas, "PECA", "peca");
    const meio = performance.now();
    const pdf = await gerarPdfLaudo({
      numeroOP: "123456",
      observacoes:
        n % 2 ? "Peças conferidas com o desenho rev. C.\nEmenda vulcanizada refeita no lote 2 — aprovada após reinspeção." : null,
      emitidoEm: new Date(),
      formularios,
      pecas,
    });
    const fim = performance.now();

    const arquivo = path.join(pasta, `laudo-${String(n).padStart(2, "0")}-fotos.pdf`);
    await writeFile(arquivo, pdf);
    console.log(
      `${String(n).padStart(2)} fotos (${mb.toFixed(1)} MB enviados): imagens ${((meio - inicio) / 1000).toFixed(1)} s + ` +
        `PDF ${((fim - meio) / 1000).toFixed(1)} s = ${((fim - inicio) / 1000).toFixed(1)} s → ` +
        `${path.relative(process.cwd(), arquivo)} (${(pdf.length / 1024 / 1024).toFixed(1)} MB)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
