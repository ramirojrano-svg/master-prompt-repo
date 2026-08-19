// app/panel/[slug]/correo/page.tsx — por qué no salen los mails.
//
// La pantalla de "olvidé mi contraseña" contesta lo mismo exista o no el email, y no cuenta si el
// envío falló: es lo correcto de cara a internet, y deja al que configura la instalación sin
// ninguna pista. Esta pantalla es el otro lado: solo para el administrador, y ahí sí se dice todo
// lo que se sabe — qué variables llegaron, cuáles no, y el error crudo del proveedor.
//
// NO muestra el valor de ninguna variable. Sí el largo y los dos errores de pegado que rompen en
// silencio (comillas alrededor, espacios en los bordes), que son los que más tiempo hacen perder.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { auth } from "../../../../src/lib/auth.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { diagnosticoEmail, type EstadoVariable } from "../../../../src/lib/email.ts";
import { mandarEmailDePrueba } from "../../../../src/servicios/config/email-prueba.ts";
import { BotonEnviar } from "../BotonEnviar.tsx";

function Fila({ v, requerida }: { v: EstadoVariable; requerida: boolean }) {
  const mal = requerida && !v.presente;
  return (
    <tr>
      <td><code>{v.nombre}</code></td>
      <td>
        {v.presente ? (
          <span style={{ color: "var(--ok, #1a7f4b)" }}>✓ llegó</span>
        ) : (
          <span className="tenue">{mal ? "falta" : "no cargada (opcional)"}</span>
        )}
      </td>
      <td className="num tenue">{v.presente ? `${v.largo} caracteres` : ""}</td>
      <td>{v.problema && <span style={{ color: "var(--error)" }}>{v.problema}</span>}</td>
    </tr>
  );
}

export default async function CorreoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detalle?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "usuarios.administrar")) redirect(`/panel/${slug}`);

  const sesion = await auth();
  const miEmail = sesion?.user?.email ?? "";
  const d = diagnosticoEmail();

  async function probar() {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const s = await auth();
    const para = s?.user?.email ?? "";

    const r = await mandarEmailDePrueba(a, { para });
    const base = `/panel/${slug}/correo`;
    if (!r.ok) redirect(`${base}?error=${r.error}`);
    if (r.data.ok) redirect(`${base}?ok=${r.data.via}`);
    redirect(`${base}?error=${r.data.motivo}&detalle=${encodeURIComponent((r.data.detalle ?? "").slice(0, 300))}`);
  }

  return (
    <>
      <Cabecera slug={slug} titulo="Envío de correo" />
      <main style={{ padding: 20, maxWidth: 820, margin: "0 auto" }}>
        <section className="panel" style={{ padding: 22 }}>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Estado</p>
          <p style={{ fontSize: 26, margin: "4px 0 0", fontWeight: 600 }}>
            {d.via === "resend" && "Configurado con Resend"}
            {d.via === "smtp" && "Configurado con SMTP"}
            {d.via === null && "Sin configurar"}
          </p>
          {d.via === null && (
            <p className="tenue" style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>
              Falta un juego completo de variables. Alcanza con UNO de los dos de abajo: para Resend,
              las dos de su bloque; para SMTP, usuario y contraseña.
            </p>
          )}
        </section>

        {sp.ok && (
          <p className="aviso-ok" style={{ marginTop: 16 }}>
            Mail de prueba enviado a {miEmail} por {sp.ok}. Si no aparece en un minuto, fijate en el
            correo no deseado.
          </p>
        )}
        {sp.error && (
          <div className="aviso-error" style={{ marginTop: 16 }}>
            {sp.error === "sin_configurar" ? (
              <>Todavía no hay ninguna vía configurada: cargá las variables y volvé a desplegar.</>
            ) : sp.error === "SIN_PERMISO" ? (
              <>No tenés permiso para esto.</>
            ) : (
              <>
                El proveedor rechazó el envío.
                {sp.detalle && (
                  <>
                    {" "}Dijo:
                    <code style={{ display: "block", marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12 }}>
                      {sp.detalle}
                    </code>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <h2 style={{ marginTop: 26 }}>Qué variables está viendo la app</h2>
        <p className="tenue" style={{ marginTop: 0, fontSize: 13 }}>
          Estos son los valores que llegaron al servidor <b>en este momento</b>. Si cargaste una
          variable en Vercel y acá dice “falta”, es que el deploy todavía no la tomó: las variables
          solo entran en un build nuevo.
        </p>

        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Estado</th>
                <th className="num">Largo</th>
                <th>Problema</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={4} className="tenue" style={{ fontWeight: 600 }}>Resend (necesita dominio propio)</td></tr>
              {d.resend.map((v) => <Fila key={v.nombre} v={v} requerida />)}
              <tr><td colSpan={4} className="tenue" style={{ fontWeight: 600 }}>SMTP / Gmail (no necesita dominio)</td></tr>
              {d.smtp.map((v) => (
                <Fila key={v.nombre} v={v} requerida={v.nombre === "SMTP_USER" || v.nombre === "SMTP_PASS"} />
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ marginTop: 26 }}>Probarlo</h2>
        <p className="tenue" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          Manda un correo a <b>{miEmail || "tu casilla"}</b>, la dirección con la que entraste. Si
          falla, acá abajo vas a ver lo que contestó el proveedor — que es lo que dice qué corregir.
        </p>
        <form action={probar}>
          <BotonEnviar enviando="Mandando…">Mandarme un mail de prueba</BotonEnviar>
        </form>

        <p className="tenue" style={{ marginTop: 26, fontSize: 13 }}>
          <Link href={`/panel/${slug}`}>Volver al panel</Link>
        </p>
      </main>
    </>
  );
}
