# Dominios .si

Investigación de dominios .si en español y catalán. El .si es de Eslovenia, pero se lee como "sí" y, desde 2026, como "Super Intelligence".

## Qué hay en esta carpeta

| Archivo | Qué es |
|---|---|
| `disponibles.csv` | **La fuente principal.** Todos los dominios que salieron disponibles, con sector, idioma, prioridad, estado y nota. Se abre en Excel o Google Sheets. |
| `disponibles.md` | La misma información, ordenada por sectores para leerla cómodamente. Se genera a partir del CSV. |
| `listas/primera-compra.txt` | **La primera compra:** uso propio para Orienfragance y el lote de prueba de venta, con sus .com. |
| `listas/vender-rapido.txt` | Los dominios que pasan el filtro de venta rápida. |
| `listas/lista-corta.txt` | Los que hay que comprar primero. Listo para pegar en el carrito. |
| `listas/prioridad-a.txt` | Todos los de prioridad A. |
| `listas/todos.txt` | Todos los disponibles. |
| `listas/si-y-com.txt` | Cada nombre en .si y en .com, uno detrás de otro, para ver si el .com está ocupado. |
| `listas/palabras.txt` | Solo los nombres, sin extensión, para Beast Mode marcando .si y .com. |
| `listas/com-libres.txt` | Los nombres que tienen el .com libre, en .si y en .com. |
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

**Para ver si el .com está ocupado:** pega `listas/si-y-com.txt` en Beast Mode. Si el .com está ocupado por un negocio activo, ese negocio es un posible comprador del .si. Si es una marca conocida, revisa que no haya conflicto antes de comprar el .si.

**Cuando compres uno:** cambia su `estado` de `disponible` a `comprado` en el CSV y vuelve a ejecutar el script.

## Filtro "vender rápido"

`generar.py` da a cada dominio una puntuación y deja en "Vender rápido" los que llegan a 8 puntos. Combina los criterios de Claude y los de Gemini que resultaron correctos en el red team:

| Regla | Puntos |
|---|---|
| Sector: lo rápido que se cierra una venta (comprador que gasta en captar clientes, decide el dueño, paga con tarjeta) | 0 a 5 |
| Prioridad A / C | +2 / −5 |
| El .com está ocupado (hay un negocio que puede querer el .si) | +1 |
| El .com está libre y no lo compramos (el comprador puede registrarlo él) | −2 |
| El .com está libre y lo compramos para venderlos juntos | +1 |
| Duplica a otro dominio | −4 |
| La nota avisa de regulación, polémica, ambigüedad o temporada | −2 |
| En inglés (el inglés de la IA está barrido y su comprador busca .com o .ai) | −3 |
| En catalán (mercado más pequeño, se usa .cat) | −1 |
| Nombre corto (9 letras o menos) / largo (19 o más) | +1 / −1 |
| Frase con "sí" o doble sentido | +1 |

Los sectores y sus puntos están en `VELOCIDAD_SECTOR`, dentro de `generar.py`. La perfumería queda fuera porque es para uso propio.

Precio orientativo: con 9 puntos, pedir entre 990 y 1.490 € (mínimo 490 €); con 8, entre 690 y 990 € (mínimo 290 €).

## Columnas del CSV

| Columna | Valores |
|---|---|
| `dominio` | En minúsculas, terminado en `.si` |
| `sector` | Uno de los sectores de `ORDEN_SECTORES` en `generar.py` |
| `idioma` | `es` (castellano), `ca` (catalán), `fr` (francés) o `en` (inglés) |
| `prioridad` | `A` comprar ya, `B` solo con comprador o uso propio, `C` descartar |
| `lista_corta` | `vender`, `uso propio` o vacío |
| `com` | Si el mismo nombre en .com está `libre` u `ocupado`. Vacío = sin comprobar |
| `comprar_com` | `vender`, `uso propio` o vacío: si hay que comprar también el .com |
| `grupo` | `uso propio` o `prueba` (lote de prueba de venta), o vacío |
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
| `lote7-perfumes-arabes.txt` | Perfumes árabes: hacks ("huele.si"), oud, bakhoor, almizcle, halal, marca blanca, catalán, francés, italiano, inglés (108) | **Pendiente** |
| `lote8-2030.txt` | Visión 2030 con leyes que tienen fecha: agentes en español, CBAM, pasaporte digital, accesibilidad, eIDAS 2, energía, criptografía post-cuántica (125) | **Pendiente** |
| (sin archivo) | Búsquedas propias de Amin y listas de Gemini: oficios, industria, logística, agro, herencias, salud, infraestructura 2030 | Comprobado |

## Antes de comprar o vender

- Revisa que la palabra no sea una marca registrada en **EUIPO** y **OEPM**.
- No uses nombres de organismos públicos (DGT, SEPE, Hacienda…): parecería suplantación.
- Desactiva la renovación automática de los que no quieras conservar y comprueba que se ha guardado.
- Para vender, lee primero la sección sobre la LSSI en `pitches.md`.
