import FormPerfil from "@/components/FormPerfil";
import FormTrocarSenha from "@/components/FormTrocarSenha";
import { DEPARTAMENTOS, ROTULO_PAPEL, ROTULO_SITUACAO } from "@/lib/contas";
import { usuarioLiberado } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export default async function PaginaPerfil() {
  const eu = (await usuarioLiberado())!;
  return (
    <div className="historico">
      <h1>Meu perfil</h1>
      <div className="cartao">
        <dl className="dados-perfil">
          <dt>E-mail</dt>
          <dd>{eu.email}</dd>
          <dt>Papel</dt>
          <dd>{ROTULO_PAPEL[eu.papel]}</dd>
          <dt>Situação</dt>
          <dd>{ROTULO_SITUACAO[eu.situacao]}</dd>
          <dt>Departamento</dt>
          <dd>{DEPARTAMENTOS[eu.departamento]}</dd>
        </dl>
        <p className="ajuda">E-mail, papel e situação só podem ser alterados por um administrador.</p>
      </div>

      <h2 className="subtitulo">Dados</h2>
      <div className="cartao">
        <FormPerfil nome={eu.nome} departamento={eu.departamento} />
      </div>

      <h2 className="subtitulo">Trocar senha</h2>
      <div className="cartao">
        <FormTrocarSenha />
      </div>

      <form method="post" action="/api/auth/sair">
        <button type="submit" className="botao-secundario">
          Sair
        </button>
      </form>
    </div>
  );
}
