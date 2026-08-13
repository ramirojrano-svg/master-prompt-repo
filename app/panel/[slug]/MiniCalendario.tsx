// app/panel/[slug]/MiniCalendario.tsx — el calendarito del lateral.
// Es HTML puro: cada día es un link con la fecha en la URL. Sin estado de cliente, así funciona
// con el botón "atrás" del navegador y se puede compartir un link a un día concreto (§6.1).

import Link from "next/link";
import { DIA_CORTO, matrizMensual, navegar, tituloDeVista, type Vista } from "../../../src/dominio/calendario.ts";

export function MiniCalendario({
  mes,
  elegida,
  hoy,
  vista,
  href,
}: {
  mes: string; // cualquier fecha del mes a dibujar
  elegida: string; // el día seleccionado en la agenda
  hoy: string; // HOY en la zona de la SEDE (nunca el del navegador)
  vista: Vista;
  href: (fecha: string, extra?: Record<string, string>) => string;
}) {
  const semanas = matrizMensual(mes);
  const titulo = tituloDeVista("mes", mes);

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{titulo}</strong>
        <span style={{ display: "flex", gap: 2 }}>
          <Link className="nav-circ" style={{ width: 26, height: 26, fontSize: 14 }} href={href(elegida, { mes: navegar("mes", mes, -1) })} aria-label="Mes anterior">
            ‹
          </Link>
          <Link className="nav-circ" style={{ width: 26, height: 26, fontSize: 14 }} href={href(elegida, { mes: navegar("mes", mes, 1) })} aria-label="Mes siguiente">
            ›
          </Link>
        </span>
      </div>

      <table className="mini">
        <thead>
          <tr>
            {DIA_CORTO.map((d) => (
              <th key={d} scope="col">
                {d[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((semana) => (
            <tr key={semana[0]!.fecha}>
              {semana.map((c) => {
                const clases = [
                  c.delMes ? "" : "fuera",
                  c.fecha === hoy ? "hoy" : "",
                  c.fecha === elegida && c.fecha !== hoy ? "elegida" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td key={c.fecha}>
                    <Link className={clases} href={href(c.fecha, { vista })} aria-current={c.fecha === elegida ? "date" : undefined}>
                      {Number(c.fecha.slice(8, 10))}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
