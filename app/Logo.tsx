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
// La versión "completa" (login/inicio) es el PNG entero: montaña arriba, "ESPACIO MONTES DE OCA"
// abajo. Las versiones "compacto" y "marca" (barra superior) esconden ese texto: a 26 px de alto
// el nombre se hace ilegible y se convierte en una tira gris.
//
// No hay dos archivos: uno solo con recorte por CSS. Antes había un `/logo-marca.png` distinto,
// pero mantenerlos separados obliga a acordarse de reemplazar los dos cada vez que la marca
// cambia, y ese olvido termina con dos versiones distintas conviviendo en la app.
//
// La técnica es un contenedor con `aspect-ratio` cuadrado (el pedazo que se quiere mostrar) sobre
// una imagen que llena todo el ancho del logo real. Como el ancho lo fija el alto pedido por el
// contenedor cuadrado, la montaña sale a tamaño natural y el texto queda fuera de ese marco.
// Asume que la mitad superior del logo es la montaña, que es como está diseñado el archivo.

export function Logo({ alto = 28, variante = "completo" }: { alto?: number; variante?: "completo" | "compacto" | "marca" }) {
  const soloMarca = variante !== "completo";

  if (soloMarca) {
    // Marco cuadrado del alto pedido, con el PNG entero dentro escalado al DOBLE del alto: así la
    // mitad superior (la montaña) queda encuadrada y la inferior (el texto) cae afuera.
    return (
      <span
        aria-label="Espacio Montes de Oca"
        role="img"
        style={{
          display: "inline-block",
          width: alto,
          height: alto,
          overflow: "hidden",
          backgroundImage: "url(/logo.png)",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center top",
          // 200% de alto = la mitad del PNG entra. `auto` en el ancho conserva la proporción.
          backgroundSize: "auto 200%",
        }}
      />
    );
  }

  // Login e inicio: el PNG entero. `width:auto` respeta la proporción real del archivo, aunque
  // cambie en un futuro reemplazo.
  return (
    <img
      src="/logo.png"
      alt="Espacio Montes de Oca"
      style={{ display: "block", height: alto, width: "auto", maxWidth: "100%" }}
    />
  );
}
