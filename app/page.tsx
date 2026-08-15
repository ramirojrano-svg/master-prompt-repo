// app/page.tsx — portada mínima. La superficie pública del centro (/c/[slug]) es F6 y nace
// apagada por default (§12 #9).
//
// "Entrar" va PRIMERO y como botón: esta pantalla es donde cae quien cerró sesión y vuelve a
// abrir la app. Antes el único camino era "Creá tu centro", así que salir dejaba encerrado —con
// la cuenta intacta y sin ninguna puerta a la vista— y la única salida era escribir la URL del
// panel de memoria. Crear un centro es lo que se hace UNA vez; entrar, todos los días.
import Link from "next/link";
import { Logo } from "./Logo.tsx";

export default function Home() {
  return (
    <main style={{ maxWidth: 460, margin: "72px auto", padding: "0 16px", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <Logo alto={54} />
      </div>
      <p className="tenue" style={{ marginTop: 0 }}>
        Agenda, profesionales y cuenta corriente de un centro de consultorios.
      </p>

      <p style={{ marginTop: 26 }}>
        <Link href="/login" className="pastilla" style={{ padding: "11px 30px", fontSize: 15 }}>
          Entrar
        </Link>
      </p>

      <p className="tenue" style={{ marginTop: 22, fontSize: 13 }}>
        ¿Todavía no tenés centro? <Link href="/alta">Creá el tuyo</Link>
      </p>
    </main>
  );
}
