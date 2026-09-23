import Link from "next/link";
import { estadoOneDrive } from "@/lib/integracao";
import { listarPendentesOneDrive } from "@/lib/laudos";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  config: "O OneDrive ainda não foi configurado na Vercel (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET e ONEDRIVE_PASTA_LINK).",
  estado: "A autorização expirou ou veio de outra janela. Clique em Conectar de novo.",
};

export default async function PaginaOneDrive({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string; enviados?: string; falhas?: string; desconectado?: string }>;
}) {
  const q = await searchParams;
  const estado = await estadoOneDrive();
  const pendentes = estado.conectado ? await listarPendentesOneDrive() : [];
  const ultimoErro = pendentes.find((l) => l.onedriveErro)?.onedriveErro;

  return (
    <div className="historico">
      <h1>OneDrive</h1>
      <p className="ajuda">
        Cada laudo gerado é copiado automaticamente para a pasta da Qualidade no SharePoint, em
        <strong> ano / mês / dia-mês</strong>.
      </p>

      {q.ok && <p className="aviso-ok">OneDrive conectado. Os próximos laudos serão enviados automaticamente.</p>}
      {q.desconectado && <p className="aviso">OneDrive desconectado. Os laudos deixam de ser enviados.</p>}
      {q.erro && <p className="aviso alerta">{ERROS[q.erro] ?? `Não foi possível conectar: ${q.erro}`}</p>}
      {q.enviados !== undefined && (
        <p className={Number(q.falhas) ? "aviso" : "aviso-ok"}>
          {q.enviados} laudo(s) enviado(s){Number(q.falhas) ? `, ${q.falhas} com falha` : ""}.
        </p>
      )}

      <div className="cartao">
        {!estado.configurado ? (
          <p>{ERROS.config} Veja o passo a passo no README.</p>
        ) : estado.conectado ? (
          <>
            <p>
              <strong>Conectado</strong>
              {estado.conta ? ` como ${estado.conta}` : ""}.
            </p>
            <p className="ajuda">
              {pendentes.length === 0
                ? "Todos os laudos emitidos já estão no OneDrive."
                : `${pendentes.length} laudo(s) ainda não enviado(s).`}
            </p>
            {ultimoErro && <p className="ajuda alerta">Último erro: {ultimoErro}</p>}
            {pendentes.length > 0 && (
              <form method="post" action="/api/onedrive/pendentes">
                <button type="submit" className="botao-enviar">
                  Enviar pendentes agora
                </button>
              </form>
            )}
            <form method="post" action="/api/onedrive/desconectar">
              <button type="submit" className="botao-secundario">
                Desconectar
              </button>
            </form>
          </>
        ) : (
          <>
            <p>
              Ainda não conectado. Entre com a conta Microsoft 365 que tem acesso à pasta{" "}
              <em>Qualidade › Checklist Embarque Controlado</em>.
            </p>
            <a href="/api/onedrive/conectar" className="botao-enviar">
              Conectar OneDrive
            </a>
          </>
        )}
      </div>
      <p className="ajuda" style={{ marginTop: 12 }}>
        <Link href="/historico">← Voltar ao histórico</Link>
      </p>
    </div>
  );
}
