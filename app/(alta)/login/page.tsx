// app/(alta)/login/page.tsx — login del operador.
// El mensaje de error es UNO SOLO para email inexistente y contraseña incorrecta: no se filtra
// si el email existe (§6.11: nunca un oráculo de padrón).
//
// Pero "no te conozco" y "no te pude preguntar" son cosas distintas y antes se mostraban igual:
// el catch era mudo y CUALQUIER excepción —la base caída, la base sin tablas— terminaba en
// "email o contraseña incorrectos". Con la base vacía eso manda a resetear contraseñas que
// estaban perfectas. Distinguirlo no filtra nada del padrón: el fallo de infraestructura no
// depende de qué email se tipeó.
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
    let codigo: string | null = null;
    try {
      await signIn("credentials", { email, password, redirect: false });
    } catch (e) {
      // Auth.js marca con type "CredentialsSignin" SOLO el caso en que authorize() devolvió
      // null, o sea credenciales que no verifican. Cualquier otro type significa que la
      // verificación no llegó a hacerse (authorize tiró), y eso es un problema del sistema.
      codigo = (e as { type?: string })?.type === "CredentialsSignin" ? "1" : "sistema";
    }
    // Los redirect() van FUERA del try: se implementan tirando una excepción, y adentro los
    // estaríamos cazando como si fueran un fallo del login.
    if (codigo) redirect(`/login?error=${codigo}${centro ? `&centro=${encodeURIComponent(centro)}` : ""}`);
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

          {sp.error === "sistema" ? (
            <p className="error" style={{ marginBottom: 0 }}>
              No pudimos verificar tus datos: la base no está respondiendo.
              <span className="tenue" style={{ display: "block", fontWeight: 400, marginTop: 4 }}>
                No es tu contraseña. Si estás corriendo la app localmente, pará y corré{" "}
                <code>npm run doctor</code>: te dice qué falta.
              </span>
            </p>
          ) : (
            sp.error && (
              <p className="error" style={{ marginBottom: 0 }}>
                Email o contraseña incorrectos.
              </p>
            )
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
