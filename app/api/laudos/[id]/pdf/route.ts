import { after, NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { buscarLaudo, emitirLaudo, enviarLaudoAoOneDrive, urlDownloadPdf } from "@/lib/laudos";
import { configOneDrive } from "@/lib/onedrive";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Gera o PDF do laudo a partir das imagens já processadas. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const corpo = await lerJson(req);
  const formularios = Number(corpo.formularios);
  const pecas = Number(corpo.pecas);
  if (!Number.isInteger(formularios) || !Number.isInteger(pecas)) return erro("Quantidade de fotos inválida.");

  try {
    const laudo = await emitirLaudo(id, { formularios, pecas });
    // Cópia para o OneDrive depois da resposta: não atrasa a confirmação na tela.
    if (configOneDrive() && !laudo.onedriveEnviadoEm) after(() => enviarLaudoAoOneDrive(laudo.id));
    return NextResponse.json({ id: laudo.id, numeroOP: laudo.numeroOP });
  } catch (e) {
    return tratarErro(e);
  }
}

/**
 * Baixa o PDF: redireciona para um link temporário do Storage. O arquivo não
 * passa pela função, que tem limite de 4,5 MB de resposta na Vercel.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const laudo = await buscarLaudo(id);
    if (!laudo) return erro("Laudo não encontrado.", 404);
    return NextResponse.redirect(await urlDownloadPdf(laudo), 303);
  } catch (e) {
    return tratarErro(e);
  }
}
