/**
 * Reduz a foto no próprio celular antes do envio (roda no navegador).
 *
 * Uma foto de celular tem 3 a 6 MB; o laudo usa no máximo 2000 px (formulário)
 * ou 1280 px (peças). Reduzir antes de enviar deixa o envio várias vezes mais
 * rápido na rede da fábrica e mantém o tráfego dentro do plano gratuito do
 * Supabase. O servidor ainda corrige rotação, comprime e calcula o hash.
 *
 * Os navegadores atuais aplicam a orientação EXIF ao desenhar a imagem, então
 * o JPEG gerado já sai em pé (e sem EXIF). Se algo falhar (formato que o
 * navegador não abre, como HEIC no Chrome do computador), envia o original.
 */

import { PERFIS, type TipoImagem } from "./regras";

// Qualidade um pouco acima da final: o servidor recomprime e não queremos perda dupla visível.
const QUALIDADE_ENVIO = { FORMULARIO: 0.92, PECA: 0.88 } satisfies Record<TipoImagem, number>;

function carregar(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("formato não suportado"));
    };
    img.src = url;
  });
}

export async function reduzirFoto(arquivo: File, tipo: TipoImagem): Promise<Blob> {
  try {
    const img = await carregar(arquivo);
    const { maiorLado } = PERFIS[tipo];
    const escala = Math.min(1, maiorLado / Math.max(img.naturalWidth, img.naturalHeight));
    // Já pequena e em JPEG: não vale recomprimir.
    if (escala === 1 && arquivo.type === "image/jpeg" && arquivo.size < 1_500_000) return arquivo;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return arquivo;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const reduzida = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", QUALIDADE_ENVIO[tipo]));
    return reduzida && reduzida.size < arquivo.size ? reduzida : arquivo;
  } catch {
    return arquivo;
  }
}
