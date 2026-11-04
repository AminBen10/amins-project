#!/usr/bin/env python3
"""Genera los archivos de lectura a partir de disponibles.csv.

Uso:  python3 dominios/generar.py

disponibles.csv es la única fuente. No edites a mano los archivos que crea
este script (disponibles.md y los .txt de listas/), porque se sobrescriben.
"""
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

DIR = Path(__file__).resolve().parent
CSV = DIR / "disponibles.csv"
OUT_MD = DIR / "disponibles.md"
LISTAS = DIR / "listas"

# Orden en que salen los sectores en disponibles.md.
ORDEN_SECTORES = [
    "Abogados y reclamaciones",
    "Reclamaciones bancarias y de viajes",
    "Extranjería e inmigración",
    "Fiscal y autónomos",
    "Empresas y cumplimiento",
    "Bodas",
    "Vivienda",
    "Alquiler turístico",
    "Hogar y reformas",
    "Seguros",
    "Mayores y decesos",
    "Energía y movilidad",
    "Motor y taller",
    "Industria, logística y maquinaria",
    "Agro y medio ambiente",
    "Salud y estética",
    "Mascotas",
    "Formación y empleo",
    "Agentes e IA para pymes",
    "Tecnología e IA",
    "Robots y drones",
    "Infraestructura 2030 (inglés)",
    "Pádel, tenis y raqueta",
    "Fitness y entrenamiento",
    "Running y ciclismo",
    "Montaña, nieve y agua",
    "Golf, fútbol y otros deportes",
    "Fútbol y deporte digital",
    "Aficiones y ocio",
    "Alimentación",
    "Comercio y web",
    "Perfumería",
    "Finanzas e inversión",
    "Frases",
    "Catalán",
]

DESCRIPCION = {
    "Perfumería": "Sobre todo para uso propio en Orienfragance. Incluye nombres en castellano, catalán y francés.",
    "Empresas y cumplimiento": "Obligaciones legales de las empresas. Los vendedores de software y "
                               "las consultoras compiten mucho por estos clientes.",
    "Alquiler turístico": "Ojo: las normas cambian según el ayuntamiento y la comunidad.",
    "Catalán": 'Para negocios de Cataluña. "Sí" también es "sí" en catalán. '
               "Ojo: muchos negocios catalanes usan .cat como web principal.",
}

PRIORIDADES = {"A": 0, "B": 1, "C": 2}

# Renovación anual del .com en Namecheap (el primer año suele ser más barato).
PRECIO_COM = 15.98

# Estado del mismo nombre en .com. Vacío = sin comprobar.
COM = {"": "?", "libre": "libre", "ocupado": "ocupado"}


def leer():
    with CSV.open(newline="", encoding="utf-8") as f:
        filas = list(csv.DictReader(f))
    errores = []
    vistos = set()
    for i, r in enumerate(filas, start=2):
        d = r["dominio"]
        if not d.endswith(".si") or d != d.lower() or " " in d:
            errores.append(f"línea {i}: dominio mal escrito: {d!r}")
        if d in vistos:
            errores.append(f"línea {i}: dominio repetido: {d}")
        vistos.add(d)
        if r["prioridad"] not in PRIORIDADES:
            errores.append(f"línea {i}: prioridad no válida: {r['prioridad']!r}")
        if r["sector"] not in ORDEN_SECTORES:
            errores.append(f"línea {i}: sector desconocido: {r['sector']!r} (añádelo a ORDEN_SECTORES)")
        if r["lista_corta"] not in ("", "vender", "uso propio"):
            errores.append(f"línea {i}: lista_corta no válida: {r['lista_corta']!r}")
        if r.get("com", "") not in COM:
            errores.append(f"línea {i}: com no válido: {r.get('com')!r} (usa libre, ocupado o vacío)")
        if r.get("comprar_com", "") not in ("", "vender", "uso propio"):
            errores.append(f"línea {i}: comprar_com no válido: {r.get('comprar_com')!r}")
        if r.get("comprar_com") and r.get("com") != "libre":
            errores.append(f"línea {i}: comprar_com marcado pero el .com no está libre: {d}")
    if errores:
        sys.exit("\n".join(errores))
    return filas


def escribir_lista(nombre, dominios):
    LISTAS.mkdir(exist_ok=True)
    (LISTAS / nombre).write_text("".join(d + "\n" for d in dominios), encoding="utf-8")


def tabla(filas, columnas):
    out = ["| " + " | ".join(c for c, _ in columnas) + " |",
           "|" + "---|" * len(columnas)]
    for r in filas:
        out.append("| " + " | ".join(f(r) for _, f in columnas) + " |")
    return out


def main():
    filas = leer()
    disponibles = [r for r in filas if r["estado"] == "disponible"]
    por_sector = defaultdict(list)
    for r in disponibles:
        por_sector[r["sector"]].append(r)
    for s in por_sector:
        por_sector[s].sort(key=lambda r: PRIORIDADES[r["prioridad"]])  # estable: respeta el orden del CSV

    cuenta = Counter(r["prioridad"] for r in disponibles)
    orden = [r for s in ORDEN_SECTORES for r in por_sector.get(s, [])]
    corta = [r for r in orden if r["lista_corta"] or r.get("comprar_com")]
    vender = [r for r in corta if "vender" in (r["lista_corta"], r.get("comprar_com"))]
    propio = [r for r in corta if r not in vender]
    coms = [r for r in corta if r.get("comprar_com")]
    precio = (sum(float(r["precio_usd_ano"] or 0) for r in corta if r["lista_corta"])
              + PRECIO_COM * len(coms))
    precio_a = sum(float(r["precio_usd_ano"] or 0) for r in disponibles if r["prioridad"] == "A")
    comprados = [r for r in filas if r["estado"] == "comprado"]
    com_libre = [r for r in orden if r.get("com") == "libre"]
    com_ocupado = [r for r in orden if r.get("com") == "ocupado"]

    md = [
        "# Dominios .si disponibles",
        "",
        "> Archivo generado con `python3 dominios/generar.py` a partir de `disponibles.csv`.",
        "> Para cambiar algo, edita el CSV y vuelve a ejecutar el script.",
        "",
        "## Resumen",
        "",
        f"- **{len(disponibles)} dominios disponibles**: {cuenta['A']} de prioridad A, "
        f"{cuenta['B']} de prioridad B y {cuenta['C']} de prioridad C.",
        f"- **Lista corta:** {len(vender)} nombres para vender y {len(propio)} de uso propio "
        f"({sum(1 for r in corta if r['lista_corta'])} en .si y {len(coms)} en .com), "
        f"unos {miles(precio)} $ al año.",
        f"- Comprar todos los de prioridad A costaría unos {miles(precio_a)} $ al año.",
        f"- Comprados: {len(comprados)}.",
        f"- **.com del mismo nombre:** {len(com_libre)} libres y {len(com_ocupado)} ocupados.",
        "",
        "Prioridad:",
        "- **A**: comprar ya (comprador claro y que gasta en publicidad)",
        "- **B**: solo si encaja con un proyecto propio o hay un comprador concreto",
        "- **C**: descartar, salvo uso propio",
        "",
        "## Lista corta: comprar primero",
        "",
    ]
    md += tabla(vender + propio, [
        ("Nombre", lambda r: f"**{r['dominio'][:-3]}**"),
        ("Comprar", lambda r: " + ".join(x for x, s in ((".si", r["lista_corta"]), (".com", r.get("comprar_com"))) if s)),
        ("Sector", lambda r: r["sector"]),
        ("Para", lambda r: r["lista_corta"] or r.get("comprar_com")),
        ("Nota", lambda r: r["nota"]),
    ])
    md += [
        "",
        "## Con el .com también libre",
        "",
        "Se puede registrar el nombre en .si y en .com. Si el .com está ocupado por un negocio activo, "
        "ese negocio es un posible comprador del .si; si está libre, nadie ha montado todavía un negocio "
        "con ese nombre.",
        "",
    ]
    md += tabla(com_libre, [
        ("Nombre", lambda r: f"**{r['dominio'][:-3]}**"),
        ("Sector", lambda r: r["sector"]),
        ("Prioridad", lambda r: r["prioridad"]),
        ("Nota", lambda r: r["nota"]),
    ])
    md += ["", "## Por sector", ""]
    md += tabla([{"s": s} for s in ORDEN_SECTORES if s in por_sector], [
        ("Sector", lambda r: f"[{r['s']}](#{ancla(r['s'])})"),
        ("Total", lambda r: str(len(por_sector[r["s"]]))),
        ("A", lambda r: str(sum(x["prioridad"] == "A" for x in por_sector[r["s"]]))),
        ("B", lambda r: str(sum(x["prioridad"] == "B" for x in por_sector[r["s"]]))),
        ("C", lambda r: str(sum(x["prioridad"] == "C" for x in por_sector[r["s"]]))),
    ])

    for s in ORDEN_SECTORES:
        if s not in por_sector:
            continue
        md += ["", f"## {s}", ""]
        if s in DESCRIPCION:
            md += [DESCRIPCION[s], ""]
        md += tabla(por_sector[s], [
            ("Dominio", lambda r: r["dominio"]),
            ("Prioridad", lambda r: r["prioridad"]),
            (".com", lambda r: COM[r.get("com", "")]),
            ("Nota", lambda r: r["nota"]),
        ])

    md += [
        "",
        "## Listas para copiar",
        "",
        "En la carpeta `listas/`, un dominio por línea, listas para pegar en el carrito o en la búsqueda masiva:",
        "",
        "- `listas/lista-corta.txt`: la lista corta (vender y uso propio)",
        "- `listas/prioridad-a.txt`: todos los de prioridad A",
        "- `listas/todos.txt`: todos los disponibles",
        "- `listas/si-y-com.txt`: cada nombre en .si y en .com, para ver si el .com está ocupado",
        "- `listas/palabras.txt`: solo los nombres, sin extensión, para Beast Mode marcando .si y .com",
        "- `listas/com-libres.txt`: los nombres con el .com libre, en .si y en .com",
        "",
    ]
    OUT_MD.write_text("\n".join(md), encoding="utf-8")

    escribir_lista("lista-corta.txt", [d for r in vender + propio for d, s in (
        (r["dominio"], r["lista_corta"]), (r["dominio"][:-3] + ".com", r.get("comprar_com"))) if s])
    escribir_lista("prioridad-a.txt", [r["dominio"] for r in orden if r["prioridad"] == "A"])
    escribir_lista("todos.txt", [r["dominio"] for r in orden])
    nombres = [r["dominio"][: -len(".si")] for r in orden]
    escribir_lista("palabras.txt", nombres)
    escribir_lista("si-y-com.txt", [d for n in nombres for d in (n + ".si", n + ".com")])
    escribir_lista("com-libres.txt", [d for r in com_libre for d in (r["dominio"], r["dominio"][:-3] + ".com")])
    print(f"OK: {len(disponibles)} disponibles, {cuenta['A']} A, lista corta {len(vender) + len(propio)}")


def miles(n):
    """Número redondeado con punto de miles, al estilo español: 1.352."""
    return f"{n:,.0f}".replace(",", ".")


def ancla(texto):
    """Ancla de encabezado al estilo de GitHub."""
    t = texto.lower()
    t = "".join(c for c in t if c.isalnum() or c in " -")
    return t.replace(" ", "-")


if __name__ == "__main__":
    main()
