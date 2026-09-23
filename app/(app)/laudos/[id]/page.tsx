import Link from "next/link";
import { notFound } from "next/navigation";
import { buscarLaudo, listarImagens } from "@/lib/laudos";
import { formatarDataHora } from "@/lib/pdf/formato";

export const dynamic = "force-dynamic";

export default async function PaginaConfirmacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const laudo = await buscarLaudo(id);
  if (!laudo) notFound();
  const imagens = await listarImagens(id);
  const folhas = imagens.filter((i) => i.tipo === "FORMULARIO").length;
  const fotos = imagens.filter((i) => i.tipo === "PECA").length;

  if (!laudo.caminhoPdf) {
    return (
      <div className="cartao">
        <h1>Laudo não concluído</h1>
        <p>O envio da OP {laudo.numeroOP} não terminou. Volte à tela de envio e gere o laudo novamente.</p>
        <Link href="/" className="botao-enviar">
          Novo laudo
        </Link>
      </div>
    );
  }

  return (
    <div className="cartao confirmacao">
      <p className="selo" aria-hidden="true">
        ✓
      </p>
      <h1>Laudo gerado</h1>
      <p className="op-destaque">OP {laudo.numeroOP}</p>
      <p className="ajuda">
        {formatarDataHora(new Date(laudo.criadoEm))} · {folhas} {folhas === 1 ? "folha" : "folhas"} do formulário · {fotos}{" "}
        {fotos === 1 ? "foto" : "fotos"} das peças
      </p>
      <a href={`/api/laudos/${laudo.id}/pdf`} className="botao-enviar">
        Baixar PDF
      </a>
      <Link href="/" className="botao-secundario">
        Novo laudo
      </Link>
    </div>
  );
}
