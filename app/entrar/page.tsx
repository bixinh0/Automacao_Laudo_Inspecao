import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { destinoSeguro } from "@/lib/acesso";
import { TITULO_LAUDO } from "@/lib/regras";
import { garantirOwner, problemaConfiguracao } from "@/lib/usuarios";

export const metadata: Metadata = { title: `Entrar · ${TITULO_LAUDO}` };
export const dynamic = "force-dynamic";

function mensagem(erro?: string, minutos?: string): string | null {
  switch (erro) {
    case "credenciais":
      return "E-mail ou senha inválidos.";
    case "bloqueado":
      return `Muitas tentativas sem sucesso. Tente novamente em ${minutos ?? "15"} minuto(s).`;
    case "expirada":
      return "Sua senha provisória expirou. Peça uma nova redefinição a um administrador.";
    case "indisponivel":
      return "Serviço indisponível no momento. Tente novamente em instantes.";
    default:
      return null;
  }
}

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; minutos?: string; destino?: string; email?: string }>;
}) {
  const { erro, minutos, destino, email } = await searchParams;
  await garantirOwner();
  const configuracao = await problemaConfiguracao();
  const texto = mensagem(erro, minutos);
  return (
    <div className="entrar">
      <div className="entrar-marca">
        <Logo altura={44} />
      </div>
      <form className="cartao" method="post" action="/api/auth/entrar">
        <h1>{TITULO_LAUDO}</h1>
        <p className="ajuda">Entre com seu e-mail corporativo e sua senha.</p>
        {configuracao && (
          <p className="aviso" role="alert">
            <strong>Configuração pendente.</strong> {configuracao}
          </p>
        )}
        <input type="hidden" name="destino" value={destinoSeguro(destino)} />
        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            defaultValue={email ?? ""}
            placeholder="nome@vanderhulst.com.br"
            required
            autoFocus={!email}
          />
        </div>
        <div className="campo">
          <label htmlFor="senha">Senha</label>
          <input id="senha" name="senha" type="password" autoComplete="current-password" required autoFocus={Boolean(email)} />
        </div>
        {texto && (
          <p className="alerta" role="alert">
            {texto}
          </p>
        )}
        <button type="submit" className="botao-enviar">
          Entrar
        </button>
        <p className="ajuda rodape-form">
          Ainda não tem acesso? <Link href="/cadastro">Cadastre-se</Link>
        </p>
        <p className="ajuda rodape-form">Esqueceu a senha? Peça a um administrador para redefinir.</p>
      </form>
    </div>
  );
}
