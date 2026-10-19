# Gestión de señales y vallas temporales

Aplicación web para el Ayuntamiento: mapa del municipio (OpenStreetMap, servido desde nuestro propio servidor), almacén con stock, arrastrar y soltar, acceso por código y sincronización en tiempo real.

Municipio de ejemplo: **Monòver / Monóvar (Alicante)**, relación OSM 346025.

## Instalación y arranque
Requisitos: Node.js 18+ (y `curl`, `python3` para el script de descarga del mapa).
```bash
npm install
npm start            # http://localhost:3000  (puerto en config.json o variable PORT)
```
Ningún recurso se carga de Internet: Leaflet está en `public/vendor/` y el callejero en `data/osm/`.

## Uso
- **Sin código**: consulta del mapa, stock, resumen por calle, impresión y exportación.
- **Jefe de sección (código admin)**: crea/selecciona una *Orden de trabajo* (nombre y fecha). Solo él arrastra elementos del almacén al mapa: cada arrastre crea una **planificación (borde ámbar discontinuo)** asociada a la orden y **descuenta inmediatamente el stock del almacén** (columna «Planif.»), visible en tiempo real para todos. Puede mover las marcas ámbar (arrastrándolas) y eliminarlas (tocándolas, o arrastrándolas a «Recoger»). Edita los totales (+/− o número, nunca por debajo de lo que está fuera del almacén).
- **Operario**: no arrastra para colocar. Toca una marca ámbar → diálogo grande **«Fijar aquí» (Confirmar colocada)** → la marca pasa a **colocada (borde verde)**, registrando quién y cuándo. Toca una marca verde → «Recoger al almacén» (con doble confirmación).
- Las marcas verdes (colocadas) no se pueden arrastrar, para evitar desplazamientos accidentales (si hay que cambiarla de sitio: recoger y planificar de nuevo). Se ven siempre, de cualquier orden. Las ámbar de otras órdenes se muestran atenuadas al seleccionar una orden.
- Todo se sincroniza en tiempo real entre dispositivos y se guarda en `DATA_DIR` (`estado.json` y `proyectos/`).
- En pantallas de hasta 900 px el almacén es un cajón lateral (botón ☰ Almacén); el mapa ocupa la pantalla.
- **Flechas de sentido único**: se dibujan sobre las calles con `oneway=yes/-1` a partir de zoom 17 (`ZOOM_FLECHAS` en `index.html`).
- **Por calle**: pestaña con el resumen agrupado por la calle OSM más cercana (≤150 m, si no «Sin calle identificada»), con colocadas 🟢 / planificadas 🟠. Botones: hoja de trabajo imprimible con casillas, CSV (UTF‑8 con BOM, `;`, para Excel) y PDF. Se filtra por la orden seleccionada.
- **Imprimir**: informe A4 apaisado con mapa ajustado a los elementos (numerados), leyenda, tabla (nº, tipo, código, calle, coordenadas, estado, orden, fecha, quién) y resumen por calle. Use «Guardar como PDF» del navegador o `GET /api/informe.pdf`.

## Configuración
**Códigos de acceso (variables de entorno, nunca en el repositorio):**
- `CODIGO_JEFE`: código del jefe de sección (administrador).
- `CODIGOS_OPERARIOS`: códigos de operario separados por comas; opcionalmente con nombre: `CODIGO1:Juan,CODIGO2:Pedro`.
- `NOMBRE_JEFE` (opcional): nombre mostrado para el jefe de sección.
Si faltan, el servidor arranca con los códigos de demostración y muestra un AVISO en el registro. Defínalos siempre en producción.
Tras 10 códigos erróneos desde una misma IP, el acceso se bloquea 15 minutos.

**Otras variables:** `PORT` (puerto; por defecto el de `config.json`), `HOST` (por defecto `0.0.0.0`), `DATA_DIR` (carpeta de `estado.json` y `proyectos/`; por defecto `./data`), `CHROME_PATH` (opcional, PDF generado en servidor).

**`config.json`** contiene solo el catálogo (`tipos`: id, código, nombre, total inicial, grupo), `puerto` y `operariosEditanTotales`. Los iconos SVG están en `public/index.html` (objeto `ICONOS`).
El estado se guarda en `DATA_DIR/estado.json` y el plan de cada orden de trabajo en `DATA_DIR/proyectos/<id>.json`.

## Despliegue en Render
1. Suba este repositorio a GitHub.
2. En Render: **New → Blueprint** y elija el repositorio (usa `render.yaml`). Introduzca `CODIGO_JEFE` y `CODIGOS_OPERARIOS` cuando se pidan.
3. La app queda en `https://<servicio>.onrender.com` (HTTPS; el tiempo real usa `wss://` por el mismo puerto). Comprobación: `/healthz`.
- **Plan gratuito:** el servicio se duerme tras 15 min sin tráfico (tarda alrededor de un minuto en despertar) y su disco es efímero: **las señales, órdenes y proyectos se pierden en cada reinicio o despliegue**. Para uso real: plan de pago con disco persistente (descomente `disk` en `render.yaml` y ponga `DATA_DIR=/var/data`).
- En Render no hay Chrome: los botones «PDF» se ocultan y se usa **🖨 Imprimir → Guardar como PDF** del navegador (`/api/*.pdf` responde 501).

## Cambiar de municipio
```bash
bash scripts/descargar-osm.sh "Nombre del municipio" "Provincia"
# ej.: bash scripts/descargar-osm.sh "Villena" "Alicante"
```
El script localiza el término municipal en Nominatim, descarga el extracto de Overpass API (calles, edificios, usos del suelo, cauces, topónimos y límite municipal) en `data/osm/municipio.osm`, lo convierte a `municipio.geojson` y escribe `meta.json` (centro y bbox). Reinicie el servidor. Conviene vaciar `data/estado.json` si cambia de municipio.

## API
- `GET /api/estado` – stock y elementos colocados
- `GET /api/mapa/osm` – descarga del extracto .osm
- `GET /api/resumen.csv?orden=<id>` – resumen por calle en CSV
- `GET /api/informe.pdf?orden=<id>`, `GET /api/hoja.pdf?orden=<id>` – PDF generado en el servidor con Chrome/Chromium headless (`puppeteer-core`, dependencia opcional; ruta en `CHROME_PATH`). Sin Chrome responde 501; use Imprimir → Guardar como PDF.
- `GET /api/capacidades` – `{pdf: true|false}` · `GET /healthz` – estado del servicio
- `GET /api/mapa/geojson`, `GET /api/mapa/meta`
- `POST /api/login` `{codigo}` – WebSocket en `/ws?token=…`

## Licencia de los datos
Datos del mapa © colaboradores de OpenStreetMap, disponibles bajo la Open Database License (ODbL): https://www.openstreetmap.org/copyright
