# Corte Real · web 3D para barbería

Web de una sola página para una barbería con una experiencia 3D guiada por el scroll:

1. **Poste de barbero** girando con estelas doradas (portada).
2. Al bajar, el poste **se deshace en partículas** que forman una **cabeza 3D**.
3. **El ritual** en cuatro pasos: consulta (anillo de escaneo), **máquina** en los laterales,
   **tijera** arriba y **navaja** en la barba. Cada herramienta corta el pelo en tiempo real.
4. **Estudio de estilos**: el visitante cambia de corte (degradado, tupé, crew cut, rapado) y de
   barba (sin barba, tres días, corta, completa) y gira la cabeza arrastrando.
5. Carta de **servicios y precios**, **equipo** y **reserva** (servicio → barbero → día → hora → datos).

Todo el 3D se genera por código (sin modelos ni texturas externas): la cabeza es una escultura
de campos de distancia convertida en malla, el pelo usa *fur shells* y las herramientas son
geometría procedural.

## Arrancar

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/ listo para subir a cualquier hosting estático
npm run preview  # sirve dist/ en local
```

Se puede publicar `dist/` tal cual en Vercel, Netlify, GitHub Pages o cualquier servidor.

## Personalizar para otra barbería

Todo lo que cambia de un cliente a otro está en [`src/config.js`](src/config.js):

| Qué | Dónde |
| --- | --- |
| Nombre, dirección, teléfono, Instagram | `BRAND` |
| Horario (para el estado "Abierto ahora" y las horas reservables) | `OPENING` y `HOURS_TABLE` |
| Servicios, precios y duración | `SERVICES` |
| Barberos | `BARBERS` |
| Cortes y barbas del estudio 3D | `HAIR_LOOKS`, `BEARD_LOOKS`, `DEFAULT_LOOK` |
| Reserva de demostración o real | `BOOKING.mode` |

Los textos de servicios, equipo y horario se escriben en el HTML al compilar (no dependen de
JavaScript), y se genera el marcado `schema.org/HairSalon` con dirección, horario y precios,
lo que ayuda al SEO local.

Colores y tipografías están en las variables del principio de [`src/styles.css`](src/styles.css).

## Reservas

El formulario funciona completo pero en **modo demostración**: las horas ocupadas se simulan y
la confirmación avisa de que no se ha guardado ninguna cita. Para conectarlo a una agenda real
hay que sustituir `isTaken()` y el `submit` de [`src/ui/booking.js`](src/ui/booking.js) por
llamadas al sistema que use la barbería (Booksy, Treatwell, Calendly, una tabla en Supabase…)
y poner `BOOKING.mode = 'live'`.

## Estructura

```
index.html              estructura y textos de la página
src/config.js           datos de la barbería
src/content.js          HTML y schema.org generados desde config.js
src/main.js             arranque y conexión scroll → escena 3D
src/styles.css          diseño
src/ui/                 estudio de estilos, reserva y estado de apertura
src/three/stage.js      renderer, luces, bloom y coreografía del scroll
src/three/pole.js       poste de barbero
src/three/headSdf.js    escultura de la cabeza (SDF + surface nets)
src/three/head.js       material de la cabeza y carga en un Web Worker
src/three/hair.js       pelo y barba (fur shells) y los estilos
src/three/tools.js      máquina, tijeras, navaja y pelo cortado
src/three/morph.js      partículas poste → cabeza
```

## Rendimiento y accesibilidad

- En móviles se usan menos capas de pelo, menos partículas y una malla más ligera.
- La cabeza se calcula en un Web Worker mientras el poste ya está en pantalla.
- El canvas deja de dibujar cuando se llega a la carta de precios y cuando la pestaña no está visible.
- Con "reducir movimiento" activado se quitan las animaciones automáticas.
- Sin WebGL la web sigue funcionando entera (estudio, carta y reservas) sin la parte 3D.
