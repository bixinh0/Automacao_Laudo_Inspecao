import { MARCA, SIMBOLO } from "@/lib/marca";

export function Simbolo({ altura = 32, cor = MARCA.cores.azul }: { altura?: number; cor?: string }) {
  const { largura: w, altura: h, espessura, circulos, linhas } = SIMBOLO;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} height={altura} width={(altura * w) / h} aria-hidden="true">
      <g fill="none" stroke={cor} strokeWidth={espessura} strokeLinecap="round">
        {circulos.map((c, i) => (
          <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
        ))}
        {linhas.map((l, i) => (
          <line key={i} {...l} />
        ))}
      </g>
    </svg>
  );
}

/** Símbolo + nome, como no logotipo. */
export function Logo({ altura = 30, cor = "#ffffff" }: { altura?: number; cor?: string }) {
  return (
    <span className="logo" style={{ color: cor }}>
      <Simbolo altura={altura} cor={cor} />
      <span className="logo-nome" style={{ fontSize: altura * 0.62 }}>
        {MARCA.nome}
      </span>
    </span>
  );
}
