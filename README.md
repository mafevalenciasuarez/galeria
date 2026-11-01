# Galería de innovaciones didácticas (prototipo)

Pasillo escolar en 3D con CSS (sin build, sin frameworks). Vanilla JS + GSAP 3.12.5 desde CDN.

## Cómo ejecutarlo

Necesita un servidor estático (el navegador bloquea `fetch` desde `file://`).

1. Instala la extensión **Live Server** en VS Code o Cursor.
2. Clic derecho en `index.html` → **Open with Live Server**.
3. Se necesita conexión a internet para cargar GSAP desde el CDN.

Si abres `index.html` con doble clic verás un aviso que indica usar Live Server.

### Controles

- Flechas izquierda/derecha: sala anterior/siguiente. `Esc` cierra tarjeta y ventanas.
- Barra inferior: Anterior, menú de salas, Siguiente, Sonido, «Sin animación».
- `prefers-reduced-motion` o «Sin animación»: cortes instantáneos, sin tweens.
- El audio está apagado por defecto. Si el archivo no existe aparece «Audio pendiente de grabar» y el guion (borrador) queda disponible.

### Depuración

Abre `index.html?debug=1`: dibuja todos los marcos `focus-*`, añade un menú «Marco» para visitar cada uno y registra `{x, y, z, s}` de la cámara en la consola.

## Mapa de carpetas

```
index.html, styles.css      Página y estilos
engine.js                   Orquestación: datos, paradas, secuencia de la puerta, depuración
camera.js                   Cámara (transform en #world) y goTo()
walls.js                    Carga de SVG en línea, paredes de reemplazo, hotspots y overlays
ui.js                       Tarjeta, ventana emergente, tooltip y audio
walls/                      SVG de cada pared (viewBox 0 0 1600 900)
walls/wall-fill.svg         Recorte vertical de la pared; cubre los huecos a los lados y arriba/abajo
galeria-data/gallery.json   Ruta, directorio, pestañas, tokens de tema
galeria-data/exp-*.json     Contenido de cada experiencia
audio/                      Audios (vacío por ahora)
tools/frames.json           Marcos de cámara por pared
tools/inject-frames.mjs     Inyecta <g id="focus-frames"> en los SVG
```

## Marcos de cámara en los SVG actuales

Los SVG de `walls/` aún no contienen `<g id="focus-frames">`. El motor lo detecta y usa `tools/frames.json` como respaldo (mensaje informativo en consola). Si quieres incrustarlos en los archivos:

```
node tools/inject-frames.mjs <carpeta-svg-origen> tools/frames.json <carpeta-salida>
```

El script normaliza el id raíz al nombre del archivo y es idempotente.

## Cómo añadir una pared nueva

1. Exporta el SVG a `walls/wall-NN-nombre.svg` (viewBox `0 0 1600 900`, sin minificar ids).
2. Añade la entrada en `rooms[]` de `galeria-data/gallery.json` (`order`, `wall_svg`, `data`, y `hotspots` si aplica) y crea su `exp-*.json`.
3. Añade los marcos 16:9 de la pared en `tools/frames.json`, bajo `walls["wall-NN-nombre"]`.
4. Ejecuta `node tools/inject-frames.mjs <origen> tools/frames.json <salida>` y copia el resultado a `walls/`.

Mientras el SVG no exista, la sala aparece con una pared neutra y su título, y sigue en la ruta y en el menú.

## Notas

- La sala de reflexión (`final_room`) se añade al final de la ruta porque el directorio la enlaza.
- Con salas sin SVG, el navegador registra un 404 por cada archivo faltante. Es esperado.
