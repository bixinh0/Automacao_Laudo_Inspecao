import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bibliotecas nativas/ESM pesadas usadas só no servidor: carregadas direto do node_modules.
  serverExternalPackages: ["sharp", "@react-pdf/renderer"],
};

export default nextConfig;
