"use client";

// app/panel/[slug]/cierre/AvisarWhatsApp.tsx — abrir el chat y dejar constancia, de un toque.
//
// Dos cosas en el mismo gesto, y por eso es un componente de cliente: abrir WhatsApp con el
// mensaje ya escrito, y avisarle al servidor que a esa persona ya se le mandó.
//
// `window.open` va en el onClick y no después de la acción: los navegadores solo permiten abrir
// una ventana dentro del gesto del usuario, así que esperar la respuesta del servidor la haría
// caer en el bloqueador de pop-ups. El formulario se envía igual, en paralelo, y la fila se
// repinta cuando vuelve.
//
// No se navega: la lista se queda donde está. Con veintinueve profesionales, perder el lugar en
// cada uno es el mismo problema que ya resolvimos con el ancla del botón "Cerrar".

import { useState } from "react";

export function AvisarWhatsApp({
  href,
  accion,
  liquidacionId,
  nombre,
  avisada,
}: {
  href: string;
  accion: (formData: FormData) => Promise<void>;
  liquidacionId: string;
  nombre: string;
  avisada: boolean;
}) {
  const [tocado, setTocado] = useState(false);
  const yaEsta = avisada || tocado;

  return (
    <form action={accion} style={{ display: "inline" }}>
      <input type="hidden" name="liquidacionId" value={liquidacionId} />
      <button
        type="submit"
        onClick={() => {
          setTocado(true);
          window.open(href, "_blank", "noopener,noreferrer");
        }}
        title={
          yaEsta
            ? `A ${nombre} ya se le avisó. Tocá de nuevo si querés volver a mandarle el mensaje.`
            : `Abrir WhatsApp con el mensaje para ${nombre} ya escrito`
        }
        aria-label={`Mandarle la liquidación a ${nombre} por WhatsApp`}
        className="pastilla"
        style={{
          padding: "5px 10px", fontSize: 12, minHeight: 32,
          // Una vez avisado el botón se apaga pero NO desaparece: con veintinueve en la lista,
          // saber por dónde se iba es media función, y a veces hay que volver a mandarlo.
          opacity: yaEsta ? 0.5 : 1,
        }}
      >
        {yaEsta ? "✓ WhatsApp" : "WhatsApp"}
      </button>
    </form>
  );
}
