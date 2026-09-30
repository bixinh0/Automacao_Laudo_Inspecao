import { after, NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { buscarLaudo, emitirLaudo, enviarLaudoAoOneDrive, urlDownloadPdf } from "@/lib/laudos";
import { limparArmazenamento } from "@/lib/manutencao";
import { configOneDrive } from "@/lib/onedrive";
import { lerDadosLaudo } from "@/lib/regras";
import { usuarioLiberado } from "@/lib/sessao";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Emite o laudo: junta as fotos já processadas do rascunho e gera o PDF. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const corpo = await lerJson(req);
  const dados = lerDadosLaudo(corpo);
  if ("erro" in dados) return erro(dados.erro);
  const imagens = Array.isArray(corpo.imagens) ? corpo.imagens.map(String) : null;
  if (!imagens) return erro("Lista de fotos inválida.");
  const autor = await usuarioLiberado();
  if (!autor) return erro("Sessão expirada. Entre novamente.", 401);

  try {
    const laudo = await emitirLaudo(id, autor.id, { ...dados, imagens });
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
