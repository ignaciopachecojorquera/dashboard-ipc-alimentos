"""Descarga del INE el IPC de alimentación por tipo de producto y lo guarda en data/.

Fuente: API JSON del INE (servicios.ine.es/wstempus), tablas mensuales ECOICOP ver.2:
  - 76125  Índices nacionales: general y de grupos
  - 76126  Índices nacionales de subgrupos
  - 76127  Índices nacionales de clases       (tipos de producto)
  - 76128  Índices nacionales de subclases    (productos concretos)

Salida:
  data/ipc_alimentos.csv          una fila por mes y categoría (índice y variación anual)
  data/ultima_actualizacion.json  último mes disponible y fecha de la descarga
"""

import csv
import io
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/{tabla}?nult={n}"
MESES = 360        # pedimos de sobra y luego recortamos
DESDE = "2010-01"  # primer mes que se guarda

# Referencias: (tabla, nombre en el INE, nombre en el dashboard, tipo)
REFERENCIAS = [
    (76125, "Índice general", "IPC general", "referencia"),
    (76125, "Alimentos y bebidas no alcohólicas", "Alimentación y bebidas", "total"),
]

# Tipos de producto (clases) y sus productos concretos (subclases).
# Formato: (tabla, nombre INE de la clase, nombre corto, [(nombre INE subclase, nombre corto), ...])
PRODUCTOS = [
    (76127, "Cereales y productos a base de cereales", "Pan y cereales", [
        ("Cereales", "Cereales (arroz y otros)"),
        ("Harina de cereales", "Harina"),
        ("Pan y productos de panadería", "Pan y panadería"),
        ("Cereales de desayuno", "Cereales de desayuno"),
        ("Macarrones, tallarines, cuscús y pastas alimenticias similares", "Pasta"),
        ("Otros productos a base de cereales y de grano molidos", "Otros productos de cereales"),
    ]),
    (76127, "Carne", "Carne", [
        ("Carne, fresca, refrigerada o congelada", "Carne fresca o congelada"),
        ("Carne, seca, salada, en salmuera o ahumada", "Carne curada y embutidos"),
        ("Despojos comestibles", "Despojos"),
        ("Preparados de carne y despojos", "Preparados de carne"),
    ]),
    (76127, "Pescado y marisco", "Pescado y marisco", [
        ("Pescado, fresco, refrigerado o congelado", "Pescado fresco o congelado"),
        ("Pescado, seco, salado, en salmuera o ahumado", "Pescado seco, salado o ahumado"),
        ("Preparados de pescado", "Preparados de pescado"),
        ("Marisco, vivo, fresco, refrigerado o congelado", "Marisco fresco o congelado"),
        ("Preparados de marisco", "Preparados de marisco"),
    ]),
    (76127, "Leche, otros productos lácteos y huevos", "Lácteos y huevos", [
        ("Leche entera", "Leche entera"),
        ("Leche desnatada y semidesnatada", "Leche desnatada y semi"),
        ("Otra leche y nata", "Otra leche y nata"),
        ("Bebida vegetal", "Bebida vegetal"),
        ("Queso", "Queso"),
        ("Yogur y productos similares", "Yogur"),
        ("Postres y bebidas a base de leche", "Postres lácteos"),
        ("Huevos", "Huevos"),
    ]),
    (76127, "Aceites y grasas", "Aceites y grasas", [
        ("Aceites vegetales", "Aceites vegetales (incl. oliva)"),
        ("Mantequilla y otros aceites y grasas derivados de la leche", "Mantequilla"),
    ]),
    (76127, "Frutas y frutos de cáscara", "Frutas", [
        ("Frutas tropicales, dátiles e higos", "Frutas tropicales"),
        ("Cítricos frescos", "Cítricos"),
        ("Frutas de hueso y frutas de pepita, frescas", "Fruta de hueso y pepita"),
        ("Bayas frescas", "Bayas"),
        ("Otras frutas frescas", "Otras frutas frescas"),
        ("Frutos secos naturales, con o sin cáscara", "Frutos secos"),
        ("Frutas y frutos secos procesados (en conserva, tostados, molidos, etc.)", "Fruta y frutos secos procesados"),
    ]),
    (76127, "Hortalizas, legumbres y patatas", "Hortalizas y legumbres", [
        ("Hortalizas de hoja o de tallo, frescas o refrigeradas", "Hortalizas de hoja o tallo"),
        ("Hortalizas cultivadas por su fruto, frescas o refrigeradas", "Hortalizas de fruto"),
        ("Legumbres verdes, frescas o refrigeradas", "Legumbres verdes"),
        ("Otras hortalizas, frescas o refrigeradas", "Otras hortalizas frescas"),
        ("Patatas y otros tubérculos", "Patatas"),
        ("Legumbres secas", "Legumbres secas"),
        ("Hortalizas y tubérculos, congelados", "Hortalizas congeladas"),
        ("Hortalizas, tubérculos y legumbres, molidos y en otras preparaciones", "Hortalizas en conserva y preparadas"),
    ]),
    (76127, "Azúcar, confitería y postres", "Azúcar y dulces", [
        ("Azúcar de caña y azúcar de remolacha", "Azúcar"),
        ("Confituras, mermeladas, jaleas, purés y pastas de frutas, y miel", "Mermeladas y miel"),
        ("Chocolate, cacao y productos alimenticios a base de cacao", "Chocolate y cacao"),
        ("Hielo, helados y sorbetes", "Helados"),
        ("Otros productos de confitería y postres n.c.o.p.", "Otra confitería y postres"),
    ]),
    (76127, "Alimentos preparados y otros productos alimenticios", "Preparados y otros", [
        ("Alimentos preparados", "Platos preparados"),
        ("Alimentos para bebé", "Alimentación infantil"),
        ("Sal, condimentos y salsas", "Sal, condimentos y salsas"),
        ("Especias, hierbas culinarias y semillas", "Especias"),
        ("Otros productos alimenticios n.c.o.p.", "Otros productos alimenticios"),
    ]),
    (76126, "Bebidas no alcohólicas", "Bebidas no alcohólicas", [
        ("Zumos de frutas y hortalizas", "Zumos"),
        ("Café y sucedáneos de café", "Café"),
        ("Té y otros productos vegetales para infusiones", "Té e infusiones"),
        ("Agua", "Agua"),
        ("Refrescos", "Refrescos"),
        ("Otras bebidas no alcohólicas", "Otras bebidas no alcohólicas"),
    ]),
]
TABLA_SUBCLASES = 76128

# (tabla, nombre INE, nombre corto, tipo, clase a la que pertenece)
SERIES = [(t, n, c, tipo, "") for t, n, c, tipo in REFERENCIAS]
for t, n, c, subs in PRODUCTOS:
    SERIES.append((t, n, c, "producto", ""))
    SERIES += [(TABLA_SUBCLASES, sn, sc, "subclase", c) for sn, sc in subs]

TIPOS = {"Índice": "indice", "Variación anual": "var_anual"}
TODOS_TIPOS = ["Variación en lo que va de año", "Variación mensual", "Variación anual", "Índice"]

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
CAMPOS = ["fecha", "categoria", "tipo", "clase", "indice", "var_anual"]


def descargar(tabla):
    url = API.format(tabla=tabla, n=MESES)
    for intento in range(1, 4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dashboard-ipc-alimentos"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # la API del INE a veces va lenta: reintentar
            print(f"Tabla {tabla}, intento {intento} fallido: {e}")
            time.sleep(10 * intento)
    raise RuntimeError(f"No se pudo descargar la tabla {tabla}")


def limpiar(texto):
    # normaliza espacios (el INE a veces deja dobles espacios) y puntos finales
    return " ".join(texto.split()).rstrip(".").strip()


def partes(nombre):
    """'Nacional. Carne. Variación anual. ' -> ('Carne', 'Variación anual')"""
    texto = nombre.strip()
    if not texto.startswith("Nacional. "):
        return None, None
    texto = limpiar(texto[len("Nacional. "):])
    for tipo in TODOS_TIPOS:
        if texto.endswith(tipo):
            return limpiar(texto[: -len(tipo)]), tipo
    return None, None


def main():
    tablas = {t: descargar(t) for t in sorted({s[0] for s in SERIES})}
    filas = {}
    faltan = []

    for tabla, nombre_ine, nombre, tipo, clase in SERIES:
        encontradas = 0
        for serie in tablas[tabla]:
            cat, dato = partes(serie.get("Nombre", ""))
            if cat != limpiar(nombre_ine) or dato not in TIPOS:
                continue
            encontradas += 1
            for d in serie.get("Data", []):
                if d.get("Valor") is None:
                    continue
                fecha = f"{d['Anyo']}-{int(d['FK_Periodo']):02d}"
                if fecha < DESDE:
                    continue
                fila = filas.setdefault((fecha, nombre), {
                    "fecha": fecha, "categoria": nombre, "tipo": tipo, "clase": clase,
                    "indice": "", "var_anual": ""})
                fila[TIPOS[dato]] = round(float(d["Valor"]), 3)
        if encontradas == 0:
            faltan.append(f"{nombre_ine} (tabla {tabla})")

    if faltan:
        print("No se han encontrado estas series en el INE:\n  " + "\n  ".join(faltan))
    if not any(f["tipo"] == "total" for f in filas.values()):
        sys.exit("No se ha descargado el total de alimentación: no se actualiza nada.")

    DATA.mkdir(exist_ok=True)
    orden = {s[2]: i for i, s in enumerate(SERIES)}
    salida = sorted(filas.values(), key=lambda f: (f["fecha"], orden[f["categoria"]]))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CAMPOS, lineterminator="\n")
    w.writeheader()
    w.writerows(salida)
    nuevo = buf.getvalue()

    csv_path = DATA / "ipc_alimentos.csv"
    antes = csv_path.read_text(encoding="utf-8") if csv_path.exists() else ""
    csv_path.write_text(nuevo, encoding="utf-8")

    # Último mes con desglose por producto (el INE adelanta solo el IPC general a final de mes)
    ultimo = max(f["fecha"] for f in salida if f["tipo"] == "total")
    info_path = DATA / "ultima_actualizacion.json"
    anterior = json.loads(info_path.read_text()) if info_path.exists() else {}
    info = {
        "ultimo_mes": ultimo,
        "descargado": datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if nuevo != antes or not anterior else anterior.get("descargado"),
        "series_no_encontradas": faltan,
    }
    info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n")
    print(f"OK: {len(salida)} filas, último mes {ultimo}, {len(faltan)} series no encontradas")


if __name__ == "__main__":
    main()
