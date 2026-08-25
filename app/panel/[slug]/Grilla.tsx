"use client";
// app/panel/[slug]/Grilla.tsx — la grilla de tiempo: vista DÍA (columnas = salas) y vista SEMANA
// (columnas = días). El componente NO calcula posiciones: todo viene ubicado desde `ubicarBloques`
// (función pura y testeada). CSS Grid con filas por paso; nada de `position:absolute` con top en
// píxeles, que se desincroniza al hacer zoom.
//
// Es cliente por UNA razón: arrastrar turnos. El resto sigue siendo el mismo marcado que antes.
//
// Cómo funciona el arrastre, y por qué así:
//  · La fila destino se calcula con la Y del cursor contra el alto de celda, en vez de sembrar
//    la grilla con `filas × columnas` divs invisibles como zona de drop. Menos nodos y, sobre
//    todo, una sola fuente para "en qué franja caí".
//  · Mientras se arrastra, TODOS los bloques quedan con pointer-events en none. Si no, soltar
//    encima de otro bloque (o del propio, al correrlo media hora) no llega nunca a la columna y
//    el drop se pierde sin explicación.
//  · Se respeta dónde agarraste el bloque: si lo tomás por la mitad de un turno de dos horas,
//    el turno arranca donde estaba el cursor MENOS esa mitad. Sin esto, agarrar por abajo
//    empuja el turno hacia adelante y nunca cae donde uno lo suelta.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgendaVista } from "../../../src/servicios/agenda/dia.ts";
import { minutosAHora } from "../../../src/dominio/motor/zona.ts";
import { DIA_CORTO, nombreCorto } from "../../../src/dominio/calendario.ts";
import { diaSemanaDeFecha } from "../../../src/dominio/motor/zona.ts";

const ALTO_CELDA = 30; // px por paso (30'): el alto CÓMODO, y el techo
/** Lo más flaca que puede quedar una franja antes de volverse impracticable con el mouse. */
const ALTO_MIN = 16;
/**
 * Lo que ocupa, dentro del alto útil, todo lo que NO son franjas: el aire de abajo más la cabecera
 * pegajosa de columnas. Medidos en pantalla, no estimados: la cabecera de la semana lleva el día
 * Y el consultorio en dos renglones, así que mide 70px contra los 39 de la vista día. Con un solo
 * número para las dos, la semana se pasaba de largo por treinta píxeles — que es exactamente la
 * franja que quedaba escondida.
 */
const AIRE_PX = 58;
const CABECERA_PX = { dia: 40, semana: 76, mes: 40 } as const;

type Mover = (input: { ocupacionId: string; salaDestinoId: string; fecha: string; hora: string }) => Promise<{ ok: boolean; mensaje: string }>;

type Arrastre = { id: string; salaId: string | null; filasDeAgarre: number };

// `baseTurno` y `baseNuevo` son STRINGS y no funciones que armen el link: una función no se puede
// pasar de un componente de servidor a uno de cliente (solo las server actions cruzan esa frontera).
export function Grilla({
  dia,
  hoy,
  mover,
  baseTurno,
  baseNuevo,
}: {
  dia: AgendaVista;
  hoy: string;
  mover?: Mover;
  baseTurno?: string;
  /**
   * URL de la agenda sobre la que se arma el "crear acá". Ausente = quien mira no puede crear, y
   * entonces la grilla no ofrece el gesto en vez de ofrecerlo y que el servidor lo rechace.
   */
  baseNuevo?: string;
}) {
  const router = useRouter();
  // El arrastre vive en una REF y no solo en estado. El drop tiene que poder leer qué se está
  // moviendo aunque React todavía no haya re-renderizado desde el dragstart: si dependiera del
  // estado, un arrastre rápido (o un navegador que manda pocos dragover) soltaría el turno con
  // el dato en null y no pasaría nada, sin error visible. El estado queda solo para lo visual.
  const arrastreRef = useRef<Arrastre | null>(null);
  const arrastroRecien = useRef(false);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [destino, setDestino] = useState<{ columnaId: string; fila: number } | null>(null);
  // La franja bajo el cursor, para pintarla antes de que la toquen. Sin esto no hay forma de saber
  // que la grilla es clickeable ni en qué horario se va a crear el turno: media hora son 30px y a
  // ojo no se distingue si el cursor está en las 15:00 o en las 15:30.
  const [posado, setPosado] = useState<{ columnaId: string; fila: number } | null>(null);
  const [aviso, setAviso] = useState("");
  const [pendiente, empezar] = useTransition();

  if (dia.salas.length === 0) {
    // Estado vacío con la acción que lo resuelve (§6.16): la grilla no se renderiza vacía.
    return (
      <div className="panel" style={{ margin: 16 }}>
        <h3 style={{ marginTop: 0 }}>Todavía no cargaste ninguna sala</h3>
        <p className="tenue">Sin salas no hay agenda. Cargá tu primer consultorio para ver la grilla.</p>
      </div>
    );
  }

  // Las columnas: salas en vista día, días en vista semana.
  const columnas =
    dia.vista === "semana"
      ? dia.dias.map((f) => ({ id: f, titulo: `${DIA_CORTO[diaSemanaDeFecha(f) ?? 0]}`, sub: String(Number(f.slice(8, 10))), esHoy: f === hoy, color: null as string | null }))
      : dia.salas
          .filter((s) => dia.salasVisibles.includes(s.id))
          .map((s) => ({ id: s.id, titulo: s.nombre, sub: s.activa ? "" : "archivada", esHoy: false, color: s.color }));

  const horas: number[] = [];
  for (let m = dia.aperturaMin; m < dia.cierreMin; m += 60) horas.push(m);
  const porId = new Map(dia.reservas.map((r) => [r.id, r]));
  const anchoEje = 56;

  /**
   * El alto de cada franja de 30'.
   *
   * Era fijo en 30px, y con eso un día de 07:00 a 23:00 mide 960px: en una pantalla de escritorio
   * común quedaban ~170px abajo que solo se veían scrolleando, y encima sobraba blanco entre el
   * final de la grilla y el borde. Un calendario que no se ve entero obliga a mover el mouse para
   * saber si a las 21:00 hay algo, que es justo lo que uno quiere responder de un vistazo.
   *
   * Se resuelve en CSS y no en JS porque depende del alto de la ventana, que el servidor no conoce
   * —calcularlo en el cliente haría que la grilla salte al cargar—. `clamp` la achica lo necesario
   * para que entre, pero nunca por debajo de lo que se puede apuntar con el mouse: en una ventana
   * muy baja vuelve a haber scroll, que es preferible a franjas de 6px.
   */
  const reservaPx = AIRE_PX + (CABECERA_PX[dia.vista as keyof typeof CABECERA_PX] ?? CABECERA_PX.dia);
  const altoFila = `clamp(${ALTO_MIN}px, calc((100dvh - var(--barra) - ${reservaPx}px) / ${dia.filas}), ${ALTO_CELDA}px)`;

  /** El alto REAL que terminó teniendo una franja, medido del DOM. Las cuentas del arrastre tienen
   *  que usar esto y no la constante: desde que el alto es elástico, la constante es solo el techo. */
  const ejeRef = useRef<HTMLDivElement>(null);
  const altoCelda = () => {
    const alto = ejeRef.current?.getBoundingClientRect().height;
    return alto && dia.filas > 0 ? alto / dia.filas : ALTO_CELDA;
  };

  /** La fila (franja de 30') sobre la que está el cursor dentro de una columna. */
  function filaDelCursor(e: React.DragEvent | React.MouseEvent, filasDeAgarre: number): number {
    const caja = e.currentTarget.getBoundingClientRect();
    const cruda = Math.floor((e.clientY - caja.top) / (caja.height / dia.filas)) - filasDeAgarre;
    return Math.max(0, Math.min(dia.filas - 1, cruda));
  }

  /**
   * Crear un turno tocando la celda. Antes había que abrir el "+" y volver a escribir el
   * consultorio, el día y la hora que uno ya estaba señalando con el dedo en la pantalla.
   *
   * Navega en vez de abrir un panel con estado propio: en esta app la pantalla ES la URL, así que
   * el formulario abierto en tal sala y tal hora se puede compartir, sobrevive a un refresh y el
   * botón "atrás" lo cierra.
   */
  function crearAca(e: React.MouseEvent, columnaId: string) {
    if (!baseNuevo) return;
    // Un click sobre un turno es "abrir ese turno", no "crear al lado": el link del bloque ya se
    // encarga. Y después de arrastrar, el navegador manda un click que no pidió nadie.
    if ((e.target as HTMLElement).closest(".evento")) return;
    if (arrastreRef.current || arrastroRecien.current) return;

    const fila = filaDelCursor(e, 0);
    const url = new URL(baseNuevo, window.location.origin);
    url.searchParams.set("nuevo", "1");
    url.searchParams.set("hora", minutosAHora(dia.aperturaMin + fila * dia.pasoMin));
    // En vista día la columna ES la sala y el día es el que se está mirando. En vista semana es al
    // revés: la columna es el día y la sala la elige el formulario, porque la grilla semanal no
    // muestra consultorios y adivinar cuál sería inventar.
    if (dia.vista === "semana") url.searchParams.set("fecha", columnaId);
    else url.searchParams.set("sala", columnaId);

    router.push(`${url.pathname}${url.search}`);
  }

  function soltar(e: React.DragEvent, columnaId: string) {
    e.preventDefault();
    const a = arrastreRef.current;
    arrastreRef.current = null;
    arrastroRecien.current = true;
    setTimeout(() => (arrastroRecien.current = false), 0);
    setArrastre(null);
    setDestino(null);
    if (!a || !mover) return;

    const fila = filaDelCursor(e, a.filasDeAgarre);
    const hora = minutosAHora(dia.aperturaMin + fila * dia.pasoMin);
    // En vista día la columna ES la sala y el día no cambia. En vista semana la columna es el
    // día y la sala es la que el turno ya tenía: la grilla semanal no muestra salas.
    const salaDestinoId = dia.vista === "semana" ? a.salaId : columnaId;
    const fecha = dia.vista === "semana" ? columnaId : dia.fecha;
    if (!salaDestinoId) return;

    setAviso("");
    empezar(async () => {
      const r = await mover({ ocupacionId: a.id, salaDestinoId, fecha, hora });
      if (!r.ok) setAviso(r.mensaje);
      // Refresca siempre, también al fallar: la grilla vuelve a la verdad del servidor en vez de
      // quedar mostrando el bloque donde el navegador lo dejó.
      router.refresh();
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - var(--barra) - 58px)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${anchoEje}px repeat(${columnas.length}, minmax(120px, 1fr))`,
            minWidth: anchoEje + columnas.length * 120,
          }}
        >
          {/* ── Cabecera (sticky) ──────────────────────────────────────────── */}
          {/* La esquina vacía, arriba del eje horario. Lleva el mismo borde grueso que el resto
              de la cabecera para que la línea sea una sola y no se corte al llegar a la izquierda. */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 3,
              background: "var(--panel)",
              borderTop: "2px solid var(--borde-fuerte)",
              borderBottom: "2px solid var(--borde-fuerte)",
            }}
          />
          {columnas.map((c) => (
            <div
              key={c.id}
              style={{
                position: "sticky",
                top: 0,
                zIndex: 3,
                background: "var(--panel)",
                // Arriba y abajo con el MISMO gris y el mismo grosor que la línea que separa un
                // consultorio del otro: con el borde fino la cabecera se leía como una tira aparte
                // pegada encima de la grilla, en vez de como la primera fila de la misma tabla.
                borderTop: "2px solid var(--borde-fuerte)",
                borderBottom: "2px solid var(--borde-fuerte)",
                // 2px y con el borde fuerte: en la vista de día cada columna es UN consultorio, y
                // con la línea fina la grilla se leía como una tabla sola en vez de tres espacios.
                borderLeft: "2px solid var(--borde-fuerte)",
                padding: "8px 10px 6px",
                textAlign: dia.vista === "semana" ? "center" : "left",
              }}
            >
              {dia.vista === "semana" ? (
                <>
                  <div className="tenue" style={{ fontSize: 11, letterSpacing: "0.04em" }}>{c.titulo}</div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      fontSize: 19,
                      fontWeight: 500,
                      marginTop: 2,
                      background: c.esHoy ? "var(--marca-500)" : "transparent",
                      color: c.esHoy ? "#fff" : "var(--texto)",
                    }}
                  >
                    {c.sub}
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color ?? "var(--marca-500)" }} />
                  {c.titulo} {c.sub && <span className="tenue" style={{ fontWeight: 400 }}>({c.sub})</span>}
                </div>
              )}
            </div>
          ))}

          {/* ── Eje horario (sticky a la izquierda) ────────────────────────── */}
          <div
            ref={ejeRef}
            style={{
              position: "sticky",
              left: 0,
              zIndex: 2,
              background: "var(--panel)",
              display: "grid",
              gridTemplateRows: `repeat(${dia.filas}, ${altoFila})`,
            }}
          >
            {Array.from({ length: dia.filas }, (_, i) => {
              const min = dia.aperturaMin + i * dia.pasoMin;
              return (
                <div key={min} style={{ position: "relative" }}>
                  {min % 60 === 0 && (
                    <span
                      className="tenue"
                      style={{
                        position: "absolute",
                        right: 8,
                        // la primera etiqueta NO se sube: se cortaría contra el borde de la grilla
                        top: i === 0 ? 0 : -7,
                        fontSize: 11,
                        background: "var(--panel)",
                        paddingLeft: 4,
                      }}
                    >
                      {minutosAHora(min)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Una columna de bloques por sala (o por día) ─────────────────── */}
          {columnas.map((col) => {
            const bloques = dia.ubicaciones.filter((u) => u.columnaId === col.id);
            const carriles = bloques[0]?.carriles ?? 1;
            return (
              <div
                key={col.id}
                // La columna es la zona donde se suelta; el atributo la hace ubicable desde la
                // prueba de humo, que arrastra un turno de verdad con un browser.
                data-columna={col.id}
                // El handler se engancha con `mover` a secas y NO con `mover && arrastre`: entre
                // el dragstart y el primer dragover puede no haber corrido todavía el re-render
                // que setea `arrastre`, y sin preventDefault en ESE dragover el navegador ya
                // decidió que acá no se puede soltar y no manda el drop nunca.
                onDragOver={
                  mover
                    ? (e) => {
                        e.preventDefault();
                        const a = arrastreRef.current;
                        if (a) setDestino({ columnaId: col.id, fila: filaDelCursor(e, a.filasDeAgarre) });
                      }
                    : undefined
                }
                onDrop={mover ? (e) => soltar(e, col.id) : undefined}
                onClick={baseNuevo ? (e) => crearAca(e, col.id) : undefined}
                onMouseMove={
                  baseNuevo
                    ? (e) => {
                        const fila = filaDelCursor(e, 0);
                        // Solo cuando CAMBIA de franja: si no, cada píxel de movimiento del mouse
                        // sería un re-render de la grilla entera.
                        setPosado((p) => (p?.columnaId === col.id && p.fila === fila ? p : { columnaId: col.id, fila }));
                      }
                    : undefined
                }
                onMouseLeave={baseNuevo ? () => setPosado(null) : undefined}
                style={{
                  cursor: baseNuevo ? "pointer" : undefined,
                  display: "grid",
                  gridTemplateRows: `repeat(${dia.filas}, ${altoFila})`,
                  gridTemplateColumns: `repeat(${carriles}, 1fr)`,
                  // 2px y con el borde fuerte: en la vista de día cada columna es UN consultorio, y
                // con la línea fina la grilla se leía como una tabla sola en vez de tres espacios.
                borderLeft: "2px solid var(--borde-fuerte)",
                  background: `repeating-linear-gradient(to bottom, transparent 0 calc(${altoFila} - 1px), var(--borde) calc(${altoFila} - 1px) ${altoFila})`,
                }}
              >
                {/* La franja bajo el cursor, con la hora escrita. Se apaga mientras se arrastra:
                    ahí manda la guía del arrastre y dos marcas a la vez confunden. */}
                {baseNuevo && !arrastre && posado?.columnaId === col.id && (
                  <div
                    aria-hidden
                    style={{
                      gridRow: `${posado.fila + 1} / span 1`,
                      gridColumn: `1 / span ${carriles}`,
                      margin: "1px 2px",
                      borderRadius: 6,
                      background: "var(--agua-clara)",
                      border: "1px solid var(--agua)",
                      pointerEvents: "none",
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 6,
                      fontSize: 11,
                      color: "var(--marca-900)",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    + {minutosAHora(dia.aperturaMin + posado.fila * dia.pasoMin)}
                  </div>
                )}

                {/* Guía de dónde va a caer el turno. Se dibuja del alto REAL que ocupa, así se
                    ve si entra antes del cierre o si pisa el turno de al lado. */}
                {destino?.columnaId === col.id && arrastre && (
                  <div
                    aria-hidden
                    style={{
                      gridRow: `${destino.fila + 1} / span ${dia.ubicaciones.find((u) => u.id === arrastre.id)?.span ?? 1}`,
                      gridColumn: `1 / span ${carriles}`,
                      margin: "1px 2px",
                      borderRadius: 6,
                      border: "2px dashed var(--marca-500)",
                      background: "rgba(26,143,193,0.12)",
                      pointerEvents: "none",
                    }}
                  />
                )}

                {bloques.map((u) => {
                  const r = porId.get(u.id);
                  if (!r) return null;
                  // El bloque NO muestra plata, ni en el cuerpo ni en el tooltip. El calendario es
                  // lo que queda abierto en la pantalla de recepción, a la vista de quien pase; el
                  // importe se mira a propósito, tocando el turno (ahí está, con el valor hora) o
                  // desde Negocio. El servidor lo sigue proyectando según quién mira — esto es
                  // sobre dónde se muestra, no sobre quién puede verlo.
                  // Un bloqueo no se arrastra: no es el turno de nadie (lo rechaza el servidor
                  // igual, pero ofrecer el gesto y después negarlo es peor que no ofrecerlo).
                  const movible = Boolean(mover) && !r.esBloqueo;
                  const seEstaMoviendo = arrastre?.id === u.id;
                  // Link real y no un onClick: el detalle vive en la URL, así que abrirlo tiene
                  // que funcionar con el botón del medio, con "copiar dirección" y sin JS.
                  // Solo los que TIENEN detalle son links. Un profesional ve los turnos ajenos
                  // como "Ocupado": ofrecerle un link que abre una pantalla vacía es prometer algo
                  // que no existe.
                  const destino = baseTurno && r.abrible ? `${baseTurno}${baseTurno.includes("?") ? "&" : "?"}turno=${u.id}` : undefined;
                  const Bloque = (destino ? "a" : "div") as "a" | "div";
                  return (
                    <Bloque
                      key={u.id}
                      href={destino}
                      className={movible ? "evento agarrable" : "evento"}
                      draggable={movible}
                      onDragStart={
                        movible
                          ? (e) => {
                              const caja = e.currentTarget.getBoundingClientRect();
                              const a = { id: u.id, salaId: r.salaId, filasDeAgarre: Math.floor((e.clientY - caja.top) / altoCelda()) };
                              arrastreRef.current = a; // disponible YA, sin esperar el re-render
                              setArrastre(a);
                              e.dataTransfer.effectAllowed = "move";
                              // Firefox no arranca el arrastre si no se setea algo acá.
                              e.dataTransfer.setData("text/plain", u.id);
                            }
                          : undefined
                      }
                      onDragEnd={() => {
                        arrastreRef.current = null;
                        setArrastre(null);
                        setDestino(null);
                      }}
                      // Arrastrar un <a> termina en un click que abriría el detalle del turno que
                      // se acaba de mover. Se traga ese click y solo ese.
                      onClick={(e) => {
                        if (arrastreRef.current || arrastroRecien.current) e.preventDefault();
                      }}
                      title={[r.titulo, r.horaTexto, dia.vista === "semana" ? r.salaNombre : null, movible ? "Arrastrá para moverlo" : null]
                        .filter(Boolean)
                        .join(" · ")}
                      aria-label={`${r.salaNombre}, ${r.titulo}, ${r.horaTexto}`}
                      style={{
                        gridRow: `${u.fila} / span ${u.span}`,
                        // col/colSpan vienen calculados: un bloque solo ocupa TODO el ancho de la
                        // columna; los solapados se reparten (§6.4).
                        gridColumn: `${u.col} / span ${u.colSpan}`,
                        // altura mínima táctil (44px, WCAG 2.5.5) aunque el bloque sea de 15'
                        minHeight: 44,
                        margin: "1px 2px",
                        background: r.esBloqueo ? "var(--tenue)" : r.color,
                        backgroundImage: r.esBloqueo
                          ? "repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px)"
                          : undefined,
                        borderTop: u.recortadoArriba ? "2px dotted #fff" : undefined,
                        // bloque corto dibujado más alto que su duración: borde punteado (§6.5)
                        borderBottom: u.recortadoAbajo || u.estirado ? "2px dotted #fff" : undefined,
                        // La manito la pone `.agarrable` en el CSS: en SVG, para que no se vea dentada.
                        opacity: seEstaMoviendo ? 0.4 : undefined,
                        // Con un arrastre en curso los bloques dejan de interceptar: el drop tiene
                        // que llegar a la columna, incluso soltando sobre otro turno.
                        pointerEvents: arrastre ? "none" : undefined,
                      }}
                    >
                      {/* Si el bloque comparte la columna con otro, el nombre entero no entra:
                          se muestra corto y el completo queda en el tooltip y en el aria-label. */}
                      <b>{u.colSpan < u.carriles ? nombreCorto(r.titulo) : r.titulo}</b>
                      {u.span > 1 && <div style={{ opacity: 0.9, fontSize: 11 }}>{r.horaTexto}</div>}
                      {u.span > 2 && dia.vista === "semana" && <div style={{ opacity: 0.9, fontSize: 11 }}>{r.salaNombre}</div>}
                    </Bloque>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Aviso del movimiento rechazado. Va por role="status" y no por un alert(): el turno no se
          movió, la grilla ya volvió a mostrarlo donde estaba, y frenar al operador con un modal
          para decirle algo que ya ve en pantalla es de más. */}
      {(aviso || pendiente) && (
        <p
          role="status"
          style={{
            position: "absolute",
            left: "50%",
            bottom: 18,
            transform: "translateX(-50%)",
            margin: 0,
            padding: "10px 16px",
            borderRadius: 999,
            background: aviso ? "var(--error)" : "var(--marca-900)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "var(--sombra-alta)",
            zIndex: 20,
            maxWidth: "min(520px, calc(100% - 32px))",
          }}
        >
          {aviso || "Moviendo…"}
        </p>
      )}
    </div>
  );
}
