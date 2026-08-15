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
import { formatearPesos } from "../../../src/dominio/tarifa.ts";
import { DIA_CORTO, nombreCorto } from "../../../src/dominio/calendario.ts";
import { diaSemanaDeFecha } from "../../../src/dominio/motor/zona.ts";

const ALTO_CELDA = 30; // px por paso (30')

type Mover = (input: { ocupacionId: string; salaDestinoId: string; fecha: string; hora: string }) => Promise<{ ok: boolean; mensaje: string }>;

type Arrastre = { id: string; salaId: string | null; filasDeAgarre: number };

// `baseTurno` es un STRING y no una función que arme el link: una función no se puede pasar de
// un componente de servidor a uno de cliente (solo las server actions cruzan esa frontera).
export function Grilla({ dia, hoy, mover, baseTurno }: { dia: AgendaVista; hoy: string; mover?: Mover; baseTurno?: string }) {
  const router = useRouter();
  // El arrastre vive en una REF y no solo en estado. El drop tiene que poder leer qué se está
  // moviendo aunque React todavía no haya re-renderizado desde el dragstart: si dependiera del
  // estado, un arrastre rápido (o un navegador que manda pocos dragover) soltaría el turno con
  // el dato en null y no pasaría nada, sin error visible. El estado queda solo para lo visual.
  const arrastreRef = useRef<Arrastre | null>(null);
  const arrastroRecien = useRef(false);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [destino, setDestino] = useState<{ columnaId: string; fila: number } | null>(null);
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

  /** La fila (franja de 30') sobre la que está el cursor dentro de una columna. */
  function filaDelCursor(e: React.DragEvent, filasDeAgarre: number): number {
    const caja = e.currentTarget.getBoundingClientRect();
    const cruda = Math.floor((e.clientY - caja.top) / ALTO_CELDA) - filasDeAgarre;
    return Math.max(0, Math.min(dia.filas - 1, cruda));
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
          <div style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--panel)", borderBottom: "1px solid var(--borde)" }} />
          {columnas.map((c) => (
            <div
              key={c.id}
              style={{
                position: "sticky",
                top: 0,
                zIndex: 3,
                background: "var(--panel)",
                borderBottom: "1px solid var(--borde)",
                borderLeft: "1px solid var(--borde)",
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
            style={{
              position: "sticky",
              left: 0,
              zIndex: 2,
              background: "var(--panel)",
              display: "grid",
              gridTemplateRows: `repeat(${dia.filas}, ${ALTO_CELDA}px)`,
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
                style={{
                  display: "grid",
                  gridTemplateRows: `repeat(${dia.filas}, ${ALTO_CELDA}px)`,
                  gridTemplateColumns: `repeat(${carriles}, 1fr)`,
                  borderLeft: "1px solid var(--borde)",
                  background: `repeating-linear-gradient(to bottom, transparent 0 ${ALTO_CELDA - 1}px, var(--borde) ${ALTO_CELDA - 1}px ${ALTO_CELDA}px)`,
                }}
              >
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
                  // El importe ya viene PROYECTADO: si el que mira no puede ver plata, llega null.
                  // Acá no se decide nada de privacidad, solo se muestra lo que el servidor mandó.
                  const conPlata = "importeCent" in r ? r.importeCent : null;
                  const importe = conPlata ? formatearPesos(BigInt(conPlata), dia.moneda) : null;
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
                      className="evento"
                      draggable={movible}
                      onDragStart={
                        movible
                          ? (e) => {
                              const caja = e.currentTarget.getBoundingClientRect();
                              const a = { id: u.id, salaId: r.salaId, filasDeAgarre: Math.floor((e.clientY - caja.top) / ALTO_CELDA) };
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
                      title={[r.titulo, r.horaTexto, dia.vista === "semana" ? r.salaNombre : null, importe, movible ? "Arrastrá para moverlo" : null]
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
                        cursor: movible ? "grab" : undefined,
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
                      {u.span > 2 && importe && <div style={{ opacity: 0.9, fontSize: 11 }}>{importe}</div>}
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
