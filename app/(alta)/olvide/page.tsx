// app/(alta)/olvide/page.tsx — pedir el mail para restablecer la contraseña.
//
// La respuesta es SIEMPRE la misma, exista o no el email (§6.11). Si dijera "ese mail no está
// registrado", el formulario se convierte en un padrón: se escriben direcciones y la pantalla
// contesta cuáles son clientes del centro. El costo es que quien se equivoca de mail espera un
// correo que no llega — por eso el mensaje dice explícitamente "si ese mail tiene cuenta".

import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { Logo } from "../../Logo.tsx";
import { BotonEnviar } from "../../panel/[slug]/BotonEnviar.tsx";
import { pedirReset, PedirResetInput } from "../../../src/servicios/config/reset-clave.ts";

export default async function OlvidePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;

  async function pedir(formData: FormData) {
    "use server";
    const p = PedirResetInput.safeParse({ email: formData.get("email") });
    // Un email mal escrito tampoco dice nada distinto: mismo destino que el camino feliz.
    if (!p.success) redirect("/olvide?ok=1");

    // La URL base sale del pedido y no de una variable: el enlace tiene que apuntar al mismo lugar
    // desde el que se pidió (producción, una preview de Vercel, o localhost).
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

    const r = await pedirReset(p.data, { urlBase: `${proto}://${host}` });
    redirect(r.ok ? "/olvide?ok=1" : "/olvide?error=sin-email");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px 16px",
        background: "linear-gradient(160deg, var(--agua) 0%, var(--agua-clara) 38%, #d7e6ee 100%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <Logo alto={96} />
        </div>

        {sp.ok ? (
          <div className="panel" style={{ padding: 26 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>Revisá tu correo</h1>
            <p className="tenue" style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>
              Si ese mail tiene una cuenta, le acabamos de mandar un enlace para poner una
              contraseña nueva. Vence en una hora y sirve una sola vez.
            </p>
            <p className="tenue" style={{ margin: "10px 0 0", fontSize: 13 }}>
              ¿No te llegó? Fijate en el correo no deseado, o volvé a pedirlo.
            </p>
            <p style={{ marginTop: 20, marginBottom: 0 }}>
              <Link href="/login" className="pastilla" style={{ padding: "9px 20px" }}>
                Volver a entrar
              </Link>
            </p>
          </div>
        ) : (
          <form className="panel" action={pedir} style={{ padding: 26 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>¿Olvidaste tu contraseña?</h1>
            <p className="tenue" style={{ margin: "6px 0 4px", fontSize: 13 }}>
              Poné el mail con el que entrás y te mandamos un enlace para cambiarla.
            </p>

            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" placeholder="vos@email.com" />

            {sp.error === "sin-email" && (
              <p className="error" style={{ marginBottom: 0 }}>
                El envío de correos todavía no está configurado en esta instalación.
                <span className="tenue" style={{ display: "block", fontWeight: 400, marginTop: 4 }}>
                  Pedile al administrador del centro que te ponga una contraseña nueva desde el panel.
                </span>
              </p>
            )}

            <p style={{ marginTop: 20, marginBottom: 0 }}>
              <BotonEnviar enviando="Mandando…">Mandarme el enlace</BotonEnviar>
            </p>

            <p className="tenue" style={{ textAlign: "center", fontSize: 13, marginTop: 16, marginBottom: 0 }}>
              <Link href="/login">Volver</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
