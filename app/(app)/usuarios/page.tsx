import { redirect } from "next/navigation";
import AcoesUsuario from "@/components/AcoesUsuario";
import { DEPARTAMENTOS, departamentoValido, LISTA_DEPARTAMENTOS, ROTULO_PAPEL, ROTULO_SITUACAO, type Situacao } from "@/lib/contas";
import { ACOES, motivoRecusa, podeGerenciar, type AcaoUsuario } from "@/lib/permissoes";
import { formatarDataHora } from "@/lib/pdf/formato";
import { usuarioLiberado, type Perfil } from "@/lib/sessao";
import { listarAuditoria, listarPerfis } from "@/lib/usuarios";

export const dynamic = "force-dynamic";

const SITUACOES: Situacao[] = ["APROVADO", "PENDENTE", "RECUSADO", "SUSPENSO"];

const ROTULO_ACAO: Record<string, string> = {
  APROVAR: "aprovou",
  RECUSAR: "recusou",
  SUSPENDER: "suspendeu",
  PROMOVER: "promoveu a ADMIN",
  REBAIXAR: "rebaixou para usuário",
  EDITAR: "editou",
  REDEFINIR_SENHA: "redefiniu a senha de",
  REMOVER: "removeu",
  TROCAR_SENHA: "trocou a própria senha",
  CRIAR_OWNER: "criou o OWNER",
};

export default async function PaginaUsuarios({ searchParams }: { searchParams: Promise<{ situacao?: string; departamento?: string }> }) {
  // Papel conferido no servidor em toda requisição (o proxy já filtrou, esta é a segunda barreira).
  const eu = await usuarioLiberado();
  if (!eu || !podeGerenciar(eu)) redirect("/");

  const q = await searchParams;
  const situacao = SITUACOES.includes(q.situacao as Situacao) ? (q.situacao as Situacao) : undefined;
  const departamento = departamentoValido(q.departamento) ? q.departamento : undefined;
  const [todos, auditoria] = await Promise.all([listarPerfis(), listarAuditoria(30)]);
  const pendentes = todos.filter((p) => p.situacao === "PENDENTE");
  const lista = todos.filter(
    (p) => p.situacao !== "PENDENTE" && (!situacao || p.situacao === situacao) && (!departamento || p.departamento === departamento),
  );
  const permitidas = (alvo: Perfil): AcaoUsuario[] =>
    alvo.id === eu.id ? [] : ACOES.filter((a) => motivoRecusa(eu, alvo, a) === null);

  return (
    <div className="historico usuarios">
      <h1>Usuários</h1>

      <section className="grupo-pendentes">
        <h2>
          Pendentes de aprovação <span>({pendentes.length})</span>
        </h2>
        {pendentes.length === 0 ? (
          <p className="ajuda">Nenhum cadastro aguardando aprovação.</p>
        ) : (
          <ul className="lista-usuarios">
            {pendentes.map((p) => (
              <li key={p.id} className="pendente">
                <div className="usuario-dados">
                  <strong>{p.nome}</strong>
                  <span>{p.email}</span>
                  <span>
                    {DEPARTAMENTOS[p.departamento]} · cadastro em {formatarDataHora(new Date(p.criadoEm))}
                  </span>
                </div>
                <AcoesUsuario
                  id={p.id}
                  nome={p.nome}
                  departamento={p.departamento}
                  acoes={permitidas(p).filter((a) => a === "APROVAR" || a === "RECUSAR")}
                  destaque
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Todos os usuários</h2>
        <form className="filtros">
          <select name="situacao" defaultValue={situacao ?? ""} aria-label="Filtrar por situação">
            <option value="">Todas as situações</option>
            {SITUACOES.filter((s) => s !== "PENDENTE").map((s) => (
              <option key={s} value={s}>
                {ROTULO_SITUACAO[s]}
              </option>
            ))}
          </select>
          <select name="departamento" defaultValue={departamento ?? ""} aria-label="Filtrar por departamento">
            <option value="">Todos os departamentos</option>
            {LISTA_DEPARTAMENTOS.map((d) => (
              <option key={d} value={d}>
                {DEPARTAMENTOS[d]}
              </option>
            ))}
          </select>
          <button type="submit">Filtrar</button>
        </form>
        <ul className="lista-usuarios">
          {lista.map((p) => (
            <li key={p.id}>
              <div className="usuario-dados">
                <strong>
                  {p.nome} {p.id === eu.id && <em>(você)</em>}
                </strong>
                <span>{p.email}</span>
                <span>
                  {DEPARTAMENTOS[p.departamento]} · <b className={`papel papel-${p.papel.toLowerCase()}`}>{ROTULO_PAPEL[p.papel]}</b> ·{" "}
                  <b className={`situacao situacao-${p.situacao.toLowerCase()}`}>{ROTULO_SITUACAO[p.situacao]}</b>
                  {p.senhaProvisoria && " · senha provisória"}
                </span>
                {p.situacao === "RECUSADO" && p.motivoRecusa && <span className="ajuda">Motivo: {p.motivoRecusa}</span>}
              </div>
              {p.papel === "OWNER" && p.id !== eu.id ? (
                <p className="ajuda sem-acoes">Somente o próprio OWNER altera este cadastro.</p>
              ) : p.id === eu.id ? (
                <p className="ajuda sem-acoes">Seus dados ficam em Meu perfil.</p>
              ) : (
                <AcoesUsuario id={p.id} nome={p.nome} departamento={p.departamento} acoes={permitidas(p)} />
              )}
            </li>
          ))}
          {lista.length === 0 && <li className="ajuda">Nenhum usuário com esses filtros.</li>}
        </ul>
      </section>

      <section>
        <h2>Registro de auditoria</h2>
        <ul className="auditoria">
          {auditoria.map((a) => (
            <li key={a.id}>
              <span className="ajuda">{formatarDataHora(new Date(a.criadoEm))}</span>{" "}
              <strong>{a.ator?.nome ?? "Sistema"}</strong> {ROTULO_ACAO[a.acao] ?? a.acao}
              {a.alvo && a.acao !== "TROCAR_SENHA" && a.alvo.id !== a.ator?.id && <> {a.alvo.nome}</>}
              {a.acao === "EDITAR" && a.alvo?.id === a.ator?.id && " o próprio perfil"}
              {typeof a.detalhes.motivo === "string" && <span className="ajuda"> — motivo: {a.detalhes.motivo}</span>}
            </li>
          ))}
          {auditoria.length === 0 && <li className="ajuda">Nenhum registro ainda.</li>}
        </ul>
      </section>
    </div>
  );
}
