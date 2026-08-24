// app/panel/[slug]/tarifas/page.tsx — cuánto sale la hora. Permiso: tarifa.administrar (owner).
//
// La pantalla muestra el CUADRO resuelto (qué paga hoy cada profesional en cada sala) usando la
// MISMA función que cobra el alta de reserva. Si acá dice $8.000, la reserva cobra $8.000 (§5.1).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { horasYMinutos } from "../../../../src/dominio/reporte.ts";
import { abonosVigentes, cobrarAbonosDelMes, ponerAbonoMensual } from "../../../../src/servicios/config/abonos.ts";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { cerrarTarifa, ponerTarifa, ponerTarifasEnLote, tarifasVigentes } from "../../../../src/servicios/config/tarifas.ts";
import { pendientesPorProfesional, recotizarPendientes, reservasSinPrecio } from "../../../../src/servicios/plata/recotizar.ts";
import { FormPrecio } from "./FormPrecio.tsx";
import { BotonEnviar } from "../BotonEnviar.tsx";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";

export default async function TarifasPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; ok?: string; cobrados?: string; repetidos?: string; cotizadas?: string; restantes?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { error, ok } = sp;
  const cobrados = sp.cobrados != null ? Number(sp.cobrados) : null;
  const repetidos = Number(sp.repetidos ?? 0);

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Esconder el formulario NO es el control: la acción revalida el permiso igual (§6.2).
  if (!puede(actor.rol, "tarifa.administrar")) redirect(`/panel/${slug}`);

  const [salas, inquilinos, vigentes, operador] = await Promise.all([
    prisma.sala.findMany({
      where: { operadorId: actor.operadorId, activa: true },
      select: { id: true, nombre: true },
      orderBy: { orden: "asc" },
    }),
    // Los de baja también: pueden tener horas facturadas y un precio propio que sigue explicando
    // su resumen del mes pasado (§3.6).
    prisma.inquilino.findMany({
      where: { operadorId: actor.operadorId },
      select: { id: true, nombre: true, estado: true },
      orderBy: { nombre: "asc" },
    }),
    tarifasVigentes(actor.operadorId),
    prisma.operador.findUniqueOrThrow({ where: { id: actor.operadorId }, select: { moneda: true } }),
  ]);
  const abonos = await abonosVigentes(actor.operadorId);
  // El mes por defecto es el del CENTRO, no el del navegador: un operador en otra zona no puede
  // ver un mes distinto al que factura (§14.4). La zona sale de la sede y NO tiene default: sin
  // sede no hay centro, y adivinar una zona es exactamente el bug que el guardarraíl §14.4 evita.
  const sede = await prisma.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) redirect(`/panel/${slug}`);
  const mesActual = fechaEnZona(new Date(), sede.zonaHoraria).slice(0, 7);
  const conAbono = new Set(abonos.map((a) => a.inquilino.id));

  const activos = inquilinos.filter((i) => i.estado === "activo");
  // Reservas que nacieron antes de que hubiera precios y quedaron sin importe. Es plata que no
  // se está cobrando, y sin este número nadie se entera: en la agenda se ven normales.
  const sinPrecio = await reservasSinPrecio(actor.operadorId);
  // A quién le corresponden y con qué precio van a entrar. Se calcula solo si hay algo pendiente:
  // en el caso normal —cero— no se paga ninguna consulta de más.
  const pendientes = sinPrecio > 0 ? await pendientesPorProfesional(actor.operadorId) : [];
  const plata = (c: bigint) => formatearPesos(c, operador.moneda);


  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const alcance = String(formData.get("alcance") ?? "todos");

    // "Todos menos…" es un guardado distinto: el general y los precios propios de los excluidos
    // van en UNA transacción. Los dos arrays vienen apareados por posición desde el formulario.
    if (alcance === "todos-menos") {
      const ids = formData.getAll("excepcionId").map(String);
      const precios = formData.getAll("excepcionPrecio").map(String);
      const r = await ponerTarifasEnLote(a, {
        precioHora: formData.get("precioHora"),
        excepciones: ids.map((inquilinoId, n) => ({ inquilinoId, precioHora: precios[n] ?? "" })),
      });
      revalidatePath(`/panel/${slug}/tarifas`);
      const qs = !r.ok ? `?error=${r.error}` : !r.data.ok ? `?error=${r.data.error}` : "?ok=1";
      redirect(`/panel/${slug}/tarifas${qs}`);
    }

    const r = await ponerTarifa(a, {
      precioHora: formData.get("precioHora"),
      // El precio NO depende del consultorio: es del profesional (o general del centro). Se
      // manda null siempre, así toda tarifa nueva nace con alcance de profesional.
      salaId: null,
      // Con "Todos" el campo viaja vacío, que el esquema convierte en null (= general).
      inquilinoId: alcance === "uno" ? formData.get("inquilinoId") : null,
    });

    revalidatePath(`/panel/${slug}/tarifas`);
    const qs = !r.ok ? `?error=${r.error}` : !r.data.ok ? `?error=${r.data.error}` : "?ok=1";
    redirect(`/panel/${slug}/tarifas${qs}`);
  }

  async function ponerPrecioAPendientes() {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await recotizarPendientes(a, {});
    revalidatePath(`/panel/${slug}/tarifas`);
    redirect(
      `/panel/${slug}/tarifas${r.ok ? `?cotizadas=${r.data.cotizadas}&restantes=${r.data.restantes}` : `?error=${r.error}`}`,
    );
  }

  async function guardarAbono(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await ponerAbonoMensual(a, {
      inquilinoId: formData.get("abonoInquilinoId"),
      montoMensual: formData.get("montoMensual"),
    });
    revalidatePath(`/panel/${slug}/tarifas`);
    redirect(`/panel/${slug}/tarifas${r.ok && r.data.ok ? "?ok=1" : "?error=ABONO"}`);
  }

  async function cobrarAbonos(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await cobrarAbonosDelMes(a, { periodo: formData.get("periodo") });
    revalidatePath(`/panel/${slug}/tarifas`);
    const q = r.ok ? `?cobrados=${r.data.cobrados}&repetidos=${r.data.yaEstaban}` : "?error=ABONO";
    redirect(`/panel/${slug}/tarifas${q}`);
  }

  async function darDeBaja(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    await cerrarTarifa(a, { tarifaId: formData.get("tarifaId") });
    revalidatePath(`/panel/${slug}/tarifas`);
    redirect(`/panel/${slug}/tarifas?ok=1`);
  }

  const mensaje =
    error === "SIN_PERMISO"
      ? "Tu rol no puede cambiar precios."
      : error === "ENTRADA_INVALIDA"
        ? "Revisá el importe: tiene que ser un número de 0 en adelante."
        : error === "SALA_INEXISTENTE" || error === "PROFESIONAL_INEXISTENTE"
          ? "Ese profesional ya no existe."
          : error === "PROFESIONAL_REPETIDO"
            ? "Marcaste dos veces al mismo profesional. Dejá un solo importe por persona."
          : error
            ? "No se pudo guardar el precio."
            : null;

  return (
    <>
      <Cabecera slug={slug} titulo="Precio de la hora" />
      <main style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
      {/* ── Lo que rige hoy ─────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 16, marginTop: 20 }}>Precios cargados</h2>
      {vigentes.length === 0 ? (
        <p className="tenue">
          Todavía no cargaste ningún precio. Las reservas se van a crear igual, pero no van a
          generar deuda: cargá al menos el general.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--borde)" }}>
              <th style={{ padding: "6px 4px" }}>Aplica a</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Por hora</th>
              <th style={{ padding: "6px 4px" }}>Desde</th>
              <th style={{ padding: "6px 4px" }} />
            </tr>
          </thead>
          <tbody>
            {vigentes.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid var(--borde)" }}>
                <td style={{ padding: "8px 4px" }}>{t.nombre}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}><strong>{plata(t.precioHoraCent)}</strong></td>
                <td style={{ padding: "8px 4px" }} className="tenue">
                  {new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(t.vigenteDesde)}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>
                  <form action={darDeBaja} style={{ display: "inline" }}>
                    <input type="hidden" name="tarifaId" value={t.id} />
                    {/* Una X redonda en vez de "Dar de baja" escrito: con siete precios en fila,
                        la misma frase repetida siete veces pesaba más que los números, que son
                        lo que uno viene a mirar. El texto vive en el title y en el aria-label,
                        así que sigue estando para quien lo necesita. */}
                    <button
                      type="submit"
                      className="nav-circ"
                      title={`Dar de baja el precio de ${t.nombre}`}
                      aria-label={`Dar de baja el precio de ${t.nombre}`}
                      style={{ color: "var(--error)", borderColor: "var(--borde)", cursor: "pointer" }}
                    >
                      ×
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Reservas que quedaron sin precio ────────────────────────────── */}
      {/* Aparece SOLO si hay: es un arreglo puntual, no una función permanente de la pantalla.
          Pasa siempre igual — se carga la agenda antes que los precios, que es el orden natural —
          y sin este aviso esas horas no se cobran nunca: en la agenda se ven normales, y el
          guioncito de la columna Importe no grita nada. */}
      {sinPrecio > 0 && (
        <form action={ponerPrecioAPendientes} className="panel" style={{ marginTop: 20, borderLeft: "4px solid var(--alerta)" }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>
            {sinPrecio === 1 ? "Hay 1 reserva sin precio" : `Hay ${sinPrecio} reservas sin precio`}
          </h2>
          <p className="tenue" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Se crearon antes de que cargaras los precios, así que no generaron deuda: ocupan la
            agenda pero no aparecen en ninguna suma. Poniéndoles el precio vigente de cada
            profesional pasan a facturarse.
          </p>
          <p className="tenue" style={{ margin: "6px 0 0", fontSize: 13 }}>
            No toca las que ya tienen importe: un precio estampado no se reescribe.
          </p>

          {/* A QUIÉNES corresponden, y con qué precio van a entrar. Un botón que factura 1421
              reservas de un saque sin decir a quién le pega no se puede revisar antes de
              apretarlo: acá se ve que cada uno entra con SU valor hora, o que a alguno le falta
              la tarifa y por eso no va a entrar. */}
          <div style={{ overflowX: "auto", margin: "14px 0 0" }}>
            <table>
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th className="num">Reservas</th>
                  <th className="num">Horas</th>
                  <th className="num">Valor hora</th>
                  <th className="num">Suma</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((p) => (
                  <tr key={p.inquilinoId}>
                    <td>{p.nombre}</td>
                    <td className="num">{p.reservas}</td>
                    <td className="num">{horasYMinutos(p.minutos)}</td>
                    <td className="num">
                      {p.precioHoraCent === null ? (
                        <span style={{ color: "var(--error)" }}>sin tarifa</span>
                      ) : p.precioHoraCent === 0n ? (
                        // Cero no es un dato que falte: es alguien que usa el consultorio y no
                        // factura. Mostrarlo como "$ 0,00" al lado de un "sin tarifa" en rojo
                        // invita a "arreglarlo", que es justo lo que no hay que hacer.
                        <span className="tenue">no factura</span>
                      ) : (
                        plata(p.precioHoraCent)
                      )}
                    </td>
                    <td className="num">{p.precioHoraCent === null ? "—" : plata(p.importeCent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pendientes.some((p) => p.precioHoraCent === null) && (
            <p className="tenue" style={{ margin: "10px 0 0", fontSize: 13 }}>
              A los que dicen <b>sin tarifa</b> no se les va a poder poner precio: cargales primero
              el valor hora acá abajo y volvé a apretar.
            </p>
          )}

          <p style={{ marginTop: 14, marginBottom: 0 }}>
            <BotonEnviar enviando="Poniendo precios…">Ponerles el precio vigente</BotonEnviar>
          </p>
        </form>
      )}
      {sp.cotizadas && (
        <p className={sp.restantes && sp.restantes !== "0" ? "aviso-error" : "aviso-ok"} style={{ marginTop: 20 }}>
          {sp.cotizadas === "0" && (!sp.restantes || sp.restantes === "0")
            ? "No se pudo poner precio a ninguna: falta cargar la tarifa que les corresponde."
            : `${sp.cotizadas} ${Number(sp.cotizadas) === 1 ? "reserva quedó facturada" : "reservas quedaron facturadas"}.`}
          {/* Con muchas pendientes el trabajo no entra en el tiempo de una función, así que se
              hace por tandas. Decir cuántas faltan es lo que convierte un corte silencioso en un
              paso más: lo hecho está hecho y volver a apretar sigue donde quedó. */}
          {sp.restantes && sp.restantes !== "0" && (
            <span style={{ display: "block", fontWeight: 400, marginTop: 4 }}>
              Quedan {sp.restantes} por hacer: eran muchas para una sola pasada. Apretá el botón de
              nuevo para seguir — nada se cobra dos veces.
            </span>
          )}
        </p>
      )}

      {/* ── Poner un precio ─────────────────────────────────────────────── */}
      {/* El formulario es de cliente porque marcar a alguien en "Todos menos…" tiene que hacer
          aparecer su casillero de importe. La acción sigue siendo del servidor. */}
      <FormPrecio
        accion={guardar}
        inquilinos={inquilinos.map((i) => ({ id: i.id, nombre: i.nombre, estado: i.estado }))}
        mensaje={mensaje}
        ok={ok === "1"}
      />

      {/* ── Qué paga cada uno, resuelto ─────────────────────────────────── */}
      {/* ── Abonos mensuales ────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 16, marginTop: 26 }}>Abonos mensuales</h2>
      <p className="tenue" style={{ marginTop: 4 }}>
        Para los que NO alquilan por hora y pagan un fijo todos los meses. Poner 0 da de baja el
        abono.
      </p>

      <form className="panel" action={guardarAbono} style={{ marginTop: 10 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr", alignItems: "end" }}>
          <div>
            <label htmlFor="abonoInquilinoId">Profesional</label>
            <select id="abonoInquilinoId" name="abonoInquilinoId" defaultValue="" required>
              <option value="" disabled>Elegí uno</option>
              {inquilinos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}{conAbono.has(i.id) ? " · con abono" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="montoMensual">Importe por mes</label>
            <input id="montoMensual" name="montoMensual" type="number" min={0} step="0.01" required placeholder="250000" />
          </div>
        </div>
        <p style={{ marginTop: 14, marginBottom: 0 }}><button type="submit">Guardar abono</button></p>
      </form>

      {abonos.length > 0 && (
        <div className="panel" style={{ marginTop: 12, padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Profesional</th>
                <th>Quién abona</th>
                <th className="num">Por mes</th>
              </tr>
            </thead>
            <tbody>
              {abonos.map((a) => (
                <tr key={a.id}>
                  <td>{a.inquilino.nombre}</td>
                  {/* Quién paga NO cambia de quién es la deuda: es un dato para facturar y cobrar. */}
                  <td className="tenue">{a.inquilino.pagador ?? "el mismo profesional"}</td>
                  <td className="num">{plata(a.precioMensualCent)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{abonos.length} abono{abonos.length === 1 ? "" : "s"} por mes</td>
                <td className="num">{plata(abonos.reduce((t, a) => t + a.precioMensualCent, 0n))}</td>
              </tr>
            </tfoot>
          </table>

          {/* El cobro lo dispara una persona, no un proceso de fondo: facturar solo genera deuda
              que nadie miró, y el día que el importe está mal ya salió el resumen a todos. */}
          <form action={cobrarAbonos} style={{ padding: 14, borderTop: "1px solid var(--borde)", display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 auto" }}>
              <label htmlFor="periodo" style={{ marginTop: 0 }}>Cobrar el mes</label>
              <input id="periodo" name="periodo" type="month" defaultValue={mesActual} required style={{ width: "auto" }} />
            </div>
            <button type="submit" className="btn-suave">Cargar abonos del mes</button>
            {cobrados !== null && (
              <span className="exito" style={{ fontSize: 13 }}>
                {cobrados === 0
                  ? "Ya estaban todos cargados este mes."
                  : `${cobrados} abono${cobrados === 1 ? "" : "s"} cargado${cobrados === 1 ? "" : "s"}.`}
                {repetidos > 0 && <span className="tenue"> {repetidos} ya estaba{repetidos === 1 ? "" : "n"}.</span>}
              </span>
            )}
          </form>
        </div>
      )}

      {/* Acá vivía "Qué paga hoy la hora": la misma lista que "Precios cargados", unas líneas más
          arriba. Dos tablas con los mismos números invitan a compararlas para ver en qué difieren
          —y no difieren en nada—, además de dejar dos lugares donde arreglar el mismo error. */}

      </main>
    </>
  );
}
