"use client";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input, Label, ErrorNote } from "./ui/fields";
import { api } from "./forms";
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth", { action: "login", email, password });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-dvh bg-[#faf9f6] lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#253e36] p-14 text-[#f8f5ed] lg:flex">
        <span className="text-3xl font-semibold tracking-[-2px]">
          allya<span className="text-[#ef987d]">.</span>
        </span>
        <div className="max-w-md">
          <span className="mb-6 inline-block rounded-full border border-white/20 px-3 py-1 text-xs text-white/60">
            PROSPECÇÃO COM CONTEXTO
          </span>
          <h1 className="text-5xl font-medium leading-[1.13] tracking-tight">
            Boas conexões
            <br />
            começam com
            <br />
            <span className="text-[#efb49b]">bons sinais.</span>
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-7 text-white/60">
            Conecte empresas, pessoas e evidências. Transforme contexto em
            conversas que fazem sentido.
          </p>
        </div>
        <p className="text-xs text-white/40">
          Seus dados. Suas regras. Seu próximo passo.
        </p>
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full border border-white/10" />
        <div className="absolute -bottom-20 -right-20 size-72 rounded-full border border-white/10" />
      </section>
      <section className="flex items-center justify-center px-8 py-16">
        <div className="w-full max-w-sm">
          <p className="mb-10 text-2xl font-semibold tracking-tight lg:hidden">
            allya<span className="text-[#e76645]">.</span>
          </p>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-neutral-400">
            Seu espaço de trabalho
          </p>
          <h2 className="text-3xl font-semibold tracking-tight">
            Vamos continuar?
          </h2>
          <p className="mb-8 mt-3 text-sm text-neutral-500">
            Entre para acompanhar suas oportunidades.
          </p>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
              />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <ErrorNote message={error} />
            <Button className="w-full" disabled={busy}>
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  Entrar
                  <ArrowRight />
                </>
              )}
            </Button>
          </form>
          <p className="mt-6 text-xs leading-relaxed text-neutral-400">
            Acesso por convite. Solicite sua conta ao responsável pelo espaço de
            trabalho.
          </p>
        </div>
      </section>
    </main>
  );
}
