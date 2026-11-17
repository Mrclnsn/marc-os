import { Nav } from "@/components/nav";
import { requireSession } from "@/lib/auth";
import { inboxCount } from "@/lib/data";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const inbox = await inboxCount();
  const logout = (
    <form action={logoutAction}>
      <button className="text-xs text-white/50 transition-colors hover:text-white">Uitloggen</button>
    </form>
  );
  return (
    <div className="min-h-dvh">
      <Nav inbox={inbox} logout={logout} />
      <div className="md:pl-60">
        <main className="mx-auto max-w-5xl px-5 pb-28 pt-8 md:px-12 md:pb-16 md:pt-12">{children}</main>
      </div>
    </div>
  );
}
