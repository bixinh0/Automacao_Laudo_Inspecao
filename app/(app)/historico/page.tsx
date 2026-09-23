import Link from "next/link";
import { listarLaudos } from "@/lib/laudos";
import { configOneDrive } from "@/lib/onedrive";
import { formatarDataHora } from "@/lib/pdf/formato";

export const dynamic = "force-dynamic";

export default async function PaginaHistorico({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { op = "" } = await searchParams;
  const busca = op.replace(/\D/g, "").slice(0, 8);
  const laudos = await listarLaudos(busca);
  const comOneDrive = Boolean(configOneDrive());

  return (
    <div className="historico">
      <div className="titulo-linha">
        <h1>Histórico de laudos</h1>
        <Link href="/onedrive">OneDrive</Link>
      </div>
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
                  {comOneDrive &&
                    (l.onedriveUrl ? (
                      <a className="selo-onedrive ok" href={l.onedriveUrl} target="_blank" rel="noreferrer">
                        ✓ No OneDrive
                      </a>
                    ) : (
                      <span className="selo-onedrive" title={l.onedriveErro ?? undefined}>
                        Envio ao OneDrive pendente
                      </span>
                    ))}
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
