import { Nav } from "@/components/nav";
import { requireSession } from "@/lib/auth";
import { inboxCount } from "@/lib/data";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const inbox = await inboxCount();
  return (
    <div className="min-h-dvh">
      <Nav inbox={inbox} />
      <div className="md:pl-52">
        <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 md:px-8 md:pb-12">{children}</main>
        <form action={logoutAction} className="mx-auto max-w-4xl px-4 pb-24 md:px-8 md:pb-8">
          <button className="btn-ghost text-xs">Uitloggen</button>
        </form>
      </div>
    </div>
  );
}
