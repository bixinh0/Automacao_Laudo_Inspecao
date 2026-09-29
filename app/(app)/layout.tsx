import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { podeGerenciar } from "@/lib/permissoes";
import { TITULO_LAUDO } from "@/lib/regras";
import { usuarioLiberado } from "@/lib/sessao";
import { contarPendentes } from "@/lib/usuarios";

export const dynamic = "force-dynamic";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  // O proxy já barra quem não pode entrar; aqui é a segunda checagem, no servidor.
  const eu = await usuarioLiberado();
  if (!eu) redirect("/entrar");
  const gestor = podeGerenciar(eu);
  const pendentes = gestor ? await contarPendentes() : 0;

  return (
    <>
      <header className="topo">
        <div className="topo-conteudo">
          <Link href="/" className="marca" aria-label="Vanderhulst — novo laudo">
            <Logo altura={22} />
          </Link>
          <nav>
            <Link href="/">Novo</Link>
            <Link href="/historico">Histórico</Link>
            {gestor && (
              <Link href="/usuarios" aria-label={pendentes ? `Usuários, ${pendentes} pendente(s)` : "Usuários"}>
                Usuários{pendentes > 0 && <span className="contador-menu">{pendentes}</span>}
              </Link>
            )}
            <Link href="/perfil" aria-label="Meu perfil" title={eu.nome}>
              Perfil
            </Link>
          </nav>
        </div>
        <div className="topo-titulo">{TITULO_LAUDO}</div>
      </header>
      <main>{children}</main>
    </>
  );
}
