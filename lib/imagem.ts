import { createHash } from "node:crypto";
import sharp from "sharp";
import type { TipoImagem } from "./regras";

/**
 * O formulário leva resolução e qualidade maiores: é a única fonte dos dados
 * de inspeção e a escrita à mão precisa continuar legível.
 */
export const PERFIS: Record<TipoImagem, { maiorLado: number; qualidade: number }> = {
  FORMULARIO: { maiorLado: 2000, qualidade: 85 },
  PECA: { maiorLado: 1600, qualidade: 80 },
};

export interface ImagemProcessada {
  buffer: Buffer;
  largura: number;
  altura: number;
  /** SHA-256 (hex) do arquivo JPEG gravado no armazenamento. */
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
