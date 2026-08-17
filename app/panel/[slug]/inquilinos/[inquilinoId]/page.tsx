// app/panel/[slug]/inquilinos/[inquilinoId]/page.tsx — la ficha de UN profesional.
//
// Vivía colgada de Métricas, y ahí no es donde se la busca: cuando hay que ver o cobrarle a
// alguien, se entra por Profesionales y se toca su nombre. Métricas es para mirar el centro
// entero; esto es para mirar a una persona.
//
// Responde las tres preguntas que aparecen cuando alguien discute su resumen —cuántas horas usó,
// qué días y a qué hora, y cuánto factura— con las filas reales a la vista: un total sin el
// detalle que lo forma no se puede defender. Y desde acá se registran sus cobros.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { BarraNav } from "../../BarraNav.tsx";
import { MenuConfig } from "../../MenuConfig.tsx";
import { actorDeSesion } from "../../../../../src/lib/sesion.ts";
import { puede } from "../../../../../src/lib/permisos.ts";
import { detalleProfesional } from "../../../../../src/servicios/reportes/mensual.ts";
import { editarInquilino } from "../../../../../src/servicios/config/inquilinos.ts";
import { anularCobro, cobrosDelMes, ETIQUETA_MEDIO, MEDIOS, registrarCobro } from "../../../../../src/servicios/plata/cobros.ts";
import { formatearPesos } from "../../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, horasYMinutos, nombreDePeriodo, periodoAnterior, periodoSiguiente } from "../../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../../src/dominio/motor/zona.ts";
import { prisma } from "../../../../../src/db/prisma.ts";
import { Logo } from "../../../../Logo.tsx";
import { AnilloVolumen, BarrasVolumen } from "../../reportes/Graficos.tsx";

const DIA_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default async function DetalleProfesionalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; inquilinoId: string }>;
  searchParams: Promise<{ periodo?: string; ok?: string; error?: string }>;
}) {
  const { slug, inquilinoId } = await params;
  const { periodo: periodoParam, ok: okParam, error: errorParam } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "finanzas.ver.agregada")) redirect(`/panel/${slug}`);

  const sede = await prisma.sede.findFirst({
    where: { operadorId: actor.operadorId, activa: true },
    select: { zonaHoraria: true },
  });
  if (!sede) redirect(`/panel/${slug}`);
  const hoyPeriodo = fechaEnZona(new Date(), sede.zonaHoraria).slice(0, 7);
  const periodo = periodoParam && esPeriodoValido(periodoParam) ? periodoParam : hoyPeriodo;

  // Un id de otro centro no existe acá: se vuelve al reporte, sin confirmar que exista en otro lado.
  const d = await detalleProfesional({ actor, periodo, inquilinoId });
  if (!d) redirect(`/panel/${slug}/inquilinos`);

  const plata = (c: bigint) => formatearPesos(c, d.moneda);
  const conUso = d.porDiaSemana.filter((x) => x.minutos > 0);

  const puedeCobrar = puede(actor.rol, "cobro.registrar");
  const cobros = await cobrosDelMes({ operadorId: actor.operadorId, inquilinoId, periodo });
  const hoy = fechaEnZona(new Date(), sede.zonaHoraria);
  const volverA = `/panel/${slug}/inquilinos/${inquilinoId}?periodo=${periodo}`;
  // Sin la query: `revalidatePath` toma un path, y con "?periodo=..." no invalida nada — se
  // registra un cobro, la acción contesta "ok", y la lista sigue mostrando lo de antes.
  const rutaDetalle = `/panel/${slug}/inquilinos/${inquilinoId}`;

  async function registrarPago(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const r = await registrarCobro(a, {
      inquilinoId,
      monto: formData.get("monto"),
      medio: formData.get("medio"),
      referencia: formData.get("referencia") ?? undefined,
      fecha: formData.get("fecha") ?? undefined,
    });

    revalidatePath(rutaDetalle);
    // El duplicado se avisa distinto que el alta: para el operador "ya estaba cargado" y "listo"
    // son dos cosas muy diferentes, y confundirlas hace que busque un pago que nunca se asentó.
    const q = !r.ok ? `&error=${r.error}` : !r.data.ok ? `&error=${r.data.error}` : r.data.duplicado ? "&ok=repetido" : "&ok=1";
    redirect(`${volverA}${q}`);
  }

  async function anularPago(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const r = await anularCobro(a, { asientoId: formData.get("asientoId"), motivo: formData.get("motivo") });
    revalidatePath(rutaDetalle);
    const q = !r.ok ? `&error=${r.error}` : !r.data.ok ? `&error=${r.data.error}` : "&ok=anulado";
    redirect(`${volverA}${q}`);
  }

  // Editar los datos del profesional vive ACÁ y ya no en la lista: es donde uno está mirando a esa
  // persona. En la lista quedaron solo las dos acciones que se hacen sin abrir a nadie.
  async function guardarDatos(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await editarInquilino(a, {
      inquilinoId,
      nombre: formData.get("nombre"),
      pagador: formData.get("pagador"),
    });
    revalidatePath(rutaDetalle);
    redirect(`${volverA}${r.ok && r.data.ok ? "&ok=datos" : "&error=DATOS"}`);
  }

  const AVISO: Record<string, string> = {
    "1": "Cobro registrado.",
    datos: "Datos del profesional guardados.",
    repetido: "Ese comprobante ya estaba cargado: no se asentó de nuevo (sigue siendo un solo cobro).",
    anulado: "Cobro anulado. Queda asentado, con el motivo, y el saldo volvió a incluir esa deuda.",
  };
  const FALLA: Record<string, string> = {
    DATOS: "No se pudieron guardar los datos. Revisá que el nombre no esté vacío.",
    MES_CERRADO: "Ese mes ya está cerrado: el cobro no se puede anular sin reabrir la liquidación.",
    YA_ANULADO: "Ese cobro ya estaba anulado.",
    COBRO_INEXISTENTE: "No se encontró ese cobro.",
    INQUILINO_INEXISTENTE: "No se encontró ese profesional.",
    SIN_SEDE: "El centro no tiene una sede activa.",
  };

  return (
    <>
      <header className="barra">
        <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Volver a la agenda">
          <Logo alto={26} variante="compacto" />
        </Link>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.inquilino.nombre}
          {!d.inquilino.activo && <span className="tenue" style={{ fontWeight: 400 }}> · de baja</span>}
          {/* Quién abona, junto al nombre: es la pantalla desde la que se factura y se cobra. */}
          {d.inquilino.pagador && <span className="tenue" style={{ fontWeight: 400, fontSize: 14 }}> · abona {d.inquilino.pagador}</span>}
        </h1>
        <nav style={{ display: "flex", gap: 2 }}>
          <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">
            ‹
          </Link>
          {periodo < hoyPeriodo && (
            <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">
              ›
            </Link>
          )}
        </nav>
        <span className="pildora">{nombreDePeriodo(periodo)}</span>
        <Link href={`/panel/${slug}/inquilinos`} style={{ marginLeft: "auto", color: "var(--tenue)", fontWeight: 500, fontSize: 14 }}>
          ‹ Profesionales
        </Link>
        <BarraNav slug={slug} rol={actor.rol} actual="inquilinos" />
        <MenuConfig rol={actor.rol} />
      </header>

      <main style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
        {/* ── Los números del mes ────────────────────────────────────────── */}
        <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {[
            { t: "Horas usadas", v: horasYMinutos(d.totales.minutos), p: `${d.totales.reservas} turnos en ${d.totales.diasDistintos} días` },
            { t: "Facturado", v: plata(d.totales.facturadoCent), p: "cargado a su cuenta este mes" },
            { t: "Pagó", v: plata(d.totales.pagadoCent), p: "pagos registrados este mes" },
            {
              t: "Saldo",
              v: plata(d.totales.saldoCent),
              p: d.totales.saldoCent > 0n ? "debe, acumulado de todos los meses" : "sin deuda",
            },
          ].map((c) => (
            <div key={c.t} className="panel" style={{ padding: 18 }}>
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>{c.t}</p>
              <p style={{ fontSize: 25, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em" }}>{c.v}</p>
              <p className="tenue" style={{ margin: 0, fontSize: 12 }}>{c.p}</p>
            </div>
          ))}
        </section>

        {/* ── Cobros del mes ─────────────────────────────────────────────── */}
        <section id="cobros" style={{ marginTop: 26, scrollMarginTop: 76 }}>
          {/* El ancla la usa "Gestionar pagos" desde la lista: lleva directo acá en vez de
              dejar a media pantalla de scroll. scrollMarginTop por la barra fija. */}
          <h2 style={{ margin: "0 0 10px" }}>Cobros de {nombreDePeriodo(periodo)}</h2>

          {okParam && AVISO[okParam] && (
            <p className="panel" style={{ padding: "10px 14px", margin: "0 0 12px", fontSize: 14 }}>{AVISO[okParam]}</p>
          )}
          {errorParam && (
            <p className="panel" style={{ padding: "10px 14px", margin: "0 0 12px", fontSize: 14, color: "var(--error)" }}>
              {FALLA[errorParam] ?? "No se pudo completar la operación."}
            </p>
          )}

          {puedeCobrar && (
            <form action={registrarPago} className="panel" style={{ padding: 16, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="tenue">Importe</span>
                <input name="monto" type="number" min="1" step="1" required placeholder="50000" style={{ width: 130 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="tenue">Medio</span>
                <select name="medio" required defaultValue="transferencia">
                  {MEDIOS.map((m) => (
                    <option key={m} value={m}>{ETIQUETA_MEDIO[m]}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="tenue">Nº de operación</span>
                <input name="referencia" type="text" maxLength={80} placeholder="del comprobante" style={{ width: 170 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="tenue">Fecha del pago</span>
                <input name="fecha" type="date" defaultValue={hoy} max={hoy} />
              </label>
              <button type="submit">Registrar cobro</button>
              {/* El nº de operación es opcional pero es lo que evita cargar dos veces lo mismo al
                  conciliar el resumen, así que se dice acá y no en una ayuda escondida. */}
              <p className="tenue" style={{ margin: 0, fontSize: 12, flexBasis: "100%" }}>
                Con el nº de operación cargado, si el mismo comprobante se carga de nuevo no se
                duplica el cobro.
              </p>
            </form>
          )}

          {cobros.length === 0 ? (
            <p className="tenue" style={{ margin: 0 }}>
              No hay cobros registrados en {nombreDePeriodo(periodo)}.
            </p>
          ) : (
            <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Medio</th>
                    <th>Nº de operación</th>
                    <th className="num">Importe</th>
                    {puedeCobrar && <th />}
                  </tr>
                </thead>
                <tbody>
                  {cobros.map((c) => (
                    <tr key={c.id} style={c.anulado ? { textDecoration: "line-through", opacity: 0.55 } : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>{fechaEnZona(c.fecha, sede.zonaHoraria)}</td>
                      <td>{c.medio ? ETIQUETA_MEDIO[c.medio as (typeof MEDIOS)[number]] ?? c.medio : <span className="tenue">—</span>}</td>
                      <td>{c.referencia ?? <span className="tenue">sin comprobante</span>}</td>
                      <td className="num">{plata(c.montoCent)}</td>
                      {puedeCobrar && (
                        <td className="num">
                          {c.anulado ? (
                            <span className="tenue" style={{ fontSize: 12 }}>anulado</span>
                          ) : (
                            // Un cobro no se edita: se anula y se carga de nuevo. El motivo es
                            // obligatorio porque es lo único que explica, meses después, por qué
                            // en el libro hay un pago y su contraasiento.
                            <form action={anularPago} style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <input type="hidden" name="asientoId" value={c.id} />
                              <input name="motivo" type="text" required minLength={3} maxLength={200} placeholder="motivo" style={{ width: 150 }} />
                              <button type="submit" className="tenue" style={{ fontSize: 12 }}>Anular</button>
                            </form>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {d.totales.reservas === 0 ? (
          <p className="tenue" style={{ marginTop: 24 }}>
            No usó ningún consultorio en {nombreDePeriodo(periodo)}. El saldo de arriba sigue siendo
            el acumulado: una deuda vieja no desaparece porque este mes no haya venido.
          </p>
        ) : (
          <>
            {/* ── Qué días viene ─────────────────────────────────────────── */}
            <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginTop: 26 }}>
              <div className="panel">
                <h2 style={{ marginTop: 0, fontSize: 15 }}>Qué días usa el consultorio</h2>
                <BarrasVolumen datos={conUso.map((x) => ({ etiqueta: DIA_LARGO[x.dia]!, valor: x.minutos, texto: horasYMinutos(x.minutos) }))} alto={190} />
              </div>

              <div className="panel">
                <h2 style={{ marginTop: 0, fontSize: 15 }}>En qué franja del día</h2>
                <AnilloVolumen
                  datos={d.porFranja.filter((f) => f.minutos > 0).map((f) => ({ etiqueta: f.franja, valor: f.minutos, texto: horasYMinutos(f.minutos) }))}
                  alto={190}
                />
              </div>
            </section>

            {/* ── Turno por turno ────────────────────────────────────────── */}
            <h2 style={{ marginTop: 26 }}>Turno por turno</h2>
            <div className="panel" style={{ padding: 0, marginTop: 10, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Horario</th>
                    <th>Consultorio</th>
                    <th className="num">Duración</th>
                    <th className="num">Importe</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {d.turnos.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {DIA_LARGO[t.diaSemana]} {Number(t.fecha.slice(8, 10))}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{t.horaTexto}</td>
                      <td>{t.salaNombre}</td>
                      <td className="num">{horasYMinutos(t.minutos)}</td>
                      {/* null ≠ $0: "se creó sin precio cargado" no es "salió gratis". */}
                      <td className="num">{t.importeCent === null ? <span className="tenue">sin precio</span> : plata(t.importeCent)}</td>
                      <td>
                        {t.estado === "no_show" ? (
                          <span className="pildora" style={{ background: "#fdeceb", color: "var(--error)" }}>no vino</span>
                        ) : (
                          <span className="tenue">{t.estado}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      {d.totales.reservas} turnos en {d.totales.diasDistintos} días
                    </td>
                    <td className="num">{horasYMinutos(d.totales.minutos)}</td>
                    <td className="num">{plata(d.totales.importeCent)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* El detalle son los turnos; lo facturado es el libro. Si difieren, hay que decirlo. */}
            {d.totales.importeCent !== d.totales.facturadoCent && (
              <p className="tenue" style={{ marginTop: 10, fontSize: 12 }}>
                Los turnos suman {plata(d.totales.importeCent)} y su cuenta registra{" "}
                {plata(d.totales.facturadoCent)} facturados este mes. La diferencia son movimientos
                que no son horas de consultorio (ajustes, penalidades o notas de crédito).
              </p>
            )}
          </>
        )}
        {/* ── Datos del profesional ──────────────────────────────────────── */}
        {puede(actor.rol, "inquilino.administrar") && (
          <section style={{ marginTop: 26 }}>
            <h2>Datos</h2>
            <form action={guardarDatos} className="panel">
              <label htmlFor="nombre">Nombre y especialidad</label>
              <input id="nombre" name="nombre" required maxLength={120} defaultValue={d.inquilino.nombre} />

              <label htmlFor="pagador">Quién abona (si no es el mismo profesional)</label>
              <input id="pagador" name="pagador" maxLength={120} defaultValue={d.inquilino.pagador ?? ""} placeholder="Federico Terrón" />
              <p className="tenue" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Solo para facturar y cobrar. La deuda sigue siendo de quien usó el consultorio:
                pasarla a otra cuenta descuadraría las dos.
              </p>

              <p style={{ marginTop: 14, marginBottom: 0 }}>
                <button type="submit">Guardar</button>
              </p>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
