import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
export function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
export async function authClient() {
  if (!configured())
    throw new Error("Conecte o Supabase para usar o aplicativo.");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server Components cannot write cookies; proxy refreshes them. */
          }
        },
      },
    },
  );
}
export async function requireUser() {
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new Error("UNAUTHENTICATED");
  return user;
}
export function adminClient() {
  if (!configured())
    throw new Error("Conecte o Supabase para usar o aplicativo.");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
