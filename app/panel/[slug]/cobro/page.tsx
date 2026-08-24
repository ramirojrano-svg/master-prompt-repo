// app/panel/[slug]/cobro/page.tsx — a dónde tiene que transferir el profesional.
//
// Son cuatro campos que se cargan una sola vez y se imprimen en el pie de cada liquidación. Sin
// ellos el papel dice cuánto hay que pagar y no a dónde, así que el circuito terminaba igual en un
// WhatsApp preguntando el alias.
//
// Están acá y no en el código a propósito: un CBU es un dato del negocio, no una constante del
// programa. Quemarlo en el repositorio significa que cambiar de banco es un despliegue, y que la
// cuenta de alguien queda escrita en el historial de git para siempre.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Cabecera } from "../Cabecera.tsx";
import { BotonEnviar } from "../BotonEnviar.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { datosDeCobro, guardarDatosDeCobro } from "../../../../src/servicios/config/cobro.ts";

export default async function CobroPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "publica.configurar")) redirect(`/panel/${slug}`);

  const d = await datosDeCobro(actor.operadorId);

  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await guardarDatosDeCobro(a, {
      titular: formData.get("titular"),
      cuit: formData.get("cuit"),
      cbu: formData.get("cbu"),
      alias: formData.get("alias"),
      banco: formData.get("banco"),
      nota: formData.get("nota"),
      diaVencimiento: formData.get("diaVencimiento"),
    });
    revalidatePath(`/panel/${slug}/cobro`);
    redirect(`/panel/${slug}/cobro?${r.ok && r.data.ok ? "ok=1" : "error=1"}`);
  }

  return (
    <>
      <Cabecera slug={slug} titulo="Datos de cobro" />
      <main style={{ padding: 20, maxWidth: 620, margin: "0 auto" }}>
        {sp.ok && <p className="aviso-ok">Guardado. Va a salir en el pie de las próximas liquidaciones.</p>}
        {sp.error && <p className="aviso-error">No se pudo guardar. Revisá que el día de vencimiento esté entre 1 y 28.</p>}

        <form action={guardar} className="panel" style={{ padding: 20, display: "grid", gap: 14 }}>
          <div>
            <label htmlFor="titular" style={{ marginTop: 0 }}>Titular de la cuenta</label>
            <input id="titular" name="titular" defaultValue={d.titular ?? ""} placeholder="Nombre y apellido" />
          </div>
          <div>
            <label htmlFor="cuit" style={{ marginTop: 0 }}>CUIT</label>
            <input id="cuit" name="cuit" defaultValue={d.cuit ?? ""} placeholder="20-12345678-9" />
          </div>
          <div>
            <label htmlFor="alias" style={{ marginTop: 0 }}>Alias</label>
            <input id="alias" name="alias" defaultValue={d.alias ?? ""} placeholder="mi.alias.banco" />
          </div>
          <div>
            <label htmlFor="cbu" style={{ marginTop: 0 }}>CBU o CVU</label>
            {/* Monoespaciada también acá: veintidós dígitos se tipean mirando, y en una
                proporcional el 1 y el 7 se confunden justo cuando más caro sale. */}
            <input id="cbu" name="cbu" defaultValue={d.cbu ?? ""} inputMode="numeric" style={{ fontFamily: "ui-monospace, monospace" }} placeholder="0000000000000000000000" />
          </div>
          <div>
            <label htmlFor="banco" style={{ marginTop: 0 }}>Banco o billetera <span className="tenue">(opcional)</span></label>
            <input id="banco" name="banco" defaultValue={d.banco ?? ""} placeholder="Astropay, Galicia…" />
          </div>
          <div>
            <label htmlFor="nota" style={{ marginTop: 0 }}>Aclaración <span className="tenue">(opcional)</span></label>
            <input id="nota" name="nota" defaultValue={d.nota ?? ""} placeholder="Poner el apellido en el concepto" />
          </div>
          <div>
            <label htmlFor="diaVencimiento" style={{ marginTop: 0 }}>Vencimiento: día de cada mes</label>
            <input id="diaVencimiento" name="diaVencimiento" type="number" min={1} max={28} required defaultValue={d.diaVencimiento} style={{ width: 90 }} />
            {/* El tope de 28 no es capricho: un vencimiento el 30 no existe en febrero, y una
                fecha que algunos meses no existe es una fecha que algún mes falla. */}
          </div>
          <BotonEnviar enviando="Guardando…">Guardar</BotonEnviar>
        </form>
      </main>
    </>
  );
}
