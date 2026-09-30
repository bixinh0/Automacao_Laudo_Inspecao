import { createHash } from "node:crypto";
import sharp from "sharp";
import { PERFIS, type TipoImagem } from "./regras";

export interface ImagemProcessada {
  buffer: Buffer;
  largura: number;
  altura: number;
  /** SHA-256 (hex) do JPEG final, exatamente como embutido no PDF. */
  hashSha256: string;
}

/**
 * Corrige a rotação pelo EXIF, reduz para o maior lado do perfil (sem
 * ampliar), converte para JPEG e calcula o hash do arquivo resultante.
 * Os metadados (EXIF, GPS) são descartados.
 */
export async function processarImagem(entrada: Buffer, tipo: TipoImagem): Promise<ImagemProcessada> {
  const { maiorLado, qualidade } = PERFIS[tipo];
  const { data, info } = await sharp(entrada, { failOn: "none" })
    .rotate()
    .resize({ width: maiorLado, height: maiorLado, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: qualidade })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    largura: info.width,
    altura: info.height,
    hashSha256: sha256(data),
  };
}

export function sha256(dados: Buffer): string {
  return createHash("sha256").update(dados).digest("hex");
}

/** Maior lado da miniatura mostrada na tela de envio (cabe em telas de alta densidade). */
export const LADO_MINIATURA = 320;

export async function gerarMiniatura(jpeg: Buffer): Promise<Buffer> {
  return sharp(jpeg)
    .resize({ width: LADO_MINIATURA, height: LADO_MINIATURA, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
}

export function paraDataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
