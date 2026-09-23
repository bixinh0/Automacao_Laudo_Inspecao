import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <div className="cartao">
      <h1>Página não encontrada</h1>
      <Link href="/" className="botao-enviar">
        Novo laudo
      </Link>
    </div>
  );
}
