import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
    <main className="min-h-dvh grid place-items-center p-6">
      <form action={login} className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold">Marc OS</h1>
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Wachtwoord"
          className="input w-full"
          autoComplete="current-password"
        />
        {fout && <p className="text-sm text-red-600">Onjuist wachtwoord.</p>}
        <button className="btn-primary w-full">Inloggen</button>
      </form>
    </main>
  );
}
