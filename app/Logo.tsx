// app/Logo.tsx — el logo de MOCA. Sale del PNG que vive en /public/logo.png.
//
// Antes iba dibujado a mano en SVG, con las tres barras y la cruz. Ese trabajo se descartó cuando
// llegó el logo definitivo del centro (montaña y "ESPACIO MONTES DE OCA"), que no se parece a lo
// que estaba en el código: mantener las dos formas era garantía de que un día divergieran.
//
// Se usa <img> nativo y no <Image> de Next: el archivo vive en `public`, es chico y ya está donde
// se lo va a pedir, así que la optimización de Next no gana nada. Los `width`/`height` van sí o sí
// para que el navegador no pinte primero el hueco a 0px y después salte cuando termine de cargar.
//
// El "compacto" y el "marca" (por ahora) usan el MISMO archivo que la variante completa. Cuando
// haya una versión chica de verdad —solo la montaña sin la bajada— alcanza con dejarla en
// `public/logo-marca.png` y usar el nombre distinto acá.

// Tamaño de referencia del PNG. Se usa solo para respetar la proporción cuando la variante fija
// una altura: sin esto, cambiar el archivo por uno más ancho o más alto lo deformaría o
// desplazaría el nombre a su lado.
const PROPORCION = 2.2;

export function Logo({ alto = 28, variante = "completo" }: { alto?: number; variante?: "completo" | "compacto" | "marca" }) {
  // Los tres nombres siguen existiendo por compatibilidad con lo que ya usa la app —el login, la
  // barra superior, la pantalla de base caída— pero por ahora los tres apuntan al mismo archivo.
  const src = variante === "completo" ? "/logo.png" : "/logo-marca.png";
  const ancho = Math.round(alto * PROPORCION);
  return (
    <img
      src={src}
      alt="Espacio Montes de Oca"
      width={ancho}
      height={alto}
      style={{ display: "block", height: alto, width: "auto", maxWidth: "100%" }}
    />
  );
}
