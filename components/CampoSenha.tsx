"use client";

import { useState } from "react";
import { forcaSenha } from "@/lib/contas";

/** Campo de senha com botão mostrar/ocultar e, se pedido, indicador de força. */
export default function CampoSenha({
  id,
  rotulo,
  valor,
  aoMudar,
  autoComplete,
  comForca = false,
  autoFocus = false,
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  autoComplete: "new-password" | "current-password";
  comForca?: boolean;
  autoFocus?: boolean;
}) {
  const [visivel, setVisivel] = useState(false);
  const forca = forcaSenha(valor);
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <div className="senha-linha">
        <input
          id={id}
          type={visivel ? "text" : "password"}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
        />
        <button type="button" className="mostrar-senha" onClick={() => setVisivel((v) => !v)} aria-pressed={visivel}>
          {visivel ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {comForca && valor && (
        <div className={`forca forca-${forca.nivel}`} aria-live="polite">
          <div className="forca-barras" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={n <= forca.nivel ? "cheia" : ""} />
            ))}
          </div>
          <span>Força: {forca.rotulo}</span>
        </div>
      )}
    </div>
  );
}
