import { cookies } from "next/headers";
import { Nav } from "@/components/nav";
import { requireSession } from "@/lib/auth";
import { getRunningTimer, inboxCount } from "@/lib/data";
import { getModules, parseTheme, THEME_COOKIE } from "@/lib/settings";
import { TimerBar } from "@/components/timer";
import { ModulesProvider } from "@/components/modules-context";
import { ThemeSwitch } from "@/components/theme-switch";
import { MainFrame } from "@/components/main-frame";
import { logoutAction } from "../actions";
import { ServiceWorkerRegister } from "@/components/push-settings";
import { HermesLauncher } from "@/components/hermes-parts";
import { pendingCount } from "@/lib/agent";
import { hermesStatusQuick } from "@/lib/hermes";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const modules = await getModules();
  const [inbox, timer, pending] = await Promise.all([inboxCount(), modules.uren ? getRunningTimer() : Promise.resolve(null), pendingCount()]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const footer = (
    <div className="flex items-center justify-between gap-3">
      <form action={logoutAction}>
        <button className="text-xs text-white/50 transition-colors hover:text-white">Uitloggen</button>
      </form>
      <ThemeSwitch theme={theme} />
    </div>
  );
  return (
    <ModulesProvider modules={modules}>
      <div className="min-h-dvh">
        <ServiceWorkerRegister />
        <Nav inbox={inbox} pending={pending} footer={footer} modules={modules} />
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
          <MainFrame timer={!!timer}>{children}</MainFrame>
        </div>
        <HermesLauncher pending={pending} status={hermesStatusQuick()} timer={!!timer} />
      </div>
    </ModulesProvider>
  );
}
