import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import FormTrocarSenha from "@/components/FormTrocarSenha";
import { TITULO_LAUDO } from "@/lib/regras";
import { usuarioAtual } from "@/lib/sessao";

export const metadata: Metadata = { title: `Nova senha · ${TITULO_LAUDO}` };
export const dynamic = "force-dynamic";

/** Troca obrigatória no primeiro acesso após redefinição (o proxy bloqueia o resto até concluir). */
export default async function PaginaTrocarSenha() {
  const eu = await usuarioAtual();
  if (!eu) redirect("/entrar");
  if (!eu.senhaProvisoria) redirect("/perfil");
  return (
    <div className="entrar">
      <div className="entrar-marca">
        <Logo altura={44} />
      </div>
      <div className="cartao">
        <h1>Defina sua nova senha</h1>
        <p className="ajuda">
          Olá, {eu.nome.split(" ")[0]}. Você entrou com uma senha provisória; escolha uma senha pessoal para continuar.
        </p>
        <FormTrocarSenha obrigatoria />
        <form method="post" action="/api/auth/sair">
          <button type="submit" className="botao-link">
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}
