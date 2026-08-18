// app/Logo.tsx — el logo del centro. Sale del PNG que vive en /public/logo.png.
//
// Sin recorte por CSS: se muestra el archivo entero, escalado al alto pedido. Antes se recortaba
// la mitad superior para "sacar" el texto en la barra chica, pero eso asumía que el PNG dividía
// mitad y mitad entre montaña y letras; cualquier archivo con distinta proporción quedaba
// cortado por la mitad de la M.
//
// El PNG del centro trae fondo BLANCO pintado (no es transparente). Sobre los degradados agua
// del login queda un rectángulo blanco visible alrededor. `mix-blend-mode: multiply` resuelve
// esto sin retocar el archivo: multiplica los píxeles contra el fondo, así el blanco se vuelve
// transparente sobre cualquier tono claro y los colores de la montaña se preservan. No funciona
// sobre un fondo oscuro —el multiply lo apagaría todo—; hoy en la app no hay fondos oscuros, y
// el día que aparezca uno el fix es cambiar la imagen a PNG transparente, no forzar más CSS.

export function Logo({ alto = 28, variante = "completo" }: { alto?: number; variante?: "completo" | "compacto" | "marca" }) {
  return (
    <img
      src="/logo.png"
      alt="Espacio Montes de Oca"
      style={{
        display: "block",
        height: alto,
        width: "auto",
        maxWidth: "100%",
        mixBlendMode: "multiply",
      }}
      // La variante sigue aceptándose para no tocar los siete lugares que la pasan, pero por ahora
      // los tres apuntan al mismo archivo. Queda visible en el markup para no perder la intención.
      data-variante={variante}
    />
  );
}
