import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ServiceError } from "./diagnostics";

class OriginError extends Error {
  constructor() {
    super("Origem da requisição não permitida.");
  }
}

export function assertSameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new OriginError();
  const origin = request.headers.get("origin");
  if (!origin) return;

  // Next.js may build request.url from its bind address (0.0.0.0).
  // Use the browser-facing host, including the port, as Server Actions do.
  // In production the reverse proxy must overwrite forwarded headers.
  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ??
    request.headers.get("host") ??
    url.host;
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
    url.protocol.slice(0, -1);
  if (!host || /[/\\@?#\s]/.test(host) || !["http", "https"].includes(protocol))
    throw new OriginError();

  try {
    if (new URL(`${protocol}://${host}`).origin === origin) return;
  } catch {
    // Malformed/opaque origins and invalid host headers fail closed.
  }
  throw new OriginError();
}
export function errorResponse(error: unknown) {
  if (error instanceof ServiceError)
    return NextResponse.json(
      { error: error.message },
      { status: error.retryable ? 503 : 500 },
    );
  if (error instanceof OriginError)
    return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error:
          "Confira os campos enviados. Preencha os obrigatórios e use os tipos e opções indicados no formulário.",
      },
      { status: 400 },
    );
  if (error instanceof SyntaxError || error instanceof TypeError)
    return NextResponse.json(
      {
        error:
          "Não foi possível processar a solicitação. Confira os dados e tente novamente.",
      },
      { status: 400 },
    );
  const message =
    error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
  if (message === "UNAUTHENTICATED")
    return NextResponse.json(
      { error: "Entre na sua conta para continuar." },
      { status: 401 },
    );
  return NextResponse.json({ error: message }, { status: 400 });
}
