"use client";

export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="cartao">
      <h1>Algo deu errado</h1>
      <p className="ajuda">Não foi possível carregar esta página. Verifique a conexão e tente de novo.</p>
      <button className="botao-enviar" onClick={reset}>
        Tentar novamente
      </button>
    </div>
  );
}
