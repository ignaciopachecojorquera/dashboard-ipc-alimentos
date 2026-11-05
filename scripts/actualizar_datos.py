"""Descarga del INE el IPC de alimentación por tipo de producto y lo guarda en data/.

Fuente: API JSON del INE (servicios.ine.es/wstempus), tablas mensuales ECOICOP ver.2:
  - 76125  Índices nacionales: general y de grupos
  - 76126  Índices nacionales de subgrupos
  - 76127  Índices nacionales de clases

Salida:
  data/ipc_alimentos.csv          una fila por mes y categoría (índice y variación anual)
  data/ultima_actualizacion.json  último mes disponible y fecha de la descarga
"""

import csv
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/{tabla}?nult={n}"
MESES = 360  # pedimos de sobra y luego recortamos
DESDE = "2010-01"  # primer mes que se guarda

# (tabla, nombre exacto de la categoría en el INE, nombre corto en el dashboard, tipo)
CATEGORIAS = [
    (76125, "Índice general", "IPC general", "referencia"),
    (76125, "Alimentos y bebidas no alcohólicas", "Alimentación y bebidas", "total"),
    (76127, "Cereales y productos a base de cereales", "Pan y cereales", "producto"),
    (76127, "Carne", "Carne", "producto"),
    (76127, "Pescado y marisco", "Pescado y marisco", "producto"),
    (76127, "Leche, otros productos lácteos y huevos", "Lácteos y huevos", "producto"),
    (76127, "Aceites y grasas", "Aceites y grasas", "producto"),
    (76127, "Frutas y frutos de cáscara", "Frutas", "producto"),
    (76127, "Hortalizas, legumbres y patatas", "Hortalizas y legumbres", "producto"),
    (76127, "Azúcar, confitería y postres", "Azúcar y dulces", "producto"),
    (76127, "Alimentos preparados y otros productos alimenticios", "Alimentos preparados", "producto"),
    (76126, "Bebidas no alcohólicas", "Bebidas no alcohólicas", "producto"),
]

TIPOS = {"Índice": "indice", "Variación anual": "var_anual"}

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"


def descargar(tabla):
    url = API.format(tabla=tabla, n=MESES)
    for intento in range(1, 4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dashboard-ipc-alimentos"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # red del INE a veces lenta: reintentar
            print(f"Tabla {tabla}, intento {intento} fallido: {e}")
            time.sleep(10 * intento)
    raise RuntimeError(f"No se pudo descargar la tabla {tabla}")


def partes(nombre):
    """'Nacional. Carne. Variación anual. ' -> ('Carne', 'Variación anual')"""
    trozos = [t.strip() for t in nombre.split(". ") if t.strip()]
    trozos = [t.rstrip(".") for t in trozos]
    if len(trozos) < 3 or trozos[0] != "Nacional":
        return None, None
    return ". ".join(trozos[1:-1]), trozos[-1]


def main():
    tablas = {t: descargar(t) for t in sorted({c[0] for c in CATEGORIAS})}
    filas = {}  # (fecha, categoria) -> dict
    faltan = []

    for tabla, nombre_ine, nombre, tipo in CATEGORIAS:
        encontradas = 0
        for serie in tablas[tabla]:
            cat, dato = partes(serie.get("Nombre", ""))
            if cat != nombre_ine or dato not in TIPOS:
                continue
            encontradas += 1
            for d in serie.get("Data", []):
                if d.get("Valor") is None:
                    continue
                fecha = f"{d['Anyo']}-{int(d['FK_Periodo']):02d}"
                if fecha < DESDE:
                    continue
                fila = filas.setdefault((fecha, nombre), {
                    "fecha": fecha, "categoria": nombre, "tipo": tipo,
                    "indice": "", "var_anual": ""})
                fila[TIPOS[dato]] = round(float(d["Valor"]), 3)
        if encontradas == 0:
            faltan.append(f"{nombre_ine} (tabla {tabla})")

    if faltan:
        print("No se han encontrado estas series en el INE:\n  " + "\n  ".join(faltan))
    if not filas:
        sys.exit("No se ha descargado ningún dato: no se actualiza nada.")

    DATA.mkdir(exist_ok=True)
    orden = {c[2]: i for i, c in enumerate(CATEGORIAS)}
    salida = sorted(filas.values(), key=lambda f: (f["fecha"], orden[f["categoria"]]))
    csv_path = DATA / "ipc_alimentos.csv"
    antes = csv_path.read_text(encoding="utf-8") if csv_path.exists() else ""
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["fecha", "categoria", "tipo", "indice", "var_anual"])
        w.writeheader()
        w.writerows(salida)

    # Último mes con desglose por producto (el INE adelanta solo el IPC general a final de mes)
    ultimo = max(f["fecha"] for f in salida if f["tipo"] == "total")
    info_path = DATA / "ultima_actualizacion.json"
    anterior = json.loads(info_path.read_text()) if info_path.exists() else {}
    cambio = csv_path.read_text(encoding="utf-8") != antes
    info = {
        "ultimo_mes": ultimo,
        "descargado": datetime.now(timezone.utc).strftime("%Y-%m-%d") if cambio or not anterior
        else anterior.get("descargado"),
        "series_no_encontradas": faltan,
    }
    info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n")
    print(f"OK: {len(salida)} filas, último mes {ultimo}")


if __name__ == "__main__":
    main()
