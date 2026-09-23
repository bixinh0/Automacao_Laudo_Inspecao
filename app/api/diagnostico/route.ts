import { NextResponse } from "next/server";
import { explicarErroConfiguracao } from "@/lib/api";
import { BUCKET, supabase, urlSupabase } from "@/lib/supabase";

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
    },
  };

  if (!url || !chave) {
    resultado.conclusao = "Defina SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel (Settings → Environment Variables) e faça Redeploy.";
    return NextResponse.json(resultado, { status: 500 });
  }

  const checagens: Record<string, Resultado> = {};
  for (const tabela of ["laudo", "imagem"]) {
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

  resultado.checagens = checagens;
  const tudoOk = Object.values(checagens).every((c) => c.ok);
  resultado.conclusao = tudoOk ? "Tudo certo." : "Corrija os itens com ok: false.";
  return NextResponse.json(resultado, { status: tudoOk ? 200 : 500 });
}
