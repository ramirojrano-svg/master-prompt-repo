// app/(alta)/login/page.tsx — login del operador.
// El mensaje de error es UNO SOLO para email inexistente y contraseña incorrecta: no se filtra
// si el email existe (§6.11: nunca un oráculo de padrón).
import { redirect } from "next/navigation";
import { signIn } from "../../../src/lib/auth.ts";
import { Logo } from "../../Logo.tsx";

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
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px 16px",
        background: "linear-gradient(160deg, var(--agua-clara) 0%, var(--fondo) 46%, #fff 100%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <Logo alto={54} />
        </div>

        <form className="panel" action={entrar} style={{ padding: 26 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Entrá a tu centro</h1>
          <p className="tenue" style={{ margin: "6px 0 4px", fontSize: 13 }}>
            Agenda, profesionales y facturación de Espacio Montes de Oca.
          </p>

          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="vos@email.com" />

          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />

          <input type="hidden" name="centro" defaultValue={sp.centro ?? ""} />

          {sp.error && (
            <p className="error" style={{ marginBottom: 0 }}>
              Email o contraseña incorrectos.
            </p>
          )}

          <p style={{ marginTop: 20, marginBottom: 0 }}>
            <button type="submit" style={{ width: "100%" }}>
              Entrar
            </button>
          </p>
        </form>

        <p className="tenue" style={{ textAlign: "center", fontSize: 12, marginTop: 18 }}>
          Espacio Montes de Oca S.R.L. · espaciomontesdeoca@gmail.com
        </p>
      </div>
    </main>
  );
}
