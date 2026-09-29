import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { TITULO_LAUDO } from "@/lib/regras";

export const metadata: Metadata = { title: `Acesso · ${TITULO_LAUDO}` };

/** Aviso exibido após o cadastro e quando uma conta não aprovada tenta entrar. */
export default async function PaginaAguardando({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string; motivo?: string; novo?: string }>;
}) {
  const { situacao, motivo, novo } = await searchParams;
  let titulo: string;
  let texto: React.ReactNode;
  switch (situacao) {
    case "RECUSADO":
      titulo = "Cadastro recusado";
      texto = (
        <>
          <p>Seu cadastro não foi aprovado.</p>
          {motivo && (
            <p className="motivo">
              <strong>Motivo:</strong> {motivo}
            </p>
          )}
          <p className="ajuda">Se achar que houve engano, procure um administrador do sistema.</p>
        </>
      );
      break;
    case "SUSPENSO":
      titulo = "Acesso suspenso";
      texto = <p>Seu acesso está suspenso. Procure um administrador do sistema.</p>;
      break;
    case "INCOMPLETO":
      titulo = "Cadastro incompleto";
      texto = <p>Não encontramos seu cadastro completo. Procure um administrador do sistema.</p>;
      break;
    default:
      titulo = novo ? "Cadastro enviado" : "Seu cadastro aguarda aprovação";
      texto = (
        <>
          <p>{novo ? "Recebemos seu cadastro. " : ""}O acesso será liberado depois que um administrador aprovar.</p>
          <p className="ajuda">Você será avisado internamente. Depois da aprovação, é só entrar com seu e-mail e senha.</p>
        </>
      );
  }
  return (
    <div className="entrar">
      <div className="entrar-marca">
        <Logo altura={44} />
      </div>
      <div className="cartao">
        <h1>{titulo}</h1>
        {texto}
        <Link href="/entrar" className="botao-secundario">
          Voltar para o login
        </Link>
      </div>
    </div>
  );
}
