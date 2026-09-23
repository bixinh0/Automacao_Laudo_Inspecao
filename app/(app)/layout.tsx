import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function LayoutApp({ children }: { children: React.ReactNode }) {
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
            <form method="post" action="/api/sair">
              <button type="submit">Sair</button>
            </form>
          </nav>
        </div>
        <div className="topo-titulo">Laudo de Inspeção de Produção</div>
      </header>
      <main>{children}</main>
    </>
  );
}
