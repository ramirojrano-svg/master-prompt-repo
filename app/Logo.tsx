// app/Logo.tsx — el logo del centro. Sale del PNG que vive en /public/logo.png.
//
// El archivo tiene fondo TRANSPARENTE y está recortado al contenido, así que acá no hace falta
// ningún truco de CSS: se muestra tal cual, escalado al alto que pida cada pantalla.
//
// Antes hubo dos intentos que no funcionaron y conviene no repetirlos:
//  · Recortar la mitad de arriba por CSS para "sacar" el texto en la barra chica. Asumía que el
//    PNG dividía mitad y mitad entre montaña y letras; con la proporción real cortaba la M.
//  · `mix-blend-mode: multiply` para disolver el fondo. El fondo del archivo era CREMA, no blanco,
//    así que el rectángulo seguía viéndose sobre los degradados del login. El problema estaba en
//    la imagen, y ahí se arregló: relleno transparente y recorte al contenido.

export function Logo({ alto = 28, variante = "completo" }: { alto?: number; variante?: "completo" | "compacto" | "marca" }) {
  return (
    <img
      src="/logo.png"
      alt="Espacio Montes de Oca"
      style={{ display: "block", height: alto, width: "auto", maxWidth: "100%" }}
      // Las tres variantes siguen aceptándose para no tocar los siete lugares que las pasan, pero
      // hoy las tres muestran el mismo archivo. Queda en el markup para no perder la intención.
      data-variante={variante}
    />
  );
}
