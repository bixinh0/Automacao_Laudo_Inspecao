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
//   {laudoId}/brutos/{TIPO}-{ordem}          foto original, apagada após o processamento
//   {laudoId}/imagens/formulario-01.jpg      foto processada
//   {laudoId}/imagens/peca-001.jpg
//   {laudoId}/laudo-OP-{numero}.pdf
function caminhoBruto(laudoId: string, tipo: TipoImagem, ordem: number) {
  return `${laudoId}/brutos/${tipo}-${ordem}`;
}

function caminhoProcessado(laudoId: string, tipo: TipoImagem, ordem: number) {
  return tipo === "FORMULARIO"
    ? `${laudoId}/imagens/formulario-${String(ordem).padStart(2, "0")}.jpg`
    : `${laudoId}/imagens/peca-${String(ordem).padStart(3, "0")}.jpg`;
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

/** URL para o navegador enviar a foto original direto ao Storage (sem passar pelo servidor). */
export async function criarUrlEnvio(laudoId: string, tipo: TipoImagem, ordem: number): Promise<string> {
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUploadUrl(caminhoBruto(laudoId, tipo, ordem), { upsert: true });
  if (error) throw error;
  return data.signedUrl;
}

async function laudoEmAberto(laudoId: string): Promise<Laudo> {
  const laudo = await buscarLaudo(laudoId);
  if (!laudo) throw new ErroLaudo("Laudo não encontrado.", 404);
  if (laudo.caminhoPdf) throw new ErroLaudo("Este laudo já foi emitido e não pode ser alterado.", 409);
  return laudo;
}

/**
 * Processa uma foto já enviada ao Storage: corrige rotação, reduz, comprime,
 * calcula o SHA-256, grava a versão final e registra os metadados no banco.
 * Idempotente: repetir a chamada depois de um sucesso devolve o registro existente.
 */
export async function processarImagemEnviada(laudoId: string, tipo: TipoImagem, ordem: number): Promise<Imagem> {
  await laudoEmAberto(laudoId);
  const storage = supabase().storage.from(BUCKET);
  const bruto = caminhoBruto(laudoId, tipo, ordem);

  const { data: arquivo, error: erroDownload } = await storage.download(bruto);
  if (erroDownload || !arquivo) {
    const { data: existente } = await supabase()
      .from("imagem")
      .select()
      .match({ laudo_id: laudoId, tipo, ordem })
      .maybeSingle<LinhaImagem>();
    if (existente) return paraImagem(existente);
    throw new ErroLaudo("A foto não chegou ao servidor. Tente enviar novamente.", 400);
  }

  let processada;
  try {
    processada = await processarImagem(Buffer.from(await arquivo.arrayBuffer()), tipo);
  } catch {
    throw new ErroLaudo("Não foi possível ler uma das fotos. Envie em JPEG ou PNG.", 422);
  }

  const destino = caminhoProcessado(laudoId, tipo, ordem);
  const { error: erroUpload } = await storage.upload(destino, processada.buffer, { contentType: "image/jpeg", upsert: true });
  if (erroUpload) throw erroUpload;

  const { data, error } = await supabase()
    .from("imagem")
    .upsert(
      {
        laudo_id: laudoId,
        tipo,
        caminho_arquivo: destino,
        hash_sha256: processada.hashSha256,
        largura: processada.largura,
        altura: processada.altura,
        ordem,
      },
      { onConflict: "laudo_id,tipo,ordem" },
    )
    .select()
    .single<LinhaImagem>();
  if (error) throw error;

  await storage.remove([bruto]);
  return paraImagem(data);
}

async function baixarEmParalelo(imagens: Imagem[], simultaneos = 6): Promise<ImagemPdf[]> {
  const storage = supabase().storage.from(BUCKET);
  const saida: ImagemPdf[] = new Array(imagens.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(simultaneos, imagens.length) }, async () => {
      while (proximo < imagens.length) {
        const i = proximo++;
        const img = imagens[i];
        const { data, error } = await storage.download(img.caminhoArquivo);
        if (error || !data) throw error ?? new Error(`Falha ao baixar ${img.caminhoArquivo}`);
        saida[i] = { id: img.id, dados: Buffer.from(await data.arrayBuffer()), largura: img.largura, altura: img.altura };
      }
    }),
  );
  return saida;
}

/**
 * Monta o PDF com as imagens já processadas e grava no Storage.
 * `esperado` protege contra gerar um laudo com fotos faltando.
 */
export async function emitirLaudo(laudoId: string, esperado: { formularios: number; pecas: number }): Promise<Laudo> {
  const existente = await buscarLaudo(laudoId);
  if (!existente) throw new ErroLaudo("Laudo não encontrado.", 404);
  if (existente.caminhoPdf) return existente;

  const imagens = await listarImagens(laudoId);
  const formularios = imagens.filter((i) => i.tipo === "FORMULARIO");
  const pecas = imagens.filter((i) => i.tipo === "PECA");
  if (formularios.length === 0 || pecas.length === 0) {
    throw new ErroLaudo("O laudo precisa de ao menos uma foto do formulário e uma foto das peças.");
  }
  if (formularios.length !== esperado.formularios || pecas.length !== esperado.pecas) {
    throw new ErroLaudo("Nem todas as fotos foram processadas. Tente enviar novamente.", 409);
  }

  const [dadosFormularios, dadosPecas] = await Promise.all([baixarEmParalelo(formularios), baixarEmParalelo(pecas)]);
  const pdf = await gerarPdfLaudo({
    numeroOP: existente.numeroOP,
    observacoes: existente.observacoes,
    emitidoEm: new Date(),
    formularios: dadosFormularios,
    pecas: dadosPecas,
  });

  const caminho = `${laudoId}/${nomeArquivoPdf(existente.numeroOP)}`;
  const storage = supabase().storage.from(BUCKET);
  const { error: erroUpload } = await storage.upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (erroUpload) throw erroUpload;

  const { data, error } = await supabase()
    .from("laudo")
    .update({ caminho_pdf: caminho })
    .eq("id", laudoId)
    .select()
    .single<LinhaLaudo>();
  if (error) throw error;
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
  return data.map(paraLaudo).filter((l) => diaLocal(new Date(l.criadoEm)) === dia);
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
  if (!laudo?.caminhoPdf || laudo.onedriveEnviadoEm) return Boolean(laudo?.onedriveEnviadoEm);
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
