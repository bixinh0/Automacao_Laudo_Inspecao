import Link from "next/link";
import BaixarZipDia, { BaixarZipOutraData } from "@/components/BaixarZipDia";
import { listarLaudos, type Laudo } from "@/lib/laudos";
import { usoArmazenamento } from "@/lib/manutencao";
import { configOneDrive } from "@/lib/onedrive";
import { diaLocal, formatarDataHora, pastaDoDia, rotuloDoDia } from "@/lib/pdf/formato";

export const dynamic = "force-dynamic";

function agruparPorDia(laudos: Laudo[]) {
  const grupos = new Map<string, Laudo[]>();
  for (const l of laudos) {
    const dia = diaLocal(new Date(l.criadoEm));
    grupos.set(dia, [...(grupos.get(dia) ?? []), l]);
  }
  return [...grupos.entries()];
}

export default async function PaginaHistorico({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { op = "" } = await searchParams;
  const busca = op.replace(/\D/g, "").slice(0, 8);
  const [laudos, uso] = await Promise.all([listarLaudos(busca), usoArmazenamento()]);
  const comOneDrive = Boolean(configOneDrive());
  const hoje = diaLocal(new Date());

  return (
    <div className="historico">
      <div className="titulo-linha">
        <h1>Histórico de laudos</h1>
        {comOneDrive && <Link href="/onedrive">OneDrive</Link>}
      </div>
      {uso && (
        <div className="uso-espaco">
          <div className="trilho" role="progressbar" aria-valuenow={Math.round((uso.bytes / uso.limite) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="preenchimento" style={{ width: `${Math.min(100, (uso.bytes / uso.limite) * 100)}%` }} />
          </div>
          <p className="ajuda">
            Espaço: {Math.round(uso.bytes / 1048576)} MB de {Math.round(uso.limite / 1048576)} MB
            {uso.maisAntigo ? ` · PDFs disponíveis desde ${formatarDataHora(new Date(uso.maisAntigo)).split(" às")[0]}` : ""}. Quando
            enche, os PDFs mais antigos são apagados: baixe o ZIP do dia e guarde no drive.
          </p>
        </div>
      )}
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
          {agruparPorDia(laudos).map(([dia, doDia]) => (
            <section key={dia} className="grupo-dia">
              <div className="grupo-dia-titulo">
                <h2>
                  {dia === hoje ? "Hoje · " : ""}
                  {rotuloDoDia(dia)} <span>({doDia.length})</span>
                </h2>
                {!busca && <BaixarZipDia dia={dia} rotulo={`Baixar ${pastaDoDia(dia)}.zip`} />}
              </div>
              <ul className="lista-laudos">
                {doDia.map((l) => (
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
                    {l.pdfRemovidoEm ? (
                      <span className="pdf-removido" title="Apagado para liberar espaço; a cópia está no drive.">
                        PDF arquivado
                      </span>
                    ) : (
                      <a href={`/api/laudos/${l.id}/pdf`}>Baixar PDF</a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <BaixarZipOutraData hoje={hoje} />
    </div>
  );
}
