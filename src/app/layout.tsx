import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Allya · Prospecção com contexto",
  description: "Empresas, evidências e oportunidades em um só lugar.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
