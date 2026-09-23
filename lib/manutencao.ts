import "server-only";
import { BUCKET, supabase } from "./supabase";

/**
 * Mantém o bucket dentro do plano gratuito do Supabase (1 GB).
 *
 * Roda depois de cada laudo emitido (sem atrasar a resposta):
 *  1. apaga envios abandonados há mais de um dia (fotos enviadas sem gerar o PDF);
 *  2. se o espaço passar de LIMITE_ARMAZENAMENTO_MB, apaga os PDFs mais antigos
 *     e marca o laudo com pdf_removido_em. O registro continua no histórico.
 *
 * Depende das funções da migration 0003; sem ela, não faz nada.
 */

export function limiteArmazenamentoBytes(): number {
  return (Number(process.env.LIMITE_ARMAZENAMENTO_MB) || 850) * 1024 * 1024;
}

export interface UsoArmazenamento {
  bytes: number;
  limite: number;
  /** Criação do laudo mais antigo que ainda tem PDF. */
  maisAntigo: string | null;
}

export async function usoArmazenamento(): Promise<UsoArmazenamento | null> {
  const { data, error } = await supabase().rpc("uso_armazenamento_laudos").single<{ bytes_total: number; mais_antigo: string | null }>();
  if (error) return null; // migration 0003 ainda não rodada
  return { bytes: Number(data.bytes_total), limite: limiteArmazenamentoBytes(), maisAntigo: data.mais_antigo };
}

async function apagarPasta(prefixo: string) {
  const storage = supabase().storage.from(BUCKET);
  const { data } = await storage.list(prefixo, { limit: 1000 });
  if (data?.length) await storage.remove(data.map((f) => `${prefixo}/${f.name}`));
}

export async function limparArmazenamento(): Promise<{ abandonados: number; pdfsRemovidos: number }> {
  const resultado = { abandonados: 0, pdfsRemovidos: 0 };
  try {
    const umDiaAtras = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: abandonados } = await supabase()
      .from("laudo")
      .select("id")
      .is("caminho_pdf", null)
      .lt("criado_em", umDiaAtras)
      .limit(20)
      .returns<{ id: string }[]>();
    for (const { id } of abandonados ?? []) {
      await apagarPasta(`${id}/brutos`);
      await supabase().from("laudo").delete().eq("id", id);
      resultado.abandonados++;
    }

    const { data, error } = await supabase()
      .rpc("laudos_para_liberar_espaco", { limite_bytes: limiteArmazenamentoBytes() })
      .limit(50);
    const excedentes = data as { id: string; caminho_pdf: string }[] | null;
    if (error) {
      console.warn("Limpeza automática desligada: rode a migration 0003 no Supabase.", error.message);
      return resultado;
    }
    if (excedentes?.length) {
      const { error: erroRemocao } = await supabase().storage.from(BUCKET).remove(excedentes.map((l) => l.caminho_pdf));
      if (erroRemocao) throw erroRemocao;
      // Laudos emitidos antes da migration 0003 também guardavam as fotos processadas à parte.
      for (const l of excedentes) await apagarPasta(`${l.id}/imagens`);
      await supabase()
        .from("laudo")
        .update({ pdf_removido_em: new Date().toISOString() })
        .in(
          "id",
          excedentes.map((l) => l.id),
        );
      resultado.pdfsRemovidos = excedentes.length;
    }
  } catch (e) {
    console.error("Limpeza automática falhou (tenta de novo no próximo laudo):", e);
  }
  if (resultado.abandonados || resultado.pdfsRemovidos) console.log("Limpeza automática:", resultado);
  return resultado;
}
