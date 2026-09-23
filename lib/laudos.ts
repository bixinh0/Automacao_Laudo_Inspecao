import "server-only";
import { processarImagem } from "./imagem";
import { acessoOneDrive } from "./integracao";
import { enviarArquivo, subpastasDoDia } from "./onedrive";
import { diaLocal, nomesUnicos } from "./pdf/formato";
import { gerarPdfLaudo, type ImagemPdf } from "./pdf/gerar";
import type { TipoImagem } from "./regras";
import { BUCKET, supabase } from "./supabase";

export interface Laudo {
  id: string;
  numeroOP: string;
  observacoes: string | null;
  criadoEm: string;
  caminhoPdf: string | null;
  /** Envio ao OneDrive (colunas da migration 0002; ausentes antes dela). */
  onedriveEnviadoEm: string | null;
  onedriveUrl: string | null;
  onedriveErro: string | null;
  /** Quando o PDF foi apagado pela limpeza automática para liberar espaço (migration 0003). */
  pdfRemovidoEm: string | null;
}

export interface Imagem {
  id: string;
  laudoId: string;
  tipo: TipoImagem;
  caminhoArquivo: string;
  hashSha256: string;
  largura: number;
  altura: number;
  ordem: number;
}

/** Erro com mensagem que pode ser mostrada ao usuário e código HTTP. */
export class ErroLaudo extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type LinhaLaudo = {
  id: string;
  numero_op: string;
  observacoes: string | null;
  criado_em: string;
  caminho_pdf: string | null;
  onedrive_enviado_em?: string | null;
  onedrive_url?: string | null;
  onedrive_erro?: string | null;
  pdf_removido_em?: string | null;
};
type LinhaImagem = {
  id: string;
  laudo_id: string;
  tipo: TipoImagem;
  caminho_arquivo: string;
  hash_sha256: string;
  largura: number;
  altura: number;
  ordem: number;
};

function paraLaudo(l: LinhaLaudo): Laudo {
  return {
    id: l.id,
    numeroOP: l.numero_op,
    observacoes: l.observacoes,
    criadoEm: l.criado_em,
    caminhoPdf: l.caminho_pdf,
    onedriveEnviadoEm: l.onedrive_enviado_em ?? null,
    onedriveUrl: l.onedrive_url ?? null,
    onedriveErro: l.onedrive_erro ?? null,
    pdfRemovidoEm: l.pdf_removido_em ?? null,
  };
}

function paraImagem(l: LinhaImagem): Imagem {
  return {
    id: l.id,
    laudoId: l.laudo_id,
    tipo: l.tipo,
    caminhoArquivo: l.caminho_arquivo,
    hashSha256: l.hash_sha256,
    largura: l.largura,
    altura: l.altura,
    ordem: l.ordem,
  };
}

// Organização no bucket:
//   {laudoId}/brutos/{TIPO}-{ordem}          foto enviada pelo navegador, apagada ao gerar o PDF
//   {laudoId}/laudo-OP-{numero}.pdf          o laudo, com as fotos embutidas
function caminhoBruto(laudoId: string, tipo: TipoImagem, ordem: number) {
  return `${laudoId}/brutos/${tipo}-${ordem}`;
}

export function nomeArquivoPdf(numeroOP: string) {
  return `laudo-OP-${numeroOP}.pdf`;
}

export async function criarLaudo(numeroOP: string, observacoes: string | null): Promise<Laudo> {
  const { data, error } = await supabase()
    .from("laudo")
    .insert({ numero_op: numeroOP, observacoes })
    .select()
    .single<LinhaLaudo>();
  if (error) throw error;
  return paraLaudo(data);
}

export async function buscarLaudo(id: string): Promise<Laudo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase().from("laudo").select().eq("id", id).maybeSingle<LinhaLaudo>();
  if (error) throw error;
  return data ? paraLaudo(data) : null;
}

/** Laudos emitidos (com PDF), do mais recente ao mais antigo. */
export async function listarLaudos(buscaOP?: string, limite = 100): Promise<Laudo[]> {
  let consulta = supabase()
    .from("laudo")
    .select()
    .not("caminho_pdf", "is", null)
    .order("criado_em", { ascending: false })
    .limit(limite);
  const digitos = (buscaOP ?? "").replace(/\D/g, "");
  if (digitos) consulta = consulta.like("numero_op", `%${digitos}%`);
  const { data, error } = await consulta.returns<LinhaLaudo[]>();
  if (error) throw error;
  return data.map(paraLaudo);
}

export async function listarImagens(laudoId: string): Promise<Imagem[]> {
  const { data, error } = await supabase()
    .from("imagem")
    .select()
    .eq("laudo_id", laudoId)
    .order("tipo")
    .order("ordem")
    .returns<LinhaImagem[]>();
  if (error) throw error;
  return data.map(paraImagem);
}

/** URL para o navegador enviar a foto direto ao Storage (sem passar pelo servidor). */
export async function criarUrlEnvio(laudoId: string, tipo: TipoImagem, ordem: number): Promise<string> {
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUploadUrl(caminhoBruto(laudoId, tipo, ordem), { upsert: true });
  if (error) throw error;
  return data.signedUrl;
}

type Item = { tipo: TipoImagem; ordem: number };

function descrever(item: Item) {
  return item.tipo === "FORMULARIO" ? `folha ${item.ordem} do formulário` : `foto ${item.ordem} das peças`;
}

/** Executa `tarefa` para cada item com no máximo `limite` ao mesmo tempo, mantendo a ordem do resultado. */
async function emParalelo<T, R>(itens: T[], limite: number, tarefa: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (proximo < itens.length) {
        const i = proximo++;
        saida[i] = await tarefa(itens[i]);
      }
    }),
  );
  return saida;
}

/**
 * Monta o laudo: baixa as fotos que o navegador enviou, corrige rotação,
 * reduz e comprime (sharp), calcula o SHA-256 de cada uma, gera o PDF e grava
 * só o PDF no Storage. As fotos ficam embutidas nele; no banco ficam o hash e
 * as dimensões de cada uma. Guardar as fotos à parte dobraria o espaço usado
 * e não caberia no plano gratuito com ~600 laudos por mês.
 *
 * `esperado` (enviado pelo navegador) garante que nenhuma foto ficou para trás.
 */
export async function emitirLaudo(laudoId: string, esperado: { formularios: number; pecas: number }): Promise<Laudo> {
  const existente = await buscarLaudo(laudoId);
  if (!existente) throw new ErroLaudo("Laudo não encontrado.", 404);
  if (existente.caminhoPdf) return existente;
  if (esperado.formularios < 1 || esperado.pecas < 1) {
    throw new ErroLaudo("O laudo precisa de ao menos uma foto do formulário e uma foto das peças.");
  }

  const itens: Item[] = [
    ...Array.from({ length: esperado.formularios }, (_, i) => ({ tipo: "FORMULARIO" as const, ordem: i + 1 })),
    ...Array.from({ length: esperado.pecas }, (_, i) => ({ tipo: "PECA" as const, ordem: i + 1 })),
  ];
  const storage = supabase().storage.from(BUCKET);

  const brutos = await emParalelo(itens, 6, async (item) => {
    const { data, error } = await storage.download(caminhoBruto(laudoId, item.tipo, item.ordem));
    if (error || !data) throw new ErroLaudo(`A ${descrever(item)} não chegou ao servidor. Toque em Tentar novamente.`, 409);
    return Buffer.from(await data.arrayBuffer());
  });

  // Duas por vez: o sharp já usa vários núcleos, e assim a memória fica sob controle.
  const processadas = await emParalelo(itens, 2, async (item) => {
    try {
      return await processarImagem(brutos[itens.indexOf(item)], item.tipo);
    } catch {
      throw new ErroLaudo(`Não foi possível ler a ${descrever(item)}. Envie em JPEG ou PNG.`, 422);
    }
  });

  const paraPdf = (tipo: TipoImagem): ImagemPdf[] =>
    itens.flatMap((item, i) =>
      item.tipo === tipo
        ? [{ id: `${tipo}-${item.ordem}`, dados: processadas[i].buffer, largura: processadas[i].largura, altura: processadas[i].altura }]
        : [],
    );
  const pdf = await gerarPdfLaudo({
    numeroOP: existente.numeroOP,
    observacoes: existente.observacoes,
    emitidoEm: new Date(),
    formularios: paraPdf("FORMULARIO"),
    pecas: paraPdf("PECA"),
  });

  const caminho = `${laudoId}/${nomeArquivoPdf(existente.numeroOP)}`;
  const { error: erroUpload } = await storage.upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (erroUpload) throw erroUpload;

  // caminho_arquivo aponta para o PDF, onde a imagem está embutida.
  const { error: erroImagens } = await supabase()
    .from("imagem")
    .upsert(
      itens.map((item, i) => ({
        laudo_id: laudoId,
        tipo: item.tipo,
        ordem: item.ordem,
        caminho_arquivo: caminho,
        hash_sha256: processadas[i].hashSha256,
        largura: processadas[i].largura,
        altura: processadas[i].altura,
      })),
      { onConflict: "laudo_id,tipo,ordem" },
    );
  if (erroImagens) throw erroImagens;

  const { data, error } = await supabase()
    .from("laudo")
    .update({ caminho_pdf: caminho })
    .eq("id", laudoId)
    .select()
    .single<LinhaLaudo>();
  if (error) throw error;

  const { error: erroLimpeza } = await storage.remove(itens.map((item) => caminhoBruto(laudoId, item.tipo, item.ordem)));
  if (erroLimpeza) console.error(`Laudo ${laudoId}: fotos brutas não removidas (a limpeza automática tenta de novo):`, erroLimpeza);
  return paraLaudo(data);
}

/** Laudos emitidos num dia (AAAA-MM-DD, fuso da fábrica), do mais antigo ao mais novo. */
export async function listarLaudosDoDia(dia: string): Promise<Laudo[]> {
  // Busca uma janela folgada em UTC e filtra pelo dia local, sem depender do fuso.
  const meiaNoiteUtc = Date.parse(`${dia}T00:00:00Z`);
  const { data, error } = await supabase()
    .from("laudo")
    .select()
    .not("caminho_pdf", "is", null)
    .gte("criado_em", new Date(meiaNoiteUtc - 86400000).toISOString())
    .lt("criado_em", new Date(meiaNoiteUtc + 2 * 86400000).toISOString())
    .order("criado_em", { ascending: true })
    .returns<LinhaLaudo[]>();
  if (error) throw error;
  return data.map(paraLaudo).filter((l) => !l.pdfRemovidoEm && diaLocal(new Date(l.criadoEm)) === dia);
}

/** Links temporários (10 min) para o navegador baixar vários PDFs e montar o ZIP. */
export async function linksParaZip(laudos: Laudo[]): Promise<{ nome: string; url: string }[]> {
  if (laudos.length === 0) return [];
  const caminhos = laudos.map((l) => l.caminhoPdf!);
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls(caminhos, 600);
  if (error) throw error;
  const nomes = nomesUnicos(laudos.map((l) => nomeArquivoPdf(l.numeroOP)));
  return data.map((d, i) => {
    if (!d.signedUrl) throw new Error(`PDF não encontrado: ${caminhos[i]}`);
    return { nome: nomes[i], url: d.signedUrl };
  });
}

/** Validade do link de download do PDF gerado a cada clique em "Baixar PDF". */
export const VALIDADE_DOWNLOAD_S = 24 * 60 * 60;

/** Link temporário (24 h) para baixar o PDF do laudo. */
export async function urlDownloadPdf(laudo: Laudo): Promise<string> {
  if (!laudo.caminhoPdf) throw new ErroLaudo("O PDF deste laudo ainda não foi gerado.", 404);
  if (laudo.pdfRemovidoEm) {
    throw new ErroLaudo("O PDF deste laudo foi removido para liberar espaço. A cópia está no drive (ZIP do dia).", 410);
  }
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrl(laudo.caminhoPdf, VALIDADE_DOWNLOAD_S, { download: nomeArquivoPdf(laudo.numeroOP) });
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Copia o PDF do laudo para o OneDrive/SharePoint, em {ano}/{mês}/{dd-mm}.
 * Registra o resultado no laudo; nunca lança erro (a falha fica em onedrive_erro).
 */
export async function enviarLaudoAoOneDrive(laudoId: string): Promise<boolean> {
  const laudo = await buscarLaudo(laudoId);
  if (!laudo?.caminhoPdf || laudo.pdfRemovidoEm || laudo.onedriveEnviadoEm) return Boolean(laudo?.onedriveEnviadoEm);
  try {
    const { data, error } = await supabase().storage.from(BUCKET).download(laudo.caminhoPdf);
    if (error || !data) throw error ?? new Error("PDF não encontrado no Storage.");
    const { token, raiz } = await acessoOneDrive();
    const url = await enviarArquivo(
      token,
      raiz,
      subpastasDoDia(new Date(laudo.criadoEm)),
      nomeArquivoPdf(laudo.numeroOP),
      Buffer.from(await data.arrayBuffer()),
    );
    await supabase()
      .from("laudo")
      .update({ onedrive_enviado_em: new Date().toISOString(), onedrive_url: url, onedrive_erro: null })
      .eq("id", laudoId);
    return true;
  } catch (e) {
    const motivo = (e as { message?: string })?.message ?? String(e);
    console.error(`OneDrive: falha ao enviar o laudo ${laudoId}:`, e);
    await supabase().from("laudo").update({ onedrive_erro: motivo.slice(0, 500) }).eq("id", laudoId);
    return false;
  }
}

/** Laudos emitidos ainda não copiados para o OneDrive, do mais antigo ao mais novo. */
export async function listarPendentesOneDrive(limite = 200): Promise<Laudo[]> {
  const { data, error } = await supabase()
    .from("laudo")
    .select()
    .not("caminho_pdf", "is", null)
    .is("onedrive_enviado_em", null)
    .order("criado_em", { ascending: true })
    .limit(limite)
    .returns<LinhaLaudo[]>();
  if (error) throw error;
  return data.map(paraLaudo);
}
