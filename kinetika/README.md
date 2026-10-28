# Kinetika — prototipo

Software y fichas clínicas para kinesiólogos. Prototipo interactivo: landing, alta de cuenta,
pacientes, ficha clínica con mapa corporal y dictado con IA (simulado), agenda semanal y
mensual, funcionalidades y planes.

Todo corre en el navegador y los datos viven en memoria: **recargar la página vuelve a los
datos de ejemplo**. No hay backend ni base de datos todavía.

Hecho con Vite + React 18 + Tailwind CSS 3.

## Correrlo en tu máquina

Necesitás Node 18 o más nuevo.

```bash
cd kinetika
npm install
npm run dev        # → http://localhost:5173
```

`npm run build` genera la versión de producción en `dist/`, y `npm run preview` la sirve
para verla antes de subirla.

## Subirlo a Vercel

Este proyecto vive en la carpeta `kinetika/` del repositorio, así que hay que decirle a
Vercel que empiece desde ahí:

1. En [vercel.com/new](https://vercel.com/new), **Import** el repositorio
   `master-prompt-repo`.
2. En **Root Directory** tocá *Edit* y elegí **`kinetika`**. Este es el paso que no hay que
   olvidar: sin él Vercel intenta compilar la otra app del repo.
3. El framework lo detecta solo (**Vite**). Build `npm run build`, salida `dist` — ya están
   en `vercel.json`, no hace falta tocar nada.
4. **Deploy.** No necesita variables de entorno.

Para que la URL principal siga una rama concreta, en el proyecto de Vercel andá a
**Settings → Git → Production Branch** y poné esa rama. Cada push a la rama redespliega solo,
y las otras ramas quedan como *Preview* con su propia URL.

## Cómo está organizado

```
index.html         la página y las fuentes
src/main.js        monta la app
src/App.js         todas las pantallas (componentes con htm, igual que el prototipo)
src/index.css      Tailwind + animación del dictado
public/logo.png    el logo
vercel.json        config de build para Vercel
```
