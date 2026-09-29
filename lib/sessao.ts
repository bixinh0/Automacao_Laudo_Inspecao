import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Departamento, Papel, Situacao } from "./contas";
import { supabase, urlSupabase } from "./supabase";

/**
 * Sessão do usuário (Supabase Auth) guardada em cookie httpOnly, secure,
 * SameSite=Lax. O navegador nunca recebe chave nem token acessível por
 * JavaScript: login, cadastro e troca de senha acontecem no servidor.
 */

export const OPCOES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function chavePublica(): string {
  return (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
}

/** Cliente com a sessão de quem está logado: as consultas passam pela RLS do banco. */
export async function clienteSessao() {
  const loja = await cookies();
  return createServerClient(urlSupabase(), chavePublica(), {
    cookieOptions: OPCOES_COOKIE,
    cookies: {
      getAll: () => loja.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) loja.set(name, value, { ...options, ...OPCOES_COOKIE });
        } catch {
          // Componentes de servidor não gravam cookies; o proxy renova a sessão.
        }
      },
    },
  });
}

/** Cliente descartável, sem guardar sessão: usado só para conferir uma senha. */
export function clienteVerificacao() {
  return createClient(urlSupabase(), chavePublica(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface Perfil {
  id: string;
  nome: string;
  email: string;
  departamento: Departamento;
  papel: Papel;
  situacao: Situacao;
  motivoRecusa: string | null;
  senhaProvisoria: boolean;
  provisoriaExpira: string | null;
  decididoPor: string | null;
  decididoEm: string | null;
  criadoEm: string;
}

export type LinhaPerfil = {
  id: string;
  nome: string;
  email: string;
  departamento: Departamento;
  papel: Papel;
  situacao: Situacao;
  motivo_recusa: string | null;
  senha_provisoria: boolean;
  provisoria_expira: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
  criado_em: string;
};

export function paraPerfil(l: LinhaPerfil): Perfil {
  return {
    id: l.id,
    nome: l.nome,
    email: l.email,
    departamento: l.departamento,
    papel: l.papel,
    situacao: l.situacao,
    motivoRecusa: l.motivo_recusa,
    senhaProvisoria: l.senha_provisoria,
    provisoriaExpira: l.provisoria_expira,
    decididoPor: l.decidido_por,
    decididoEm: l.decidido_em,
    criadoEm: l.criado_em,
  };
}

/** Lê um perfil com a chave do servidor (sem RLS). */
export async function buscarPerfil(id: string): Promise<Perfil | null> {
  const { data, error } = await supabase().from("profiles").select().eq("id", id).maybeSingle<LinhaPerfil>();
  if (error) throw error;
  return data ? paraPerfil(data) : null;
}

export function provisoriaExpirada(p: Pick<Perfil, "senhaProvisoria" | "provisoriaExpira">): boolean {
  return p.senhaProvisoria && p.provisoriaExpira !== null && Date.parse(p.provisoriaExpira) < Date.now();
}

/** Perfil de quem está logado (uma vez por requisição), ou null. */
export const usuarioAtual = cache(async (): Promise<Perfil | null> => {
  const sessao = await clienteSessao();
  const {
    data: { user },
  } = await sessao.auth.getUser();
  if (!user) return null;
  return buscarPerfil(user.id);
});

/** Usuário logado, aprovado e sem troca de senha pendente; senão null. */
export async function usuarioLiberado(): Promise<Perfil | null> {
  const p = await usuarioAtual();
  return p && p.situacao === "APROVADO" && !p.senhaProvisoria ? p : null;
}

/** Usuário liberado com papel OWNER ou ADMIN; senão null. */
export async function gestorLiberado(): Promise<Perfil | null> {
  const p = await usuarioLiberado();
  return p && (p.papel === "OWNER" || p.papel === "ADMIN") ? p : null;
}
