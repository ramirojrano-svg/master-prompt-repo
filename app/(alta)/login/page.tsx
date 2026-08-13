// app/(alta)/login/page.tsx — login del operador.
// El mensaje de error es UNO SOLO para email inexistente y contraseña incorrecta: no se filtra
// si el email existe (§6.11: nunca un oráculo de padrón).
import { redirect } from "next/navigation";
import { signIn } from "../../../src/lib/auth.ts";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; centro?: string }> }) {
  // En Next 16 searchParams es una Promise (§11.0).
  const sp = await searchParams;

  async function entrar(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const centro = String(formData.get("centro") ?? "");
    try {
      await signIn("credentials", { email, password, redirect: false });
    } catch {
      redirect(`/login?error=1${centro ? `&centro=${encodeURIComponent(centro)}` : ""}`);
    }
    redirect(centro ? `/panel/${centro}` : "/");
  }

  return (
    <main style={{ maxWidth: 420, margin: "60px auto", padding: "0 16px" }}>
      <h1>EMOAPP</h1>
      <form className="panel" action={entrar}>
        <h2>Entrá a tu centro</h2>

        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />

        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />

        <input type="hidden" name="centro" defaultValue={sp.centro ?? ""} />

        {sp.error && <p className="error">Email o contraseña incorrectos.</p>}

        <p style={{ marginTop: 18 }}>
          <button type="submit">Entrar</button>
        </p>
      </form>
    </main>
  );
}
