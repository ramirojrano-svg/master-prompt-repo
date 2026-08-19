// app/panel/[slug]/MenuConfig.tsx — la tuerca de la barra superior: quién sos y cómo salir.
//
// Hasta acá no había forma de cerrar sesión desde la app. Para volver al login había que borrar
// la cookie a mano o esperar a que venciera — y en una máquina compartida (la recepción del
// centro es exactamente eso) la sesión del dueño quedaba abierta para el que se sentara después.
//
// Va con <details>, igual que el botón flotante de crear: se abre y se cierra sin una línea de
// JavaScript de cliente, así esta pantalla sigue funcionando aunque la hidratación falle. El
// cierre de sesión es un <form> que postea a una acción de servidor, no un enlace: salir CAMBIA
// estado, y un GET que cambia estado lo dispara cualquier precargador del navegador.

import Link from "next/link";
import { auth } from "../../../src/lib/auth.ts";
import { ETIQUETA_ROL, puede, type Rol } from "../../../src/lib/permisos.ts";
import { IconoSalir, IconoTuerca } from "../../Iconos.tsx";
import { cerrarSesion } from "./salir.ts";

/**
 * El email lo resuelve el propio menú leyendo la sesión, en vez de recibirlo por prop. La barra
 * se arma en cuatro lugares distintos (agenda, Cabecera, y las dos de Métricas) y ninguno tiene
 * hoy el email a mano: el Actor trae rol e ids, no datos del usuario. Pasarlo por prop obligaba a
 * consultarlo en las cuatro pantallas y a acordarse de hacerlo en la quinta.
 */
export async function MenuConfig({ rol, slug }: { rol: Rol; slug: string }) {
  const sesion = await auth();
  const email = sesion?.user?.email ?? "";
  // El estado del correo es cosa de la instalación, no del día a día: vive acá adentro y no en el
  // menú lateral, que es para las pantallas que se usan todos los días.
  const administra = puede(rol, "usuarios.administrar");

  return (
    <details className="menu-config" data-burbuja>
      {/* Con la misma forma que los accesos de arriba: es una fila más de la columna, y un círculo
          suelto entre filas a lo ancho se leía como si fuera de otra pantalla. Colapsado el texto
          se apaga solo, igual que en los demás. */}
      <summary className="item-lateral" aria-label="Configuración" title="Configuración">
        <IconoTuerca />
        <span>Configuración</span>
      </summary>
      <div className="globo-config">
        {/* Quién está adentro, arriba de todo: en una recepción compartida es lo primero que hay
            que poder verificar antes de tocar nada. */}
        <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 14, wordBreak: "break-all" }}>{email}</p>
        <p className="tenue" style={{ margin: "0 0 12px", fontSize: 12 }}>{ETIQUETA_ROL[rol]}</p>

        {administra && (
          <p style={{ margin: "0 0 10px", fontSize: 13 }}>
            <Link href={`/panel/${slug}/correo`}>Envío de correo</Link>
          </p>
        )}

        <form action={cerrarSesion}>
          <button type="submit" className="btn-suave" style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <IconoSalir />
            Cerrar sesión
          </button>
        </form>
      </div>
    </details>
  );
}
