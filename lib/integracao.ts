import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  configOneDrive,
  contaConectada,
  ErroOneDrive,
  renovarToken,
  resolverPasta,
  type ConfigOneDrive,
  type Pasta,
  type Tokens,
} from "./onedrive";
import { supabase } from "./supabase";

const CHAVE_TOKEN = "onedrive_refresh_token";
const CHAVE_CONTA = "onedrive_conta";

// O refresh token é cifrado (AES-256-GCM) com chave derivada do segredo do app
// Microsoft: quem ler só o banco não consegue usá-lo.
function chaveCifra(cfg: ConfigOneDrive) {
  return createHash("sha256").update(`laudo-inspecao:onedrive:${cfg.clientSecret}`).digest();
}

export function cifrar(texto: string, cfg: ConfigOneDrive): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveCifra(cfg), iv);
  const dados = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return [iv, cifra.getAuthTag(), dados].map((b) => b.toString("base64")).join(".");
}

export function decifrar(valor: string, cfg: ConfigOneDrive): string {
  const [iv, tag, dados] = valor.split(".").map((p) => Buffer.from(p, "base64"));
  const decifra = createDecipheriv("aes-256-gcm", chaveCifra(cfg), iv);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(dados), decifra.final()]).toString("utf8");
}

async function ler(chave: string): Promise<string | null> {
  const { data, error } = await supabase().from("integracao").select("valor").eq("chave", chave).maybeSingle<{ valor: string }>();
  if (error) throw error;
  return data?.valor ?? null;
}

async function gravar(chave: string, valor: string) {
  const { error } = await supabase()
    .from("integracao")
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  if (error) throw error;
}

export interface EstadoOneDrive {
  configurado: boolean;
  conectado: boolean;
  conta: string | null;
}

export async function estadoOneDrive(): Promise<EstadoOneDrive> {
  if (!configOneDrive()) return { configurado: false, conectado: false, conta: null };
  const [token, conta] = await Promise.all([ler(CHAVE_TOKEN), ler(CHAVE_CONTA)]);
  return { configurado: true, conectado: Boolean(token), conta };
}

// Token de acesso em memória: vale ~1 h e é reaproveitado entre chamadas da mesma instância.
let emCache: { accessToken: string; expiraEm: number } | null = null;
let pastaEmCache: Pasta | null = null;

export async function salvarConexao(tokens: Tokens) {
  const cfg = configOneDrive();
  if (!cfg) throw new ErroOneDrive("OneDrive não configurado.");
  await gravar(CHAVE_TOKEN, cifrar(tokens.refreshToken, cfg));
  await gravar(CHAVE_CONTA, await contaConectada(tokens.accessToken));
  emCache = { accessToken: tokens.accessToken, expiraEm: tokens.expiraEm };
  pastaEmCache = null;
}

export async function desconectar() {
  const { error } = await supabase().from("integracao").delete().in("chave", [CHAVE_TOKEN, CHAVE_CONTA]);
  if (error) throw error;
  emCache = null;
  pastaEmCache = null;
}

/** Token de acesso válido e pasta raiz de destino. */
export async function acessoOneDrive(): Promise<{ token: string; raiz: Pasta }> {
  const cfg = configOneDrive();
  if (!cfg) throw new ErroOneDrive("OneDrive não configurado.");
  if (!emCache || emCache.expiraEm - Date.now() < 5 * 60 * 1000) {
    const guardado = await ler(CHAVE_TOKEN);
    if (!guardado) throw new ErroOneDrive("OneDrive não conectado. Abra Histórico → OneDrive e clique em Conectar.");
    let refresh: string;
    try {
      refresh = decifrar(guardado, cfg);
    } catch {
      throw new ErroOneDrive("Conexão com o OneDrive inválida (o segredo do app mudou?). Conecte novamente.");
    }
    const novos = await renovarToken(cfg, refresh);
    if (novos.refreshToken !== refresh) await gravar(CHAVE_TOKEN, cifrar(novos.refreshToken, cfg));
    emCache = { accessToken: novos.accessToken, expiraEm: novos.expiraEm };
  }
  pastaEmCache ??= await resolverPasta(emCache.accessToken, cfg.pastaLink);
  return { token: emCache.accessToken, raiz: pastaEmCache };
}
