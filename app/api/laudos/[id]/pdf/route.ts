import { after, NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { buscarLaudo, emitirLaudo, enviarLaudoAoOneDrive, urlDownloadPdf } from "@/lib/laudos";
import { limparArmazenamento } from "@/lib/manutencao";
import { configOneDrive } from "@/lib/onedrive";
import { MAX_FOLHAS_FORMULARIO, MAX_FOTOS_PECAS } from "@/lib/regras";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Processa as fotos já enviadas ao Storage e gera o PDF do laudo. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const corpo = await lerJson(req);
  const formularios = Number(corpo.formularios);
  const pecas = Number(corpo.pecas);
  if (
    !Number.isInteger(formularios) ||
    !Number.isInteger(pecas) ||
    formularios > MAX_FOLHAS_FORMULARIO ||
    pecas > MAX_FOTOS_PECAS
  ) {
    return erro("Quantidade de fotos inválida.");
  }

  try {
    const laudo = await emitirLaudo(id, { formularios, pecas });
    // Depois da resposta, sem atrasar a confirmação na tela: cópia para o OneDrive
    // (se configurado) e só então a limpeza, que pode apagar PDFs antigos.
    after(async () => {
      if (configOneDrive() && !laudo.onedriveEnviadoEm) await enviarLaudoAoOneDrive(laudo.id);
      await limparArmazenamento();
    });
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
