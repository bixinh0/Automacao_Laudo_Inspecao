import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { destinoSeguro } from "@/lib/acesso";

export const metadata: Metadata = { title: "Entrar · Laudo de Inspeção" };

const MENSAGENS: Record<string, string> = {
  senha: "Senha incorreta. Tente novamente.",
  config: "A senha de acesso ainda não foi configurada. Defina SENHA_ACESSO na Vercel e faça Redeploy.",
};

export default async function PaginaEntrar({ searchParams }: { searchParams: Promise<{ erro?: string; destino?: string }> }) {
  const { erro, destino } = await searchParams;
  return (
    <div className="entrar">
      <div className="entrar-marca">
        <Logo altura={44} />
      </div>
      <form className="cartao" method="post" action="/api/entrar">
        <h1>Laudo de Inspeção</h1>
        <p className="ajuda">Digite a senha de acesso da fábrica.</p>
        <input type="hidden" name="destino" value={destinoSeguro(destino)} />
        <input
          className="campo-senha"
          type="password"
          name="senha"
          autoComplete="current-password"
          placeholder="Senha"
          aria-label="Senha de acesso"
          required
          autoFocus
        />
        {erro && MENSAGENS[erro] && (
          <p className="alerta" role="alert">
            {MENSAGENS[erro]}
          </p>
        )}
        <button type="submit" className="botao-enviar">
          Entrar
        </button>
      </form>
    </div>
  );
}
