import { NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { criarLaudo, criarUrlEnvio } from "@/lib/laudos";
import { MAX_FOLHAS_FORMULARIO, MAX_FOTOS_PECAS, MAX_OBSERVACOES, opValida, TIPOS, type TipoImagem } from "@/lib/regras";

export const runtime = "nodejs";

/**
 * Cria o laudo e devolve uma URL de envio assinada para cada foto. As fotos
 * vão do navegador direto ao Storage, porque a Vercel limita o corpo de uma
 * requisição a 4,5 MB e uma foto de celular pode passar disso.
 */
export async function POST(req: Request) {
  const corpo = await lerJson(req);
  const numeroOP = String(corpo.numeroOP ?? "").trim();
  const observacoes = String(corpo.observacoes ?? "").trim() || null;
  const arquivos = Array.isArray(corpo.arquivos) ? corpo.arquivos : [];

  if (!opValida(numeroOP)) return erro("O número da OP deve ter de 4 a 8 dígitos.");
  if (observacoes && observacoes.length > MAX_OBSERVACOES) return erro(`Observações com no máximo ${MAX_OBSERVACOES} caracteres.`);

  const itens: { tipo: TipoImagem; ordem: number }[] = [];
  for (const a of arquivos) {
    const tipo = a?.tipo as TipoImagem;
    const ordem = Number(a?.ordem);
    if (!TIPOS.includes(tipo) || !Number.isInteger(ordem) || ordem < 1) return erro("Lista de fotos inválida.");
    itens.push({ tipo, ordem });
  }
  const contar = (t: TipoImagem) => itens.filter((i) => i.tipo === t).length;
  const nForm = contar("FORMULARIO");
  const nPecas = contar("PECA");
  if (nForm < 1) return erro("Anexe a foto do formulário FM PRO 001 01.");
  if (nPecas < 1) return erro("Anexe ao menos uma foto das peças.");
  if (nForm > MAX_FOLHAS_FORMULARIO) return erro(`No máximo ${MAX_FOLHAS_FORMULARIO} folhas de formulário.`);
  if (nPecas > MAX_FOTOS_PECAS) return erro(`No máximo ${MAX_FOTOS_PECAS} fotos de peças por laudo.`);
  if (new Set(itens.map((i) => `${i.tipo}-${i.ordem}`)).size !== itens.length) return erro("Lista de fotos inválida.");

  try {
    const laudo = await criarLaudo(numeroOP, observacoes);
    const envios = await Promise.all(
      itens.map(async (i) => ({ ...i, url: await criarUrlEnvio(laudo.id, i.tipo, i.ordem) })),
    );
    return NextResponse.json({ id: laudo.id, envios }, { status: 201 });
  } catch (e) {
    return tratarErro(e);
  }
}
