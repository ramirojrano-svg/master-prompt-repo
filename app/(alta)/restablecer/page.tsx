// app/(alta)/restablecer/page.tsx — poner la contraseña nueva, con el token que vino por mail.
//
// El token se valida ANTES de dibujar el formulario: pedirle a alguien que invente una contraseña
// para después decirle que el enlace venció es hacerle perder el tiempo dos veces.
//
// Y se vuelve a validar al guardar, obviamente: entre que se abrió la pantalla y se apretó el
// botón pudo vencer, usarse en otra pestaña, o llegar un POST que nunca pasó por acá.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "../../Logo.tsx";
import { CampoClave } from "../login/CampoClave.tsx";
import { BotonEnviar } from "../../panel/[slug]/BotonEnviar.tsx";
import { LARGO_MIN_CLAVE } from "../../../src/servicios/config/accesos.ts";
import { MINUTOS_VIGENCIA, tokenVigente, usarReset, UsarResetInput } from "../../../src/servicios/config/reset-clave.ts";

export default async function RestablecerPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const token = sp.token ?? "";
  const sirve = token.length >= 20 && (await tokenVigente(token));

  async function guardar(formData: FormData) {
    "use server";
    const p = UsarResetInput.safeParse({ token: formData.get("token"), password: formData.get("password") });
    if (!p.success) {
      // Se distingue la clave corta del token roto: son dos arreglos distintos y decir "enlace
      // inválido" cuando el problema es la contraseña manda a pedir otro mail al pedo.
      const corta = p.error.issues.some((i) => i.path[0] === "password");
      redirect(`/restablecer?token=${encodeURIComponent(String(formData.get("token") ?? ""))}&error=${corta ? "corta" : "token"}`);
    }

    const r = await usarReset(p.data);
    if (!r.ok) redirect("/restablecer?error=token");
    // Sin sesión iniciada a propósito: quien cambió la clave la escribe una vez más al entrar, y
    // ese segundo tipeo es lo que confirma que quedó la que quería.
    redirect("/login?cambiada=1");
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

        {!sirve || sp.error === "token" ? (
          <div className="panel" style={{ padding: 26 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>Ese enlace ya no sirve</h1>
            <p className="tenue" style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>
              Los enlaces vencen a los {MINUTOS_VIGENCIA} minutos y se pueden usar una sola vez. Si
              todavía necesitás cambiar la contraseña, pedí uno nuevo.
            </p>
            <p style={{ marginTop: 20, marginBottom: 0 }}>
              <Link href="/olvide" className="pastilla" style={{ padding: "9px 20px" }}>
                Pedir otro enlace
              </Link>
            </p>
          </div>
        ) : (
          <form className="panel" action={guardar} style={{ padding: 26 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>Poné tu contraseña nueva</h1>
            <p className="tenue" style={{ margin: "6px 0 4px", fontSize: 13 }}>
              Al menos {LARGO_MIN_CLAVE} caracteres. Al guardarla se cierran las sesiones abiertas
              en otros dispositivos.
            </p>

            <input type="hidden" name="token" value={token} />
            <CampoClave />

            {sp.error === "corta" && (
              <p className="error" style={{ marginBottom: 0 }}>
                La contraseña tiene que tener al menos {LARGO_MIN_CLAVE} caracteres.
              </p>
            )}

            <p style={{ marginTop: 20, marginBottom: 0 }}>
              <BotonEnviar enviando="Guardando…">Guardar y entrar</BotonEnviar>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
