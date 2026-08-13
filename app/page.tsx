// app/page.tsx — portada mínima. La superficie pública del centro (/c/[slug]) es F6 y nace
// apagada por default (§12 #9).
import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
      <h1>EMOAPP</h1>
      <p className="tenue">Agenda, inquilinos y cuenta corriente de un centro de consultorios.</p>
      <p>
        <Link href="/alta">Creá tu centro</Link>
      </p>
    </main>
  );
}
