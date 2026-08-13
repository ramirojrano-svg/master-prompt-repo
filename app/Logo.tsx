// app/Logo.tsx — el logo de MOCA, dibujado en SVG.
//
// Va en SVG y no en PNG a propósito: entra en el HTML sin un pedido extra, se ve nítido en
// cualquier pantalla y toma el color del tema. Si querés usar el archivo original, dejá el PNG en
// `public/logo-moca.png` y reemplazá este componente por un <img>: no lo usa nadie más que estas
// dos pantallas (login y barra superior).

/**
 * `completo` (login) trae el nombre entero; `compacto` (barra superior) solo la marca: a 30px de
 * alto la bajada "ESPACIO MONTES DE OCA" queda ilegible y ensucia, así que no se dibuja.
 */
export function Logo({ alto = 28, variante = "completo" }: { alto?: number; variante?: "completo" | "compacto" | "marca" }) {
  const conTexto = variante !== "marca";
  const conBajada = variante === "completo";
  const viewBox = variante === "marca" ? "0 0 135 100" : conBajada ? "0 0 510 100" : "0 0 400 100";
  const ancho = (alto * Number(viewBox.split(" ")[2])) / 100;
  return (
    <svg
      width={ancho}
      height={alto}
      viewBox={viewBox}
      role="img"
      aria-label="MOCA — Espacio Montes de Oca"
      style={{ display: "block" }}
    >
      {/* Las tres barras ascendentes: celeste, azul, gris — la más alta lleva la cruz. */}
      <rect x="6" y="52" width="30" height="48" rx="6" fill="#a9d9ef" />
      <rect x="44" y="30" width="30" height="70" rx="6" fill="#1a8fc1" />
      <rect x="82" y="4" width="34" height="96" rx="17" fill="#63788a" />
      {/* La cruz médica, calada en blanco sobre la barra alta. */}
      <path d="M96.2 16h5.6v7.4h7.4v5.6h-7.4V36.4h-5.6V29h-7.4v-5.6h7.4z" fill="#fff" />

      {conTexto && (
        <>
          <text
            x="140"
            y={conBajada ? 60 : 74}
            fill="#10365c"
            fontSize={conBajada ? 60 : 74}
            fontWeight="700"
            letterSpacing="-1"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          >
            MOCA
          </text>
          {conBajada && (
          <text
            x="142"
            y="88"
            fill="#5c7382"
            fontSize="20.5"
            fontWeight="500"
            letterSpacing="1.2"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          >
            ESPACIO MONTES DE OCA
          </text>
          )}
        </>
      )}
    </svg>
  );
}
