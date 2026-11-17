import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Beeldmerk } from "@/components/brand";
import { verifyPassword } from "@/lib/password";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/session";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!verifyPassword(password, process.env.APP_PASSWORD_HASH)) {
    await new Promise((r) => setTimeout(r, 1000)); // remt raden af
    redirect("/login?fout=1");
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ fout?: string }> }) {
  const { fout } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-nacht p-6 text-white">
      <form action={login} className="w-full max-w-sm">
        <Beeldmerk className="mb-10 h-14 w-auto" color="#fff" strokeWidth={20} />
        <p className="mb-3 text-xs uppercase tracking-[0.2em] text-white/50">Marc Lonsain Consultancy</p>
        <h1 className="text-5xl font-bold leading-none tracking-tight">Marc OS</h1>
        <div className="my-8 h-[3px] w-full bg-white" />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Wachtwoord"
          autoComplete="current-password"
          className="w-full rounded-sm border border-white/20 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-white/40 focus:border-white"
        />
        {fout && <p className="mt-3 text-sm text-white/80">Dat wachtwoord klopt niet.</p>}
        <button className="mt-4 w-full rounded-sm bg-white px-4 py-3 font-bold text-nacht transition-opacity hover:opacity-90">Inloggen</button>
      </form>
    </main>
  );
}
