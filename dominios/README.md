# Dominios .si

Investigación de dominios .si en español y catalán. El .si es de Eslovenia, pero se lee como "sí" y, desde 2026, como "Super Intelligence".

## Qué hay en esta carpeta

| Archivo | Qué es |
|---|---|
| `disponibles.csv` | **La fuente principal.** Todos los dominios que salieron disponibles, con sector, idioma, prioridad, estado y nota. Se abre en Excel o Google Sheets. |
| `disponibles.md` | La misma información, ordenada por sectores para leerla cómodamente. Se genera a partir del CSV. |
| `listas/lista-corta.txt` | Los que hay que comprar primero. Listo para pegar en el carrito. |
| `listas/prioridad-a.txt` | Todos los de prioridad A. |
| `listas/todos.txt` | Todos los disponibles. |
| `pitches.md` | Emails y mensajes de venta, respuestas preparadas y registro de contactos. |
| `candidatos/` | Todas las listas que hemos pasado por la búsqueda masiva, por lotes. |
| `generar.py` | Script que regenera `disponibles.md` y `listas/` a partir del CSV. |

## Cómo se usa

**Para comprobar disponibilidad:** pega un archivo de `candidatos/` en Namecheap Beast Mode (o en la búsqueda masiva de Dynadot).

**Para añadir los que salgan disponibles:** añade una fila por dominio a `disponibles.csv` y ejecuta:

```bash
python3 dominios/generar.py
```

El script avisa si hay un dominio repetido, mal escrito o con una prioridad o un sector que no existen.

**Cuando compres uno:** cambia su `estado` de `disponible` a `comprado` en el CSV y vuelve a ejecutar el script.

## Columnas del CSV

| Columna | Valores |
|---|---|
| `dominio` | En minúsculas, terminado en `.si` |
| `sector` | Uno de los sectores de `ORDEN_SECTORES` en `generar.py` |
| `idioma` | `es` (castellano), `ca` (catalán), `fr` (francés) o `en` (inglés) |
| `prioridad` | `A` comprar ya, `B` solo con comprador o uso propio, `C` descartar |
| `lista_corta` | `vender`, `uso propio` o vacío |
| `estado` | `disponible` o `comprado` |
| `comprobado` | Fecha en que se comprobó (AAAA-MM-DD) |
| `registrador` | Dónde se comprobó o se compró |
| `precio_usd_ano` | Precio de renovación por año, en dólares |
| `nota` | Por qué vale, a quién vendérselo o qué riesgo tiene |

## Lotes de candidatos

| Lote | Contenido | Estado |
|---|---|---|
| `lote1-general.txt` | Frases con "sí", bodas, abogados, finanzas, vivienda, salud, formación, comercio (335) | Comprobado |
| `lote2-deportes-aficiones.txt` | Pádel, deportes, aficiones, energía, extranjería (113) | Comprobado |
| `lote3-deportes.txt` | Pádel, tenis, golf, surf, running, ciclismo (121) | Comprobado |
| `lote4-catalan.txt` | Palabras de alto valor en catalán (92) | Comprobado |
| `lote5-nichos-tecnicos.txt` | Leyes nuevas, reclamaciones técnicas, IA, deporte digital, alimentación (180) | Comprobado |
| `lote6-angulos-ocultos.txt` | "Agente" con doble sentido, IA para pymes, protocolos de agentes, robots de casa, drones, fertilidad, casas modulares, apagón (151) | Comprobado |
| (sin archivo) | Búsquedas propias de Amin: oficios, industria, logística, agro, herencias, salud | Comprobado |

## Antes de comprar o vender

- Revisa que la palabra no sea una marca registrada en **EUIPO** y **OEPM**.
- No uses nombres de organismos públicos (DGT, SEPE, Hacienda…): parecería suplantación.
- Desactiva la renovación automática de los que no quieras conservar y comprueba que se ha guardado.
- Para vender, lee primero la sección sobre la LSSI en `pitches.md`.
