import { listarLaudos } from "@/lib/laudos";
import { formatarDataHora } from "@/lib/pdf/formato";

export const dynamic = "force-dynamic";

export default async function PaginaHistorico({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { op = "" } = await searchParams;
  const busca = op.replace(/\D/g, "").slice(0, 8);
  const laudos = await listarLaudos(busca);

  return (
    <div className="historico">
      <h1>Histórico de laudos</h1>
      <form className="busca" role="search">
        <input
          type="search"
          name="op"
          inputMode="numeric"
          placeholder="Buscar por número da OP"
          defaultValue={busca}
          aria-label="Número da OP"
        />
        <button type="submit">Buscar</button>
      </form>

      {laudos.length === 0 ? (
        <p className="ajuda">{busca ? `Nenhum laudo encontrado para "${busca}".` : "Nenhum laudo emitido ainda."}</p>
      ) : (
        <>
          <p className="ajuda">
            {busca ? `${laudos.length} laudo(s) com "${busca}"` : `Últimos ${laudos.length} laudo(s) emitidos`}
          </p>
          <ul className="lista-laudos">
            {laudos.map((l) => (
              <li key={l.id}>
                <div>
                  <strong>OP {l.numeroOP}</strong>
                  <span>{formatarDataHora(new Date(l.criadoEm))}</span>
                </div>
                <a href={`/api/laudos/${l.id}/pdf`}>Baixar PDF</a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
