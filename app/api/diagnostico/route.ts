import { NextResponse } from "next/server";
import { explicarErroConfiguracao } from "@/lib/api";
import { podeGerenciar } from "@/lib/permissoes";
import { chavePublica, usuarioLiberado } from "@/lib/sessao";
import { BUCKET, supabase, urlSupabase } from "@/lib/supabase";
import { dominioPermitido } from "@/lib/usuarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Resultado = { ok: boolean; detalhe: string };

function falha(e: unknown): Resultado {
  const x = e as { message?: string; code?: string };
  return { ok: false, detalhe: explicarErroConfiguracao(e) ?? `${x?.message ?? String(e)}${x?.code ? ` [${x.code}]` : ""}` };
}

/**
 * Confere a configuração sem expor segredos: abra /api/diagnostico no navegador.
 */
export async function GET() {
  const eu = await usuarioLiberado();
  if (!eu || !podeGerenciar(eu)) return NextResponse.json({ erro: "Apenas OWNER e ADMIN." }, { status: 403 });

  const url = urlSupabase();
  const chave = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const tipoChave = !chave
    ? "ausente"
    : chave.startsWith("sb_secret_")
      ? "chave secreta (sb_secret_…)"
      : chave.startsWith("sb_publishable_")
        ? "ERRADA: é a chave publicável; use a chave secreta"
        : chave.startsWith("eyJ")
          ? "JWT (service_role ou anon)"
          : "formato desconhecido";

  const resultado: Record<string, unknown> = {
    variaveis: {
      SUPABASE_URL: url || "ausente",
      SUPABASE_SECRET_KEY: tipoChave,
      SUPABASE_PUBLISHABLE_KEY: chavePublica() ? "definida" : "ausente",
      ALLOWED_EMAIL_DOMAIN: dominioPermitido() || "ausente",
      OWNER_EMAIL: process.env.OWNER_EMAIL ? "definido" : "ausente",
    },
  };

  if (!url || !chave) {
    resultado.conclusao = "Defina SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel (Settings → Environment Variables) e faça Redeploy.";
    return NextResponse.json(resultado, { status: 500 });
  }

  const checagens: Record<string, Resultado> = {};
  for (const tabela of ["laudo", "imagem", "profiles", "log_auditoria", "tentativas_login"]) {
    try {
      const { error } = await supabase().from(tabela).select("id").limit(1);
      checagens[`tabela ${tabela}`] = error ? falha(error) : { ok: true, detalhe: "ok" };
    } catch (e) {
      checagens[`tabela ${tabela}`] = falha(e);
    }
  }
  try {
    const { error } = await supabase().storage.from(BUCKET).list("", { limit: 1 });
    checagens[`bucket ${BUCKET}`] = error ? falha(error) : { ok: true, detalhe: "ok" };
  } catch (e) {
    checagens[`bucket ${BUCKET}`] = falha(e);
  }
  try {
    const { error } = await supabase().storage.from(BUCKET).createSignedUploadUrl(`diagnostico/${Date.now()}`);
    checagens["url de envio assinada"] = error ? falha(error) : { ok: true, detalhe: "ok" };
  } catch (e) {
    checagens["url de envio assinada"] = falha(e);
  }

  try {
    const { error } = await supabase().rpc("uso_armazenamento_laudos");
    checagens["migration 0003 (limpeza automática)"] = error
      ? { ok: false, detalhe: "Rode supabase/migrations/0003_capacidade.sql no SQL Editor." }
      : { ok: true, detalhe: "ok" };
  } catch (e) {
    checagens["migration 0003 (limpeza automática)"] = falha(e);
  }

  try {
    const [laudo, imagem] = await Promise.all([
      supabase().from("laudo").select("status").limit(1),
      supabase().from("imagem").select("recebida_em").limit(1),
    ]);
    checagens["migration 0006 (rascunho e envio imediato)"] =
      laudo.error || imagem.error
        ? { ok: false, detalhe: "Rode supabase/migrations/0006_rascunho_envio_imediato.sql no SQL Editor." }
        : { ok: true, detalhe: "ok" };
  } catch (e) {
    checagens["migration 0006 (rascunho e envio imediato)"] = falha(e);
  }

  resultado.checagens = checagens;
  const tudoOk = Object.values(checagens).every((c) => c.ok);
  resultado.conclusao = tudoOk ? "Tudo certo." : "Corrija os itens com ok: false.";
  return NextResponse.json(resultado, { status: tudoOk ? 200 : 500 });
}
