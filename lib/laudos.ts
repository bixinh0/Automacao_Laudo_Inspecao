import "server-only";
import { randomUUID } from "node:crypto";
import { gerarMiniatura, paraDataUrl, processarImagem, sha256 } from "./imagem";
import { acessoOneDrive } from "./integracao";
import { apagarArquivosRascunho } from "./manutencao";
import { enviarArquivo, subpastasDoDia } from "./onedrive";
import { diaLocal, nomesUnicos } from "./pdf/formato";
import { gerarPdfLaudo, type ImagemPdf } from "./pdf/gerar";
import { CODIGO_FORMULARIO, limiteFotos, type TipoImagem } from "./regras";
import { BUCKET, supabase } from "./supabase";

export type StatusLaudo = "RASCUNHO" | "EMITIDO";

export interface Laudo {
  id: string;
  numeroOP: string;
  observacoes: string | null;
  /** Rascunho: quando foi criado. Emitido: quando o PDF foi gerado. */
  criadoEm: string;
  caminhoPdf: string | null;
  /** RASCUNHO enquanto recebe fotos; EMITIDO depois de gerar o PDF (migration 0006). */
  status: StatusLaudo;
  /** Envio ao OneDrive (colunas da migration 0002; ausentes antes dela). */
  onedriveEnviadoEm: string | null;
  onedriveUrl: string | null;
  onedriveErro: string | null;
  /** Quando o PDF foi apagado pela limpeza automática para liberar espaço (migration 0003). */
  pdfRemovidoEm: string | null;
  /** Quem emitiu (migration 0004); nulo nos laudos anteriores à autenticação. */
  criadoPor: string | null;
  criadoPorNome: string | null;
}

export interface Imagem {
  id: string;
  laudoId: string;
  tipo: TipoImagem;
  caminhoArquivo: string;
  /** Hash e dimensões ficam nulos enquanto a foto não chega e não é processada. */
  hashSha256: string | null;
  largura: number | null;
  altura: number | null;
  ordem: number;
  recebidaEm: string | null;
}

/** Foto de um rascunho como a tela de envio a vê. */
export interface FotoRascunho {
  id: string;
  tipo: TipoImagem;
  ordem: number;
  recebida: boolean;
  /** JPEG pequeno em data URL; nulo enquanto a foto não foi processada. */
  miniatura: string | null;
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
  status?: StatusLaudo;
  onedrive_enviado_em?: string | null;
  onedrive_url?: string | null;
  onedrive_erro?: string | null;
  pdf_removido_em?: string | null;
  criado_por?: string | null;
  criado_por_nome?: string | null;
};
type LinhaImagem = {
  id: string;
  laudo_id: string;
  tipo: TipoImagem;
  caminho_arquivo: string;
  hash_sha256: string | null;
  largura: number | null;
  altura: number | null;
  ordem: number;
  recebida_em?: string | null;
};

function paraLaudo(l: LinhaLaudo): Laudo {
  return {
    id: l.id,
    numeroOP: l.numero_op,
    observacoes: l.observacoes,
    criadoEm: l.criado_em,
    caminhoPdf: l.caminho_pdf,
    status: l.status ?? (l.caminho_pdf ? "EMITIDO" : "RASCUNHO"),
    onedriveEnviadoEm: l.onedrive_enviado_em ?? null,
    onedriveUrl: l.onedrive_url ?? null,
    onedriveErro: l.onedrive_erro ?? null,
    pdfRemovidoEm: l.pdf_removido_em ?? null,
    criadoPor: l.criado_por ?? null,
    criadoPorNome: l.criado_por_nome ?? null,
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
    // Antes da migration 0006 toda foto gravada já estava processada.
    recebidaEm: l.recebida_em === undefined ? (l.hash_sha256 ? "" : null) : l.recebida_em,
  };
}

// Organização no bucket:
//   {laudoId}/brutos/{imagemId}          foto como o navegador enviou; apagada ao ser processada
//   {laudoId}/fotos/{imagemId}.jpg       foto processada (rotação, tamanho, JPEG), usada no PDF
//   {laudoId}/miniaturas/{imagemId}.jpg  miniatura mostrada na tela de envio
//   {laudoId}/laudo-OP-{numero}.pdf      o laudo, com as fotos embutidas
// Ao emitir, só o PDF fica: brutos, fotos e miniaturas são apagados.
const caminhoBruto = (laudoId: string, imagemId: string) => `${laudoId}/brutos/${imagemId}`;
const caminhoFoto = (laudoId: string, imagemId: string) => `${laudoId}/fotos/${imagemId}.jpg`;
const caminhoMiniatura = (laudoId: string, imagemId: string) => `${laudoId}/miniaturas/${imagemId}.jpg`;

export function nomeArquivoPdf(numeroOP: string) {
  return `laudo-OP-${numeroOP}.pdf`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidValido = (id: string) => UUID.test(id);

/** Cria o laudo como rascunho assim que a OP é informada; as fotos chegam depois. */
export async function criarRascunho(
  numeroOP: string,
  observacoes: string | null,
  autor: { id: string; nome: string },
): Promise<Laudo> {
  const { data, error } = await supabase()
    .from("laudo")
    .insert({ numero_op: numeroOP, observacoes, status: "RASCUNHO", criado_por: autor.id, criado_por_nome: autor.nome })
    .select()
    .single<LinhaLaudo>();
  if (error) throw error;
  return paraLaudo(data);
}

export async function buscarLaudo(id: string): Promise<Laudo | null> {
  if (!uuidValido(id)) return null;
  const { data, error } = await supabase().from("laudo").select().eq("id", id).maybeSingle<LinhaLaudo>();
  if (error) throw error;
  return data ? paraLaudo(data) : null;
}

/** Rascunho que pertence a `autorId` e ainda aceita mudanças; senão, erro com mensagem para a tela. */
export async function rascunhoDoAutor(id: string, autorId: string): Promise<Laudo> {
  const laudo = await buscarLaudo(id);
  // Rascunho de outra pessoa responde como inexistente: não revela que existe.
  if (!laudo || laudo.criadoPor !== autorId) throw new ErroLaudo("Rascunho não encontrado. Comece um novo laudo.", 404);
  if (laudo.status !== "RASCUNHO" || laudo.caminhoPdf) throw new ErroLaudo("Este laudo já foi emitido.", 409);
  return laudo;
}

export async function atualizarRascunho(
  laudo: Laudo,
  dados: { numeroOP: string; observacoes: string | null },
): Promise<Laudo> {
  const { data, error } = await supabase()
    .from("laudo")
    .update({ numero_op: dados.numeroOP, observacoes: dados.observacoes })
    .eq("id", laudo.id)
    .eq("status", "RASCUNHO")
    .select()
    .maybeSingle<LinhaLaudo>();
  if (error) throw error;
  if (!data) throw new ErroLaudo("Este laudo já foi emitido.", 409);
  return paraLaudo(data);
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

/** Executa `tarefa` para cada item com no máximo `limite` ao mesmo tempo, mantendo a ordem do resultado. */
async function emParalelo<T, R>(itens: T[], limite: number, tarefa: (item: T, indice: number) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (proximo < itens.length) {
        const i = proximo++;
        saida[i] = await tarefa(itens[i], i);
      }
    }),
  );
  return saida;
}

async function lerMiniatura(laudoId: string, imagemId: string): Promise<string | null> {
  const { data, error } = await supabase().storage.from(BUCKET).download(caminhoMiniatura(laudoId, imagemId));
  if (error || !data) return null;
  return paraDataUrl(Buffer.from(await data.arrayBuffer()));
}

/** Fotos do rascunho, na ordem em que foram escolhidas, com a miniatura de cada uma já processada. */
export async function fotosDoRascunho(laudoId: string): Promise<FotoRascunho[]> {
  const imagens = await listarImagens(laudoId);
  return emParalelo(imagens, 6, async (i) => ({
    id: i.id,
    tipo: i.tipo,
    ordem: i.ordem,
    recebida: i.recebidaEm !== null,
    miniatura: i.recebidaEm !== null ? await lerMiniatura(laudoId, i.id) : null,
  }));
}

export interface VagaEnvio {
  id: string;
  tipo: TipoImagem;
  ordem: number;
  /** URL assinada para o navegador enviar a foto direto ao Storage. */
  url: string;
}

/**
 * Reserva `quantidade` fotos no rascunho, na ordem em que foram escolhidas, e
 * devolve uma URL de envio para cada uma. As fotos vão do navegador direto ao
 * Storage, porque a Vercel limita o corpo de uma requisição a 4,5 MB.
 */
export async function reservarImagens(laudoId: string, tipo: TipoImagem, quantidade: number): Promise<VagaEnvio[]> {
  const limite = limiteFotos(tipo);
  for (let tentativa = 1; ; tentativa++) {
    const { data: atuais, error } = await supabase()
      .from("imagem")
      .select("ordem")
      .eq("laudo_id", laudoId)
      .eq("tipo", tipo)
      .returns<{ ordem: number }[]>();
    if (error) throw error;
    if (atuais.length + quantidade > limite) {
      throw new ErroLaudo(
        tipo === "FORMULARIO" ? `No máximo ${limite} folhas do formulário por laudo.` : `No máximo ${limite} fotos das peças por laudo.`,
      );
    }
    const inicio = atuais.reduce((m, a) => Math.max(m, a.ordem), 0) + 1;
    const vagas = Array.from({ length: quantidade }, (_, i) => ({ id: randomUUID(), ordem: inicio + i }));
    const { error: erroReserva } = await supabase()
      .from("imagem")
      .insert(vagas.map((v) => ({ id: v.id, laudo_id: laudoId, tipo, ordem: v.ordem, caminho_arquivo: caminhoBruto(laudoId, v.id) })));
    // Outra aba reservou a mesma ordem ao mesmo tempo: tenta com a próxima livre.
    if (erroReserva?.code === "23505" && tentativa < 4) continue;
    if (erroReserva) throw erroReserva;

    const storage = supabase().storage.from(BUCKET);
    return Promise.all(
      vagas.map(async (v) => {
        const { data, error: erroUrl } = await storage.createSignedUploadUrl(caminhoBruto(laudoId, v.id), { upsert: true });
        if (erroUrl) throw erroUrl;
        return { id: v.id, tipo, ordem: v.ordem, url: data.signedUrl };
      }),
    );
  }
}

async function buscarImagem(laudoId: string, imagemId: string): Promise<Imagem> {
  if (!uuidValido(imagemId)) throw new ErroLaudo("Foto não encontrada.", 404);
  const { data, error } = await supabase()
    .from("imagem")
    .select()
    .eq("id", imagemId)
    .eq("laudo_id", laudoId)
    .maybeSingle<LinhaImagem>();
  if (error) throw error;
  if (!data) throw new ErroLaudo("Foto não encontrada. Ela pode ter sido removida.", 404);
  return paraImagem(data);
}

/**
 * Chamado pelo navegador quando o envio de uma foto termina: corrige a
 * rotação, reduz e comprime (sharp), calcula o SHA-256, grava a foto
 * processada e a miniatura, e vincula tudo à linha da foto no banco.
 * Pode ser repetido sem efeito colateral.
 */
export async function confirmarImagem(laudoId: string, imagemId: string): Promise<FotoRascunho> {
  const imagem = await buscarImagem(laudoId, imagemId);
  const resposta = (miniatura: string | null): FotoRascunho => ({
    id: imagem.id,
    tipo: imagem.tipo,
    ordem: imagem.ordem,
    recebida: true,
    miniatura,
  });
  if (imagem.recebidaEm !== null) return resposta(await lerMiniatura(laudoId, imagemId));

  const storage = supabase().storage.from(BUCKET);
  const { data: bruto, error: erroDownload } = await storage.download(caminhoBruto(laudoId, imagemId));
  if (erroDownload || !bruto) throw new ErroLaudo("A foto não chegou ao servidor. Envie de novo.", 409);

  let processada;
  try {
    processada = await processarImagem(Buffer.from(await bruto.arrayBuffer()), imagem.tipo);
  } catch {
    throw new ErroLaudo("Não foi possível ler esta foto. Remova e envie em JPEG ou PNG.", 422);
  }
  const miniatura = await gerarMiniatura(processada.buffer);
  const arquivos = [caminhoFoto(laudoId, imagemId), caminhoMiniatura(laudoId, imagemId)];
  const envios = await Promise.all([
    storage.upload(arquivos[0], processada.buffer, { contentType: "image/jpeg", upsert: true }),
    storage.upload(arquivos[1], miniatura, { contentType: "image/jpeg", upsert: true }),
  ]);
  const falha = envios.find((e) => e.error)?.error;
  if (falha) throw falha;

  const { data: linhas, error } = await supabase()
    .from("imagem")
    .update({
      caminho_arquivo: arquivos[0],
      hash_sha256: processada.hashSha256,
      largura: processada.largura,
      altura: processada.altura,
      recebida_em: new Date().toISOString(),
    })
    .eq("id", imagemId)
    .eq("laudo_id", laudoId)
    .select("id")
    .returns<{ id: string }[]>();
  if (error) throw error;
  if (!linhas.length) {
    // Removida enquanto era processada: não deixa arquivo órfão.
    await storage.remove([...arquivos, caminhoBruto(laudoId, imagemId)]);
    throw new ErroLaudo("Foto não encontrada. Ela pode ter sido removida.", 404);
  }
  const { error: erroLimpeza } = await storage.remove([caminhoBruto(laudoId, imagemId)]);
  if (erroLimpeza) console.error(`Foto ${imagemId}: original não removido (sai na emissão ou na limpeza):`, erroLimpeza);
  return resposta(paraDataUrl(miniatura));
}

/** Tira a foto do rascunho (banco e arquivos). Remover de novo não dá erro. */
export async function removerImagem(laudoId: string, imagemId: string): Promise<void> {
  if (!uuidValido(imagemId)) throw new ErroLaudo("Foto não encontrada.", 404);
  const { error } = await supabase().from("imagem").delete().eq("id", imagemId).eq("laudo_id", laudoId);
  if (error) throw error;
  const { error: erroArquivos } = await supabase()
    .storage.from(BUCKET)
    .remove([caminhoBruto(laudoId, imagemId), caminhoFoto(laudoId, imagemId), caminhoMiniatura(laudoId, imagemId)]);
  if (erroArquivos) console.error(`Foto ${imagemId}: arquivos não removidos (saem na emissão ou na limpeza):`, erroArquivos);
}

function descrever(tipo: TipoImagem, posicao: number) {
  return tipo === "FORMULARIO" ? `folha ${posicao} do formulário` : `foto ${posicao} das peças`;
}

/**
 * Emite o laudo: junta as fotos já processadas do rascunho, gera o PDF e grava
 * só o PDF no Storage. As fotos ficam embutidas nele; no banco ficam o hash e
 * as dimensões de cada uma. Guardar as fotos à parte dobraria o espaço usado
 * e não caberia no plano gratuito com ~600 laudos por mês.
 *
 * `pedido.imagens` é a lista de fotos que a tela mostra: se o banco tiver
 * outra (mudança em outra aba), nada é emitido.
 */
export async function emitirLaudo(
  laudoId: string,
  autorId: string,
  pedido: { numeroOP: string; observacoes: string | null; imagens: string[] },
): Promise<Laudo> {
  const existente = await buscarLaudo(laudoId);
  if (!existente || existente.criadoPor !== autorId) throw new ErroLaudo("Rascunho não encontrado. Comece um novo laudo.", 404);
  if (existente.caminhoPdf) return existente; // nova tentativa depois de a resposta se perder

  const imagens = await listarImagens(laudoId);
  if (imagens.some((i) => i.recebidaEm === null)) throw new ErroLaudo("Aguarde o envio de todas as fotos terminar.", 409);
  const pedidas = new Set(pedido.imagens);
  if (pedidas.size !== pedido.imagens.length || pedidas.size !== imagens.length || imagens.some((i) => !pedidas.has(i.id))) {
    throw new ErroLaudo("As fotos deste laudo mudaram em outra aba ou aparelho. Recarregue a página para conferir.", 409);
  }
  const formularios = imagens.filter((i) => i.tipo === "FORMULARIO");
  const pecas = imagens.filter((i) => i.tipo === "PECA");
  if (formularios.length < 1) throw new ErroLaudo(`Anexe a foto do formulário ${CODIGO_FORMULARIO}.`);
  if (pecas.length < 1) throw new ErroLaudo("Anexe ao menos uma foto das peças.");

  const storage = supabase().storage.from(BUCKET);
  const baixar = (lista: Imagem[]) =>
    emParalelo(lista, 6, async (img, i): Promise<ImagemPdf> => {
      const faltou = new ErroLaudo(`A ${descrever(img.tipo, i + 1)} não foi encontrada no servidor. Remova-a e envie de novo.`, 409);
      const { data, error } = await storage.download(caminhoFoto(laudoId, img.id));
      if (error || !data) throw faltou;
      const dados = Buffer.from(await data.arrayBuffer());
      if (sha256(dados) !== img.hashSha256) throw faltou;
      return { id: img.id, dados, largura: img.largura!, altura: img.altura! };
    });
  const [paraFormulario, paraPecas] = await Promise.all([baixar(formularios), baixar(pecas)]);

  // A data do laudo (PDF, histórico e ZIP do dia) é a da emissão, não a do rascunho.
  const emitidoEm = new Date();
  const pdf = await gerarPdfLaudo({
    numeroOP: pedido.numeroOP,
    observacoes: pedido.observacoes,
    emitidoEm,
    formularios: paraFormulario,
    pecas: paraPecas,
  });

  const caminho = `${laudoId}/${nomeArquivoPdf(pedido.numeroOP)}`;
  const { error: erroUpload } = await storage.upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (erroUpload) throw erroUpload;

  // caminho_arquivo passa a apontar para o PDF, onde a imagem está embutida.
  const { error: erroImagens } = await supabase().from("imagem").update({ caminho_arquivo: caminho }).eq("laudo_id", laudoId);
  if (erroImagens) throw erroImagens;

  const { data, error } = await supabase()
    .from("laudo")
    .update({
      numero_op: pedido.numeroOP,
      observacoes: pedido.observacoes,
      caminho_pdf: caminho,
      status: "EMITIDO",
      criado_em: emitidoEm.toISOString(),
    })
    .eq("id", laudoId)
    .eq("status", "RASCUNHO")
    .select()
    .maybeSingle<LinhaLaudo>();
  if (error) throw error;

  await apagarArquivosRascunho(laudoId);
  // Sem linha: outra requisição emitiu este laudo no meio do caminho; vale a dela.
  return data ? paraLaudo(data) : ((await buscarLaudo(laudoId)) as Laudo);
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
