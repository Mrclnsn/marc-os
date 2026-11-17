import { Nav } from "@/components/nav";
import { requireSession } from "@/lib/auth";
import { getRunningTimer, inboxCount } from "@/lib/data";
import { TimerBar } from "@/components/timer";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const [inbox, timer] = await Promise.all([inboxCount(), getRunningTimer()]);
  const logout = (
    <form action={logoutAction}>
      <button className="text-xs text-white/50 transition-colors hover:text-white">Uitloggen</button>
    </form>
  );
  return (
    <div className="min-h-dvh">
      <Nav inbox={inbox} logout={logout} />
      <div className="md:pl-60">
        {timer && (
          <TimerBar
            timer={{
              id: timer.id,
              startedAt: timer.startedAt!.toISOString(),
              description: timer.description,
              clientName: timer.clientName,
              projectName: timer.projectName,
              billable: timer.billable,
            }}
          />
        )}
        <main className={`mx-auto max-w-5xl px-5 pt-8 md:px-12 md:pb-16 md:pt-12 ${timer ? "pb-44" : "pb-28"}`}>{children}</main>
      </div>
    </div>
  );
}
