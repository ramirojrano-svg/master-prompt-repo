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
import { GOOGLE_LISTO, signIn } from "../../../src/lib/auth.ts";
import { prisma } from "../../../src/db/prisma.ts";
import { Logo } from "../../Logo.tsx";
import { CampoClave } from "./CampoClave.tsx";
import { IconoGoogle } from "../../Iconos.tsx";

/**
 * A qué centro mandar a un usuario que entró sin decir a cuál. Devuelve el slug del primer centro
 * donde tiene acceso ACTIVO, o null si no tiene ninguno.
 *
 * Existe porque el login sin `?centro=` mandaba a la portada, y la portada solo ofrece "Creá tu
 * centro": después de cerrar sesión, volver a entrar dejaba en una pantalla desde la que no se
 * podía llegar a la app. El dato para resolverlo siempre estuvo —el usuario tiene su acceso en la
 * base—, solo que nadie lo miraba.
 */
async function centroDe(email: string): Promise<string | null> {
  const uo = await prisma.usuarioOperador.findFirst({
    where: { activo: true, usuario: { email: email.trim().toLowerCase() } },
    select: { operador: { select: { slug: true } } },
    // Sin criterio de desempate: quien alquila en más de un centro entra al primero que devuelva
    // la base. Es aceptable porque desde el panel puede cambiar, y el caso hoy no existe — pero
    // el día que exista, acá va el "último centro visitado".
  });
  return uo?.operador.slug ?? null;
}

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
    // Sin `centro` en la URL —lo normal al entrar desde /login pelado, que es donde deja el cerrar
    // sesión— se resuelve por el usuario en vez de mandarlo a la portada.
    const destino = centro || (codigo ? null : await centroDe(email));

    // Los redirect() van FUERA del try: se implementan tirando una excepción, y adentro los
    // estaríamos cazando como si fueran un fallo del login.
    if (codigo) redirect(`/login?error=${codigo}${centro ? `&centro=${encodeURIComponent(centro)}` : ""}`);
    // Entró bien pero no tiene acceso a ningún centro: es un caso real (un acceso dado de baja) y
    // no puede terminar en la portada, que solo ofrece crear un centro nuevo.
    redirect(destino ? `/panel/${destino}` : "/login?error=sin-centro");
  }

  async function entrarConGoogle() {
    "use server";
    // `redirectTo` a la raíz del panel del centro si vino en la URL; si no, el login resuelve el
    // centro por el usuario igual que con la contraseña.
    await signIn("google", { redirectTo: sp.centro ? `/panel/${sp.centro}` : "/login" });
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px 16px",
        // Más oscuro que antes, que terminaba en blanco puro y dejaba la tarjeta —también blanca—
        // flotando sin borde visible contra el fondo. Ahora el degradé va de agua a un gris azulado
        // y la tarjeta se recorta sola.
        background: "linear-gradient(160deg, var(--agua) 0%, var(--agua-clara) 38%, #d7e6ee 100%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <Logo alto={96} />
        </div>

        <form className="panel" action={entrar} style={{ padding: 26 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Entrá a tu centro</h1>
          <p className="tenue" style={{ margin: "6px 0 4px", fontSize: 13 }}>
            Agenda, profesionales y facturación de Espacio Montes de Oca.
          </p>

          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="vos@email.com" />

          <CampoClave />

          <input type="hidden" name="centro" defaultValue={sp.centro ?? ""} />

          {sp.error === "sin-centro" ? (
            <p className="error" style={{ marginBottom: 0 }}>
              Tus datos son correctos, pero tu usuario no tiene acceso activo a ningún centro.
              <span className="tenue" style={{ display: "block", fontWeight: 400, marginTop: 4 }}>
                Pedile al dueño del centro que te reactive el acceso.
              </span>
            </p>
          ) : sp.error === "sistema" ? (
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

        {/* Google solo aparece si está configurado: un botón que lleva a una pantalla de error de
            Google es peor que no tenerlo. Y NO da de alta a nadie — solo confirma que quien entra
            es dueño de un email que el centro ya habilitó. */}
        {GOOGLE_LISTO && (
          <form action={entrarConGoogle} style={{ marginTop: 12 }}>
            <button
              type="submit"
              className="btn-suave"
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#fff", border: "1px solid var(--borde-fuerte)" }}
            >
              <IconoGoogle />
              Entrar con Google
            </button>
          </form>
        )}

        <p className="tenue" style={{ textAlign: "center", fontSize: 12, marginTop: 18 }}>
          Espacio Montes de Oca S.R.L. · espaciomontesdeoca@gmail.com
        </p>
      </div>
    </main>
  );
}
