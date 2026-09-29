import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import FormCadastro from "@/components/FormCadastro";
import { TITULO_LAUDO } from "@/lib/regras";
import { dominioPermitido } from "@/lib/usuarios";

export const metadata: Metadata = { title: `Cadastro · ${TITULO_LAUDO}` };
export const dynamic = "force-dynamic";

export default function PaginaCadastro() {
  return (
    <div className="entrar">
      <div className="entrar-marca">
        <Logo altura={44} />
      </div>
      <FormCadastro dominio={dominioPermitido()} />
    </div>
  );
}
