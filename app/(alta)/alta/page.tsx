// app/(alta)/alta/page.tsx — pantalla de alta del centro (onboarding paso 1, §6.12).
//
// Con ALTA_ABIERTA apagada la pantalla responde 404, no un "no tenés permiso": a quien no
// corresponde no se le confirma que la función existe. Es la misma regla que usa el panel para un
// centro donde no sos nadie (ver sesion.ts).
import { notFound } from "next/navigation";
import { altaAbierta } from "../../../src/lib/alta-abierta.ts";
import { FormAlta } from "./FormAlta.tsx";

export default function AltaPage() {
  if (!altaAbierta()) notFound();

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
