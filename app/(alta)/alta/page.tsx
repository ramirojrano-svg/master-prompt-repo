// app/(alta)/alta/page.tsx — pantalla de alta del centro (onboarding paso 1, §6.12).
import { FormAlta } from "./FormAlta.tsx";

export default function AltaPage() {
  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
      <h1>EMOAPP</h1>
      <p className="tenue">
        Gestión de alquiler de consultorios. Empezá creando tu centro: el país define la zona
        horaria de tu agenda, y esa decisión no se corrige sola después.
      </p>
      <FormAlta />
    </main>
  );
}
