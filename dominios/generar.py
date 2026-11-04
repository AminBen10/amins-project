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
    "Extranjería e inmigración",
    "Bodas",
    "Vivienda",
    "Hogar y reformas",
    "Seguros",
    "Energía y movilidad",
    "Motor y taller",
    "Salud y estética",
    "Mascotas",
    "Formación y empleo",
    "Pádel, tenis y raqueta",
    "Fitness y entrenamiento",
    "Running y ciclismo",
    "Montaña, nieve y agua",
    "Golf, fútbol y otros deportes",
    "Aficiones y ocio",
    "Comercio y web",
    "Perfumería",
    "Inversión",
    "Frases",
    "Catalán",
]

DESCRIPCION = {
    "Perfumería": "Uso propio para Orienfragance.",
    "Catalán": 'Para negocios de Cataluña. "Sí" también es "sí" en catalán. '
               "Ojo: muchos negocios catalanes usan .cat como web principal.",
}

PRIORIDADES = {"A": 0, "B": 1, "C": 2}


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
    vender = [r for r in orden if r["lista_corta"] == "vender"]
    propio = [r for r in orden if r["lista_corta"] == "uso propio"]
    precio = sum(float(r["precio_usd_ano"] or 0) for r in vender + propio)
    precio_a = sum(float(r["precio_usd_ano"] or 0) for r in disponibles if r["prioridad"] == "A")
    comprados = [r for r in filas if r["estado"] == "comprado"]

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
        f"- **Lista corta:** {len(vender)} para vender y {len(propio)} de uso propio, "
        f"unos {miles(precio)} $ al año.",
        f"- Comprar todos los de prioridad A costaría unos {miles(precio_a)} $ al año.",
        f"- Comprados: {len(comprados)}.",
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
        ("Dominio", lambda r: f"**{r['dominio']}**"),
        ("Sector", lambda r: r["sector"]),
        ("Para", lambda r: r["lista_corta"]),
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
        "",
    ]
    OUT_MD.write_text("\n".join(md), encoding="utf-8")

    escribir_lista("lista-corta.txt", [r["dominio"] for r in vender + propio])
    escribir_lista("prioridad-a.txt", [r["dominio"] for r in orden if r["prioridad"] == "A"])
    escribir_lista("todos.txt", [r["dominio"] for r in orden])
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
