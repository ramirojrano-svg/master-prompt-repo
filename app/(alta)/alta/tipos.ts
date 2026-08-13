// app/(alta)/alta/tipos.ts — tipos de la action, en un archivo aparte.
// Motivo: un archivo con "use server" SOLO puede exportar funciones async (§9 — una constante
// exportada ahí rompió producción 2 días en el SaaS anterior, sin que tsc ni el build lo
// detectaran). Los tipos y constantes van afuera, siempre.

export type SalidaAlta = { ok: true; zonaHoraria: string } | { ok: false; mensaje: string };
