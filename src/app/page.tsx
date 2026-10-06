import { configured, authClient } from "@/lib/server/supabase";
import { WorkspaceApp } from "@/components/workspace";
import { Login } from "@/components/login";
export const dynamic = "force-dynamic";
export default async function Page() {
  const connected = configured();
  if (!connected) return <WorkspaceApp connected={false} user={null} />;
  const client = await authClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return <Login />;
  return (
    <WorkspaceApp connected user={{ id: user.id, email: user.email ?? "" }} />
  );
}
