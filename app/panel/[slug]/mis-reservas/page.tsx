// app/panel/[slug]/mis-reservas/page.tsx — lo que reservó el profesional, y cuánto le toca pagar.
//
// La agenda sirve para AGENDAR: se mira un día y se busca un hueco. Esta pantalla contesta la otra
// pregunta, la de fin de mes: "qué reservé y cuánto tengo que pagar". En la agenda eso obliga a
// recorrer día por día sumando de memoria.
//
// Usa `detalleProfesional`, el MISMO servicio que la ficha que ve la administración. Que las dos
// pantallas salgan del mismo cálculo no es comodidad: si el profesional viera un total y el
// administrador otro, la discusión no la gana nadie y la app deja de servir para cobrar.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { CerrarBurbujas } from "../CerrarBurbujas.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { detalleProfesional } from "../../../../src/servicios/reportes/mensual.ts";
import { cancelarReservaPropia, moverReservaPropia, mensajeDeTurno } from "../../../../src/servicios/agenda/acciones.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, horasYMinutos, nombreDePeriodo, periodoAnterior, periodoSiguiente } from "../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { nombrarFecha } from "../../../../src/dominio/conflictos.ts";

export default async function MisReservasPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periodo?: string; ok?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { periodo: periodoParam, ok: okParam, error: errorParam } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Es la pantalla de UN profesional sobre lo suyo. Sin ficha vinculada no hay "lo suyo".
  if (!puede(actor.rol, "reserva.crear.propia") || !actor.inquilinoId) redirect(`/panel/${slug}`);
  const inquilinoId = actor.inquilinoId;

  const sede = await prisma.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) redirect(`/panel/${slug}`);
  const hoy = fechaEnZona(new Date(), sede.zonaHoraria);
  const hoyPeriodo = hoy.slice(0, 7);
  const periodo = periodoParam && esPeriodoValido(periodoParam) ? periodoParam : hoyPeriodo;

  const d = await detalleProfesional({ actor, periodo, inquilinoId });
  if (!d) redirect(`/panel/${slug}`);

  const plata = (c: bigint) => formatearPesos(c, d.moneda);
  const volverA = `/panel/${slug}/mis-reservas?periodo=${periodo}`;
  const rutaMisReservas = `/panel/${slug}/mis-reservas`;

  // Los consultorios, para poder cambiar de sala al editar.
  const salas = await prisma.sala.findMany({
    where: { operadorId: actor.operadorId, activa: true },
    select: { id: true, nombre: true },
    orderBy: { orden: "asc" },
  });

  async function cancelar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await cancelarReservaPropia(a, { ocupacionId: formData.get("ocupacionId"), alcance: "solo" });
    revalidatePath(rutaMisReservas);
    const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
    redirect(`${volverA}${codigo ? `&error=${codigo}` : "&ok=cancelada"}`);
  }

  async function editar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await moverReservaPropia(a, {
      ocupacionId: formData.get("ocupacionId"),
      salaDestinoId: formData.get("salaDestinoId"),
      fecha: formData.get("fecha"),
      hora: formData.get("hora"),
    });
    revalidatePath(rutaMisReservas);
    const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
    redirect(`${volverA}${codigo ? `&error=${codigo}` : "&ok=movida"}`);
  }

  const AVISO: Record<string, string> = {
    cancelada: "Reserva cancelada. La hora quedó libre y el cargo se revirtió.",
    movida: "Reserva movida.",
  };

  // Las horas del mes valorizadas. Se muestra el detalle Y el total: un número grande sin las
  // filas que lo forman no se puede discutir, y es justamente el número que se va a discutir.
  const vivos = d.turnos.filter((t) => t.estado !== "cancelada");
  // Los precios por hora que aparecen en el mes, sin repetir. Casi siempre es uno solo.
  const precios = [...new Set(vivos.map((t) => t.precioHoraCent).filter((p): p is bigint => p != null))];

  return (
    <>
      <CerrarBurbujas />
      <Cabecera slug={slug} titulo="Mis reservas" />

      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <nav style={{ display: "flex", gap: 2 }}>
            {/* Se puede ir hacia ADELANTE, no solo hacia atrás. Antes la flecha de mes siguiente
                aparecía solo estando en un mes pasado, con la idea de que esto es la pantalla de
                "cuánto tengo que pagar" y el futuro todavía no se paga. Pero también es la lista
                de lo que uno tiene reservado: quien agenda todos los martes del año veía el turno
                de este mes y ninguno de los siguientes, sin ninguna forma de llegar a ellos —
                parecía que la repetición no se había creado. */}
            <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">‹</Link>
            <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">›</Link>
          </nav>
          <h2 style={{ margin: 0 }}>{nombreDePeriodo(periodo)}</h2>
        </div>

        {okParam && AVISO[okParam] && <p className="aviso-ok">{AVISO[okParam]}</p>}
        {errorParam && <p className="aviso-error">{mensajeDeTurno(errorParam)}</p>}

        {/* ── Lo que hay que pagar ──────────────────────────────────────────── */}
        <section className="panel" style={{ padding: 22 }}>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>A pagar por {nombreDePeriodo(periodo)}</p>
          <p style={{ fontSize: 42, margin: "4px 0 2px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {plata(d.totales.importeCent)}
          </p>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            {horasYMinutos(d.totales.minutos)} en {vivos.length} {vivos.length === 1 ? "reserva" : "reservas"}
            {/* El precio que se muestra es el ESTAMPADO en las reservas, no un promedio ni la
                tarifa de hoy: es el que explica el total de arriba. Si en el mes convivieran dos
                precios distintos (porque hubo un cambio a mitad de mes), un solo número mentiría —
                ahí se dice que hubo varios en vez de elegir uno. */}
            {precios.length === 1 && <> × {plata(precios[0]!)} la hora</>}
            {precios.length > 1 && <> · con {precios.length} precios distintos en el mes</>}
          </p>

          {/* Acá estaban "Pagado este mes" y "Tu saldo". Se sacaron: esta pantalla contesta qué
              reservé y cuánto suma, y el saldo acumulado es otra conversación —la de cobranza—
              que además arrastra meses viejos y confunde al lado del total del mes. */}
        </section>

        {/* ── Reserva por reserva ───────────────────────────────────────────── */}
        <h2 style={{ marginTop: 26 }}>Reserva por reserva</h2>
        {d.turnos.length === 0 ? (
          <p className="tenue">
            No tenés reservas en {nombreDePeriodo(periodo)}. <Link href={`/panel/${slug}`}>Ir al calendario</Link>
          </p>
        ) : (
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Horario</th>
                  <th>Consultorio</th>
                  <th className="num">Duración</th>
                  <th className="num">Importe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.turnos.map((t) => {
                  const cancelada = t.estado === "cancelada";
                  // Lo pasado no se toca: mover o cancelar una hora que ya ocurrió no libera nada
                  // y descuadraría lo facturado.
                  const futura = t.fecha > hoy || (t.fecha === hoy && !cancelada);
                  const editable = !cancelada && futura;
                  return (
                    <tr key={t.id} style={cancelada ? { opacity: 0.5 } : undefined}>
                      <td style={{ whiteSpace: "nowrap", textDecoration: cancelada ? "line-through" : undefined }}>
                        {nombrarFecha(t.fecha)}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{t.horaTexto}</td>
                      <td>{t.salaNombre}</td>
                      <td className="num">{horasYMinutos(t.minutos)}</td>
                      <td className="num">{t.importeCent == null ? <span className="tenue">—</span> : plata(t.importeCent)}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        {cancelada ? (
                          <span className="tenue" style={{ fontSize: 12 }}>cancelada</span>
                        ) : !editable ? (
                          <span className="tenue" style={{ fontSize: 12 }}>ya pasó</span>
                        ) : (
                          <details data-burbuja style={{ display: "inline-block", position: "relative" }}>
                            <summary className="btn-texto" style={{ cursor: "pointer", listStyle: "none" }}>
                              Cambiar
                            </summary>
                            {/* Alineado a la derecha de la celda y por debajo del "Cambiar". El ancho lo pone la
                                  clase; acá solo va dónde cae respecto de su celda. */}
                            <div className="globo-config" style={{ right: 0, top: 26 }}>
                              <form action={editar}>
                                <input type="hidden" name="ocupacionId" value={t.id} />
                                <label htmlFor={`s-${t.id}`} style={{ marginTop: 0 }}>Consultorio</label>
                                <select id={`s-${t.id}`} name="salaDestinoId" required defaultValue={t.salaId ?? ""}>
                                  {salas.map((s) => (
                                    <option key={s.id} value={s.id}>{s.nombre}</option>
                                  ))}
                                </select>
                                <label htmlFor={`f-${t.id}`}>Día</label>
                                <input id={`f-${t.id}`} name="fecha" type="date" required defaultValue={t.fecha} min={hoy} />
                                <label htmlFor={`h-${t.id}`}>Empieza</label>
                                <input id={`h-${t.id}`} name="hora" type="time" required step={900} defaultValue={t.horaTexto.slice(0, 5)} />
                                <p style={{ marginTop: 12, marginBottom: 0 }}>
                                  <button type="submit" style={{ width: "100%" }}>Guardar</button>
                                </p>
                              </form>

                              <form action={cancelar} style={{ marginTop: 8 }}>
                                <input type="hidden" name="ocupacionId" value={t.id} />
                                <button type="submit" style={{ width: "100%", background: "var(--error)" }}>
                                  Cancelar reserva
                                </button>
                              </form>
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Sin fila de totales: los mismos tres números —cuántas reservas, cuántas horas y
                  cuánto suma— ya están arriba, en el panel de "A pagar", y ahí es donde se los
                  busca. Repetidos al pie no agregaban nada y hacían dudar de si hablaban de lo
                  mismo. El detalle de esta tabla es el que explica ese total, no otro. */}
            </table>
          </div>
        )}
      </main>
    </>
  );
}
