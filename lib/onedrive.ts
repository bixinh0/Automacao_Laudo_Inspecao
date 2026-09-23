/**
 * Envio dos laudos para uma pasta do OneDrive/SharePoint via Microsoft Graph.
 *
 * Autorização delegada (OAuth 2.0, "authorization code"): uma pessoa com
 * acesso à pasta clica em "Conectar OneDrive" uma vez; o servidor guarda o
 * refresh token (cifrado, ver lib/integracao.ts) e o renova a cada uso.
 * A senha da conta Microsoft nunca passa pelo sistema.
 *
 * A pasta de destino é informada pelo link dela (SharePoint → "Copiar link")
 * na variável ONEDRIVE_PASTA_LINK. Dentro dela, o laudo vai para
 * {ano}/{mês por extenso}/{dd-mm}/laudo-OP-{numero}.pdf, criando as pastas
 * que faltarem.
 */

import { diaLocal, pastaDoDia } from "./pdf/formato";

const GRAPH = "https://graph.microsoft.com/v1.0";
export const ESCOPOS = "offline_access User.Read Files.ReadWrite.All";
/** Cookie que liga o pedido de autorização à resposta da Microsoft (proteção contra CSRF). */
export const COOKIE_ESTADO = "onedrive_estado";

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export class ErroOneDrive extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface ConfigOneDrive {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  pastaLink: string;
}

export function configOneDrive(): ConfigOneDrive | null {
  const tenantId = (process.env.MS_TENANT_ID ?? "").trim();
  const clientId = (process.env.MS_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.MS_CLIENT_SECRET ?? "").trim();
  const pastaLink = (process.env.ONEDRIVE_PASTA_LINK ?? "").trim();
  if (!tenantId || !clientId || !clientSecret || !pastaLink) return null;
  return { tenantId, clientId, clientSecret, pastaLink };
}

/** Subpastas do laudo, na data e fuso da fábrica: ["2026", "Setembro", "23-09"]. */
export function subpastasDoDia(data: Date): string[] {
  const dia = diaLocal(data);
  const [ano, mes] = dia.split("-");
  return [ano, MESES[Number(mes) - 1], pastaDoDia(dia)];
}

// ---------- OAuth ----------

function urlLogin(cfg: ConfigOneDrive, caminho: string) {
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/${caminho}`;
}

export function urlAutorizacao(cfg: ConfigOneDrive, redirectUri: string, state: string): string {
  const url = new URL(urlLogin(cfg, "authorize"));
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: ESCOPOS,
    state,
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiraEm: number;
}

async function pedirToken(cfg: ConfigOneDrive, parametros: Record<string, string>): Promise<Tokens> {
  const resposta = await fetch(urlLogin(cfg, "token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: ESCOPOS, ...parametros }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !dados.access_token) {
    const motivo = String(dados.error_description ?? dados.error ?? `HTTP ${resposta.status}`).split("\r\n")[0];
    throw new ErroOneDrive(`A Microsoft recusou a autorização: ${motivo}`, resposta.status);
  }
  return {
    accessToken: dados.access_token,
    refreshToken: dados.refresh_token ?? parametros.refresh_token,
    expiraEm: Date.now() + (Number(dados.expires_in) || 3600) * 1000,
  };
}

export function trocarCodigo(cfg: ConfigOneDrive, code: string, redirectUri: string) {
  return pedirToken(cfg, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function renovarToken(cfg: ConfigOneDrive, refreshToken: string) {
  return pedirToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });
}

// ---------- Graph ----------

async function graph<T>(token: string, caminho: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`${GRAPH}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new ErroOneDrive(dados?.error?.message ?? `Microsoft Graph respondeu HTTP ${resposta.status}`, resposta.status);
  }
  return dados as T;
}

export async function contaConectada(token: string): Promise<string> {
  const eu = await graph<{ displayName?: string; userPrincipalName?: string; mail?: string }>(
    token,
    "/me?$select=displayName,userPrincipalName,mail",
  );
  return [eu.displayName, eu.mail ?? eu.userPrincipalName].filter(Boolean).join(" · ");
}

export interface Pasta {
  driveId: string;
  itemId: string;
}

/** Converte o link da pasta (SharePoint/OneDrive) no identificador usado pelo Graph. */
export async function resolverPasta(token: string, link: string): Promise<Pasta> {
  const codigo = "u!" + Buffer.from(link).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const item = await graph<{ id: string; folder?: unknown; parentReference?: { driveId?: string } }>(
    token,
    `/shares/${codigo}/driveItem?$select=id,folder,parentReference`,
  ).catch((e) => {
    throw new ErroOneDrive(`Não foi possível abrir a pasta do link ONEDRIVE_PASTA_LINK: ${e.message}`, e.status);
  });
  if (!item.folder || !item.parentReference?.driveId) {
    throw new ErroOneDrive("O link em ONEDRIVE_PASTA_LINK não é de uma pasta.");
  }
  return { driveId: item.parentReference.driveId, itemId: item.id };
}

function caminhoItem(pasta: Pasta, nome: string) {
  return `/drives/${pasta.driveId}/items/${pasta.itemId}:/${encodeURIComponent(nome)}:`;
}

/** Devolve a subpasta com esse nome, criando se não existir. Nomes não diferenciam maiúsculas. */
export async function garantirSubpasta(token: string, pai: Pasta, nome: string): Promise<Pasta> {
  const buscar = () => graph<{ id: string }>(token, `${caminhoItem(pai, nome)}?$select=id`);
  try {
    return { driveId: pai.driveId, itemId: (await buscar()).id };
  } catch (e) {
    if (!(e instanceof ErroOneDrive) || e.status !== 404) throw e;
  }
  try {
    const criada = await graph<{ id: string }>(token, `/drives/${pai.driveId}/items/${pai.itemId}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    return { driveId: pai.driveId, itemId: criada.id };
  } catch (e) {
    // Outro envio simultâneo criou a mesma pasta.
    if (e instanceof ErroOneDrive && e.status === 409) return { driveId: pai.driveId, itemId: (await buscar()).id };
    throw e;
  }
}

/**
 * Grava o arquivo em {raiz}/{subpastas...}/{nome}. Se já existir um arquivo com
 * o mesmo nome (outro laudo da mesma OP no mesmo dia), a Microsoft acrescenta
 * um número ao nome em vez de sobrescrever. Devolve o endereço web do arquivo.
 */
export async function enviarArquivo(
  token: string,
  raiz: Pasta,
  subpastas: string[],
  nome: string,
  dados: Buffer,
): Promise<string> {
  let pasta = raiz;
  for (const nomePasta of subpastas) pasta = await garantirSubpasta(token, pasta, nomePasta);
  const item = await graph<{ webUrl: string }>(
    token,
    `${caminhoItem(pasta, nome)}/content?@microsoft.graph.conflictBehavior=rename`,
    { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(dados) },
  );
  return item.webUrl;
}
