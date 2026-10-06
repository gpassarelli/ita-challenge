"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#faf9f6] p-6">
      <div className="max-w-md text-center">
        <p className="mb-8 text-3xl font-semibold tracking-tight">
          allya<span className="text-[#e76645]">.</span>
        </p>
        <h1 className="text-xl font-semibold">
          Não foi possível abrir esta página
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-500">
          Confira sua conexão e tente novamente. Se o problema continuar,
          verifique as conexões do aplicativo.
        </p>
        <button
          onClick={reset}
          className="mt-6 rounded-md bg-[#e76645] px-4 py-2 text-sm text-white"
        >
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
