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
  const horas = d.totales.minutos / 60;
  const vivos = d.turnos.filter((t) => t.estado !== "cancelada");

  return (
    <>
      <CerrarBurbujas />
      <Cabecera slug={slug} rol={actor.rol} actual="mis-reservas" titulo="Mis reservas" />

      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <nav style={{ display: "flex", gap: 2 }}>
            <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">‹</Link>
            {periodo < hoyPeriodo && (
              <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">›</Link>
            )}
          </nav>
          <h2 style={{ margin: 0 }}>{nombreDePeriodo(periodo)}</h2>
        </div>

        {okParam && AVISO[okParam] && (
          <p className="panel" style={{ padding: "10px 14px", margin: "0 0 12px", fontSize: 14 }}>{AVISO[okParam]}</p>
        )}
        {errorParam && (
          <p className="panel" style={{ padding: "10px 14px", margin: "0 0 12px", fontSize: 14, color: "var(--error)" }}>
            {mensajeDeTurno(errorParam)}
          </p>
        )}

        {/* ── Lo que hay que pagar ──────────────────────────────────────────── */}
        <section className="panel" style={{ padding: 22 }}>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>A pagar por {nombreDePeriodo(periodo)}</p>
          <p style={{ fontSize: 42, margin: "4px 0 2px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {plata(d.totales.importeCent)}
          </p>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            {horasYMinutos(d.totales.minutos)} en {vivos.length} {vivos.length === 1 ? "reserva" : "reservas"}
            {horas > 0 && <> · {plata(BigInt(Math.round(Number(d.totales.importeCent) / horas)))} la hora en promedio</>}
          </p>

          {/* El saldo sale del LIBRO, no de la suma de las reservas del mes: incluye meses
              anteriores, notas de crédito y ajustes. Por eso se muestra aparte y no como si el
              total de arriba fuera lo que se debe. */}
          {(d.totales.pagadoCent > 0n || d.totales.saldoCent !== 0n) && (
            <div style={{ display: "flex", gap: 22, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--borde)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>
                <span className="tenue">Pagado este mes: </span>
                <strong>{plata(d.totales.pagadoCent)}</strong>
              </span>
              <span style={{ fontSize: 13 }}>
                <span className="tenue">Tu saldo: </span>
                <strong style={{ color: d.totales.saldoCent > 0n ? "var(--error)" : "var(--ok)" }}>
                  {plata(d.totales.saldoCent)}
                </strong>
                <span className="tenue"> {d.totales.saldoCent > 0n ? "(acumulado de todos los meses)" : "(al día)"}</span>
              </span>
            </div>
          )}
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
                            <div className="globo-config" style={{ right: 0, top: 26, width: 250 }}>
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
              <tfoot>
                <tr>
                  <td colSpan={3}>{vivos.length} {vivos.length === 1 ? "reserva" : "reservas"}</td>
                  <td className="num">{horasYMinutos(d.totales.minutos)}</td>
                  <td className="num">{plata(d.totales.importeCent)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
