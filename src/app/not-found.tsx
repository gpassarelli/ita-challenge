import Link from "next/link";
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="text-center">
        <p className="text-sm text-neutral-400">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Página não encontrada</h1>
        <p className="mt-3 text-sm text-neutral-500">
          Este endereço não faz parte do espaço de trabalho.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-[#e76645] px-4 py-2 text-sm text-white"
        >
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
