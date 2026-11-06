# Dashboard IPC alimentación (España)

Dashboard del IPC de alimentación en España con datos del INE, desglosado por tipo de producto. Se actualiza solo cada mes con GitHub Actions.

## Cómo funciona

1. **Descarga:** `scripts/actualizar_datos.py` baja del INE el IPC general, el total de alimentación y bebidas, 10 tipos de producto y 55 productos concretos (tablas mensuales ECOICOP ver.2: 76125, 76126, 76127 y 76128), desde enero de 2010.
2. **Automatización:** `.github/workflows/actualizar-datos.yml` lo ejecuta cada día. Solo guarda cambios cuando el INE publica un mes nuevo (suele ser a mediados de mes).
3. **Datos:** se guardan en `data/ipc_alimentos.csv` (una fila por mes y categoría).
4. **Dashboard:** `index.html` + `assets/app.js` leen ese CSV y se publican con GitHub Pages. Incluye foto del mes, tasas por periodo (CAGR), evolución mensual o anual (variación, subida acumulada o índice con base a elegir) y descarga de la selección en Excel con formato RB.

## Lanzar una actualización a mano

Pestaña **Actions** → "Actualizar datos del INE" → **Run workflow**.
