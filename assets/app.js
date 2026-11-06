/* Dashboard IPC alimentación: lógica de datos, gráficos y exportación a Excel */
const COL = { acento: "#000082", grisOsc: "#787878", grisCl: "#C8C8C8", grisXcl: "#F0F0F0", negro: "#000000", gris3: "#A0A0A0", gris4: "#505050" };
const TOTAL = "Alimentación y bebidas", GENERAL = "IPC general";
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES_C = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
// Escala de la tabla de tasas (CAGR % anual): de claro a oscuro, colores del tema RB
const ESCALA = [
  { hasta: 0, fondo: "#F0F0F0", texto: "#000", eti: "≤ 0%" },
  { hasta: 2, fondo: "#FFFFFF", texto: "#000", eti: "0-2%" },
  { hasta: 4, fondo: "#B3E7FF", texto: "#000", eti: "2-4%" },
  { hasta: 6, fondo: "#77CDFF", texto: "#000", eti: "4-6%" },
  { hasta: Infinity, fondo: "#0096FF", texto: "#000", eti: "> 6%" }
];

const num = (v, d = 1) => v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = v => v === null || v === undefined || isNaN(v) ? "–" : (v > 0 ? "+" : "") + num(v) + "%";
const nombreMes = f => { const [a, m] = f.split("-"); return MESES[+m - 1] + " " + a; };
const mesCorto = f => { const [a, m] = f.split("-"); return MES_C[+m - 1] + " " + a.slice(2); };
const restarAnios = (f, n) => { const [a, m] = f.split("-"); return (+a - n) + "-" + m; };
const $ = id => document.getElementById(id);

Chart.defaults.font.family = '"RB Office", Arial, Helvetica, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.color = COL.negro;

// ---------- Datos ----------
const D = { serie: {}, meta: {}, clases: [], subs: {}, fechas: [], ultimo: null, info: {} };
const st = { mes: null, detalle: "", producto: null, medida: "var", frec: "m", base: null, desde: null, hasta: null };
let graficoBarras, graficoLineas;

function parseCSV(texto) {
  const filas = []; let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texto[i + 1] === "\n") i++; fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.length > 1);
}

function cargar(csv) {
  const [cab, ...filas] = parseCSV(csv);
  const k = Object.fromEntries(cab.map((c, i) => [c, i]));
  for (const f of filas) {
    const cat = f[k.categoria], fecha = f[k.fecha];
    const ind = f[k.indice], va = f[k.var_anual];
    (D.serie[cat] ??= {})[fecha] = { i: ind === "" ? null : +ind, v: va === "" ? null : +va };
    if (!D.meta[cat]) {
      const tipo = f[k.tipo], clase = k.clase !== undefined ? f[k.clase] : "";
      D.meta[cat] = { tipo, clase };
      if (tipo === "producto") D.clases.push(cat);
      if (tipo === "subclase") (D.subs[clase] ??= []).push(cat);
    }
  }
  D.fechas = Object.keys(D.serie[TOTAL]).filter(f => D.serie[TOTAL][f].v !== null).sort();
  D.ultimo = D.fechas.at(-1);
}

const val = (cat, f) => D.serie[cat]?.[f]?.v ?? null;
const ind = (cat, f) => D.serie[cat]?.[f]?.i ?? null;
const anios = () => [...new Set(D.fechas.map(f => +f.slice(0, 4)))];
const mesesDe = (anio, hastaMes = 12) => Array.from({ length: hastaMes }, (_, i) => anio + "-" + String(i + 1).padStart(2, "0"));
const ultimoMesDe = anio => +D.fechas.filter(f => f.startsWith(anio + "-")).at(-1).slice(5);

function mediaIndice(cat, anio, nMeses) {
  const vs = mesesDe(anio, nMeses).map(f => ind(cat, f));
  return vs.some(v => v === null) ? null : vs.reduce((a, b) => a + b, 0) / vs.length;
}
// Variación media anual: media del año (o de los meses disponibles) frente a los mismos meses del año anterior
function varMediaAnual(cat, anio) {
  const n = ultimoMesDe(anio), a = mediaIndice(cat, anio, n), b = mediaIndice(cat, anio - 1, n);
  return a && b ? (a / b - 1) * 100 : null;
}
const varDicDic = (cat, anio) => { const a = ind(cat, anio + "-12"), b = ind(cat, (anio - 1) + "-12"); return a && b ? (a / b - 1) * 100 : null; };
function cagrMeses(cat, fFin, n) {
  const a = ind(cat, fFin), b = ind(cat, restarAnios(fFin, n));
  return a && b ? (Math.pow(a / b, 1 / n) - 1) * 100 : null;
}
function cagrAnual(cat, a0, a1) {
  const a = mediaIndice(cat, a1, 12), b = mediaIndice(cat, a0, 12);
  return a && b ? (Math.pow(a / b, 1 / (a1 - a0)) - 1) * 100 : null;
}
function periodosTasas(fFin) {
  const a = +fFin.slice(0, 4), m = MES_C[+fFin.slice(5) - 1];
  const ps = [
    { eti: "Último año", f: c => cagrMeses(c, fFin, 1) },
    { eti: "3 años", f: c => cagrMeses(c, fFin, 3) },
    { eti: "5 años", f: c => cagrMeses(c, fFin, 5) },
    { eti: "10 años", f: c => cagrMeses(c, fFin, 10) },
    { eti: "Desde 2010", f: c => cagrMeses(c, fFin, a - 2010), ok: a > 2010 },
    { eti: "2010-2019", f: c => cagrAnual(c, 2010, 2019) },
    { eti: "Desde 2019", f: c => cagrMeses(c, fFin, a - 2019), ok: a > 2019 }
  ].filter(p => p.ok !== false);
  ps.forEach(p => p.detalle = p.eti === "2010-2019" ? "medias anuales" : m + " a " + m);
  return ps;
}
const nombreConClase = c => D.meta[c]?.tipo === "subclase" ? c + " (" + D.meta[c].clase + ")" : c;

// ---------- Arranque ----------
async function iniciar() {
  try {
    let csv, info;
    if (window.DATOS_EMBEBIDOS) ({ csv, info } = window.DATOS_EMBEBIDOS);
    else [csv, info] = await Promise.all([
      fetch("data/ipc_alimentos.csv", { cache: "no-store" }).then(r => { if (!r.ok) throw 0; return r.text(); }),
      fetch("data/ultima_actualizacion.json", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({}))
    ]);
    cargar(csv); D.info = info || {};
  } catch (e) {
    $("kpis").outerHTML = '<p class="error">Todavía no hay datos. Se cargarán en la primera ejecución automática.</p>';
    return;
  }
  if (D.info.descargado) $("act").textContent = "Actualizado el " + D.info.descargado.split("-").reverse().join("/");
  $("sub").textContent = "Variación de precios por tipo de producto · Enero 2010 a " + nombreMes(D.ultimo);
  montarControles();
}

function montarControles() {
  // Foto del mes
  $("mes").innerHTML = D.fechas.slice().reverse().map(f => `<option value="${f}">${nombreMes(f)}</option>`).join("");
  $("detalle").innerHTML = `<option value="">Todos los tipos de producto</option>` +
    D.clases.filter(c => D.subs[c]?.length).map(c => `<option value="${c}">${c}: productos concretos</option>`).join("");
  $("mes").onchange = () => { st.mes = $("mes").value; pintarFoto(); };
  $("detalle").onchange = () => { st.detalle = $("detalle").value; pintarFoto(); };

  // Evolución
  $("producto").innerHTML = `<optgroup label="Tipos de producto">${D.clases.map(c => `<option>${c}</option>`).join("")}</optgroup>` +
    D.clases.filter(c => D.subs[c]?.length).map(c => `<optgroup label="${c}">${D.subs[c].map(s => `<option value="${s}">${s}</option>`).join("")}</optgroup>`).join("");
  $("producto").onchange = () => elegir($("producto").value, false);
  const opc = D.fechas.map(f => `<option value="${f}">${mesCorto(f)}</option>`).join("");
  $("desde").innerHTML = opc; $("hasta").innerHTML = opc;
  $("desde").onchange = () => { st.desde = $("desde").value; if (st.desde > st.hasta) st.hasta = st.desde; activar("#presets", null); pintarEvolucion(); };
  $("hasta").onchange = () => { st.hasta = $("hasta").value; if (st.hasta < st.desde) st.desde = st.hasta; activar("#presets", null); pintarEvolucion(); };
  const completos = anios().filter(a => ultimoMesDe(a) === 12);
  $("base").innerHTML = completos.slice().reverse().map(a => `<option>${a}</option>`).join("");
  st.base = completos.includes(2019) ? 2019 : completos.at(-1); $("base").value = st.base;
  $("base").onchange = () => { st.base = +$("base").value; pintarEvolucion(); };
  document.querySelectorAll("#presets button").forEach(b => b.onclick = () => { aplicarPreset(+b.dataset.a); activar("#presets", b); pintarEvolucion(); });
  document.querySelectorAll("#medida button").forEach(b => b.onclick = () => { st.medida = b.dataset.m; activar("#medida", b); pintarEvolucion(); });
  document.querySelectorAll("#frecuencia button").forEach(b => b.onclick = () => { st.frec = b.dataset.f; activar("#frecuencia", b); pintarEvolucion(); });
  ["vsTotal", "vsGeneral", "vsClase"].forEach(id => $(id).onchange = pintarEvolucion);

  montarExcel();
  st.mes = D.ultimo; aplicarPreset(5);
  pintarFoto();
}
const activar = (sel, b) => document.querySelectorAll(sel + " button").forEach(x => x.classList.toggle("activo", x === b));
function aplicarPreset(n) {
  st.hasta = D.fechas.at(-1);
  st.desde = n ? (D.fechas.find(f => f >= restarAnios(st.hasta, n)) || D.fechas[0]) : D.fechas[0];
}
function elegir(c, desplazar = true) {
  st.producto = c; $("producto").value = c;
  pintarEvolucion();
  if (desplazar) $("evolucion").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- 1. Foto del mes ----------
function filasFoto() {
  const ref = st.detalle || TOTAL;
  const cats = st.detalle ? D.subs[st.detalle] : D.clases;
  return { ref, cats };
}
function pintarFoto() {
  const f = st.mes, vt = val(TOTAL, f), vg = val(GENERAL, f);
  const { ref, cats } = filasFoto(), vr = val(ref, f);
  $("t1").textContent = (st.detalle ? st.detalle + ": variación anual por producto, " : "Variación anual por tipo de producto, ") + nombreMes(f) + " [%]";
  $("ley-alto").textContent = st.detalle ? "Sube más que " + st.detalle.toLowerCase() + " en conjunto" : "Sube más que el total de alimentación";
  $("ley-ref").textContent = st.detalle ? st.detalle + " (total)" : "Total alimentación y bebidas";

  const lista = cats.map(c => ({ c, v: val(c, f) })).filter(o => o.v !== null).sort((a, b) => b.v - a.v);
  const kpi = (eti, v, det, ac) => `<div class="kpi"><div class="eti">${eti}</div><div class="val${ac ? " acento" : ""}">${v}</div><div class="det">${det}</div></div>`;
  const dif = vt !== null && vg !== null ? vt - vg : null;
  const prods = D.clases.map(c => ({ c, v: val(c, f) })).filter(o => o.v !== null).sort((a, b) => b.v - a.v);
  $("kpis").innerHTML =
    kpi("Alimentación y bebidas", fmtPct(vt), dif === null ? "" : Math.abs(dif) < 0.05 ? "En línea con el IPC general"
        : num(Math.abs(dif)) + " p.p. " + (dif > 0 ? "por encima" : "por debajo") + " del IPC general", true) +
    kpi("IPC general", fmtPct(vg), "Variación anual, " + nombreMes(f)) +
    kpi("Tipo de producto que más sube", prods.length ? fmtPct(prods[0].v) : "–", prods[0]?.c || "") +
    kpi("Tipo de producto que menos sube", prods.length ? fmtPct(prods.at(-1).v) : "–", prods.at(-1)?.c || "");

  const datos = (vr !== null ? [...lista, { c: ref, v: vr, ref: true }] : lista).sort((a, b) => b.v - a.v);
  const color = o => o.ref ? COL.grisOsc : (vr !== null && o.v > vr ? COL.acento : COL.grisCl);
  $("lienzo-barras").style.height = Math.max(300, datos.length * 34 + 60) + "px";
  if (graficoBarras) graficoBarras.destroy();
  graficoBarras = new Chart($("barras"), {
    type: "bar",
    data: { labels: datos.map(o => o.c), datasets: [{ data: datos.map(o => o.v), backgroundColor: datos.map(color),
            borderRadius: 3, barPercentage: 0.62, categoryPercentage: 0.9 }] },
    options: {
      indexAxis: "y", maintainAspectRatio: false, animation: { duration: 250 }, layout: { padding: { right: 60, left: 8 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtPct(c.raw) } } },
      scales: {
        x: { grid: { color: c => c.tick.value === 0 ? COL.negro : COL.grisXcl, lineWidth: c => c.tick.value === 0 ? 1 : .5 },
             border: { display: false }, ticks: { callback: v => v + "%", color: COL.grisOsc } },
        y: { grid: { display: false }, border: { display: false },
             ticks: { font: c => ({ weight: datos[c.index]?.ref ? "bold" : "normal" }) } }
      },
      onClick: (e, el) => { if (el.length) elegir(datos[el[0].index].c); },
      onHover: (e, el) => e.native.target.style.cursor = el.length ? "pointer" : "default"
    },
    plugins: [{ id: "etiquetas", afterDatasetsDraw(ch) {
      const { ctx } = ch; ctx.save(); ctx.font = "bold 12px " + Chart.defaults.font.family;
      ctx.fillStyle = COL.negro; ctx.textBaseline = "middle";
      ch.getDatasetMeta(0).data.forEach((b, i) => { const v = datos[i].v; ctx.textAlign = v >= 0 ? "left" : "right";
        ctx.fillText(fmtPct(v), b.x + (v >= 0 ? 6 : -6), b.y); });
      ctx.restore(); } }]
  });
  pintarTasas(datos.filter(o => !o.ref).map(o => o.c), ref);
  if (!st.producto) elegir(prods[0]?.c || D.clases[0], false);
}

// ---------- 2. Tasas por periodo ----------
function pintarTasas(cats, ref) {
  const ps = periodosTasas(st.mes);
  $("t-tasas").textContent = "Crecimiento medio anual de precios por periodo, hasta " + nombreMes(st.mes) + " [CAGR, %]";
  const refs = [...new Set([ref, TOTAL, GENERAL])];
  const celda = v => { if (v === null) return `<td class="celda">–</td>`;
    const e = ESCALA.find(x => v <= x.hasta); return `<td class="celda" style="background:${e.fondo};color:${e.texto}">${num(v)}</td>`; };
  const fila = (c, cls = "") => `<tr class="${cls}" data-c="${c}"><td>${c}</td>${ps.map(p => celda(p.f(c))).join("")}</tr>`;
  $("tabla-tasas").innerHTML =
    `<thead><tr><th>Producto</th>${ps.map(p => `<th>${p.eti}<br><span style="font-weight:normal;color:${COL.grisOsc}">${p.detalle}</span></th>`).join("")}</tr></thead>` +
    `<tbody>${cats.map(c => fila(c)).join("")}${refs.map((c, i) => fila(c, "ref" + (i === 0 ? " sep" : ""))).join("")}</tbody>`;
  document.querySelectorAll("#tabla-tasas tbody tr").forEach(tr => tr.onclick = () => {
    const c = tr.dataset.c; if (c !== GENERAL && c !== TOTAL) elegir(c); });
  $("ley-tasas").innerHTML = ESCALA.map(e => `<span><i style="background:${e.fondo};outline:.5px solid #C8C8C8"></i>${e.eti}</span>`).join("");
}

// ---------- 3. Evolución ----------
function serieEvolucion(cat, eje) {
  const anual = st.frec === "a", m = st.medida;
  if (anual) {
    const y0 = eje[0];
    return eje.map(a => {
      if (m === "var") return varMediaAnual(cat, a);
      const n = ultimoMesDe(a), x = mediaIndice(cat, a, n);
      if (m === "acum") { const b = mediaIndice(cat, y0, 12); return x && b ? (x / b - 1) * 100 : null; }
      const b = mediaIndice(cat, st.base, 12); return x && b ? x / b * 100 : null;
    });
  }
  if (m === "var") return eje.map(f => val(cat, f));
  if (m === "acum") { const b = eje.map(f => ind(cat, f)).find(v => v !== null);
    return eje.map(f => { const x = ind(cat, f); return x === null || !b ? null : (x / b - 1) * 100; }); }
  const b = mediaIndice(cat, st.base, 12);
  return eje.map(f => { const x = ind(cat, f); return x === null || !b ? null : x / b * 100; });
}

function pintarEvolucion() {
  $("desde").value = st.desde; $("hasta").value = st.hasta;
  $("base-wrap").hidden = st.medida !== "base";
  const anual = st.frec === "a", esSub = D.meta[st.producto]?.tipo === "subclase";
  $("vsClase-wrap").hidden = !esSub;
  if (esSub) $("vsClase-txt").textContent = D.meta[st.producto].clase;

  const meses = D.fechas.filter(f => f >= st.desde && f <= st.hasta);
  let eje = meses, etiquetas = meses.map(mesCorto), titulos = meses.map(nombreMes);
  const ultAnio = +D.ultimo.slice(0, 4), parcial = ultimoMesDe(ultAnio) < 12;
  if (anual) {
    eje = [...new Set(meses.map(f => +f.slice(0, 4)))];
    if (st.medida === "var") eje = eje.filter(a => a > 2010);
    if (st.medida === "acum" && eje.length && ultimoMesDe(eje[0]) < 12) eje = eje.slice(1);
    etiquetas = eje.map(a => a === ultAnio && parcial ? a + "*" : String(a));
    titulos = eje.map(a => a === ultAnio && parcial ? a + " (ene-" + MES_C[ultimoMesDe(a) - 1] + ")" : String(a));
  }
  $("nota-anual").hidden = !(anual && parcial && eje.includes(ultAnio));
  $("nota-anual").textContent = "* " + ultAnio + ": media de enero a " + MESES[ultimoMesDe(ultAnio) - 1] +
    (st.medida === "var" ? ", comparada con los mismos meses de " + (ultAnio - 1) + "." : ".");

  const series = [{ label: st.producto, cat: st.producto, color: COL.acento, ancho: 2.5 }];
  if (esSub && $("vsClase").checked) series.push({ label: D.meta[st.producto].clase + " (total)", cat: D.meta[st.producto].clase, color: COL.gris4, ancho: 1.5 });
  if ($("vsTotal").checked) series.push({ label: "Total alimentación y bebidas", cat: TOTAL, color: COL.grisOsc, ancho: 1.5 });
  if ($("vsGeneral").checked) series.push({ label: GENERAL, cat: GENERAL, color: COL.gris3, ancho: 1.5, punteado: true });
  series.forEach(s => s.datos = serieEvolucion(s.cat, eje));

  const pct = st.medida !== "base", fmtV = v => v === null ? "–" : pct ? fmtPct(v) : num(v);
  const desdeTxt = anual ? String(eje[0]) : nombreMes(meses[0]);
  $("t2").textContent = {
    var: anual ? "Variación media anual de precios [%]" : "Variación anual de precios, mes a mes [%]",
    acum: "Subida acumulada de precios desde " + desdeTxt + " [%]",
    base: "Índice de precios [" + st.base + " = 100]"
  }[st.medida];
  $("ley2").innerHTML = series.map(s => `<span><i class="linea" style="${s.punteado ? "background:repeating-linear-gradient(90deg," + s.color + " 0 3px,transparent 3px 5px)" : "background:" + s.color}"></i>${s.label}</span>`).join("");

  // Frase resumen
  const d = series[0].datos, fin = [...d].reverse().find(v => v !== null), ini = d.find(v => v !== null);
  const finTxt = anual ? titulos.at(-1) : nombreMes(meses.at(-1));
  const refS = series.find(s => s.cat === TOTAL), refFin = refS ? [...refS.datos].reverse().find(v => v !== null) : null;
  let r = "";
  if (fin !== undefined) {
    if (st.medida === "acum") r = `<b>${st.producto}</b>: los precios suben un <b>${num(fin)}%</b> entre ${desdeTxt} y ${finTxt}` + (refFin != null ? `, frente al ${num(refFin)}% del total de alimentación.` : ".");
    else if (st.medida === "base") r = `<b>${st.producto}</b>: índice de <b>${num(fin)}</b> en ${finTxt} (${st.base} = 100), es decir, los precios están un ${num(Math.abs(fin - 100))}% ${fin >= 100 ? "por encima" : "por debajo"} de ${st.base}.`;
    else { const vs = d.filter(v => v !== null), mx = Math.max(...vs), mn = Math.min(...vs);
      r = `<b>${st.producto}</b>: ${fmtPct(fin)} en ${finTxt}. En el periodo, máximo de ${fmtPct(mx)} (${titulos[d.indexOf(mx)]}) y mínimo de ${fmtPct(mn)} (${titulos[d.indexOf(mn)]}).`; }
  }
  $("resumen").innerHTML = r;

  if (graficoLineas) graficoLineas.destroy();
  graficoLineas = new Chart($("lineas"), {
    type: "line",
    data: { labels: etiquetas, datasets: series.map(s => ({ label: s.label, data: s.datos, borderColor: s.color, backgroundColor: s.color,
            borderWidth: s.ancho, borderDash: s.punteado ? [3, 2] : [], pointRadius: anual ? 3 : 0, pointHoverRadius: 5,
            pointBorderColor: "#fff", pointBorderWidth: anual ? 1 : 0, tension: 0, spanGaps: true })) },
    options: {
      maintainAspectRatio: false, animation: { duration: 250 }, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false },
                 tooltip: { callbacks: { title: i => titulos[i[0].dataIndex], label: c => c.dataset.label + ": " + fmtV(c.raw) } } },
      scales: {
        x: { grid: { display: false }, border: { color: COL.negro, width: .5 },
             ticks: { color: COL.grisOsc, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
        y: { grid: { color: c => c.tick.value === (pct ? 0 : 100) ? COL.negro : COL.grisXcl, lineWidth: c => c.tick.value === (pct ? 0 : 100) ? 1 : .5 },
             border: { display: false }, ticks: { color: COL.grisOsc, callback: v => pct ? v + "%" : v } }
      }
    }
  });
  resumenExcel();
}

// ---------- 4. Excel ----------
function montarExcel() {
  $("lista").innerHTML = D.clases.map(c => `
    <div class="clase">
      <label class="check"><input type="checkbox" data-cat="${c}" checked> <b>${c}</b></label>
      ${D.subs[c]?.length ? `<details><summary>${D.subs[c].length} productos concretos</summary>
        ${D.subs[c].map(s => `<label><input type="checkbox" data-cat="${s}"> ${s}</label>`).join("")}</details>` : ""}
    </div>`).join("");
  $("lista").onchange = resumenExcel;
  document.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => {
    document.querySelectorAll("#lista input").forEach(i => {
      const sub = D.meta[i.dataset.cat].tipo === "subclase";
      i.checked = b.dataset.sel === "todo" || (b.dataset.sel === "clases" && !sub); });
    resumenExcel(); });
  $("btn-excel").onclick = descargarExcel;
}
const seleccionExcel = () => [...document.querySelectorAll("#lista input:checked")].map(i => i.dataset.cat);
function resumenExcel() {
  if (!st.desde) return;
  const n = seleccionExcel().length;
  $("excel-resumen").innerHTML = [
    `<b style="color:#000">${n}</b> productos + IPC general y total alimentación`,
    `Periodo: ${nombreMes(st.desde)} a ${nombreMes(st.hasta)}`,
    `Hojas: variación anual mensual, índice mensual (base ${st.base} = 100), datos anuales, diferencial vs. IPC general, tasas por periodo y notas`
  ].map(t => `<li>${t}</li>`).join("");
  $("btn-excel").disabled = n === 0;
}

async function descargarExcel() {
  if (!window.ExcelJS) { alert("Cargando el generador de Excel, inténtalo en unos segundos."); return; }
  const boton = $("btn-excel"); boton.disabled = true; boton.textContent = "Generando…";
  try {
    const cats = [...seleccionExcel(), TOTAL, GENERAL];
    const meses = D.fechas.filter(f => f >= st.desde && f <= st.hasta);
    const aniosSel = [...new Set(meses.map(f => +f.slice(0, 4)))];
    const ultAnio = +D.ultimo.slice(0, 4), parcial = ultimoMesDe(ultAnio) < 12;
    const etiAnio = a => a === ultAnio && parcial ? a + " (ene-" + MES_C[ultimoMesDe(a) - 1] + ")" : String(a);
    const periodoTxt = nombreMes(st.desde) + " a " + nombreMes(st.hasta);
    const fecha = f => new Date(Date.UTC(+f.slice(0, 4), +f.slice(5) - 1, 1));

    const wb = new ExcelJS.Workbook(); wb.creator = "Dashboard IPC alimentación"; wb.created = new Date();
    const F = (o = {}) => ({ name: "RB Office", size: 10, color: { argb: "FF000000" }, ...o });
    const GRIS = "FF787878";
    const hoja = (nombre, titulo, subtitulo, anchoPrimera = 12) => {
      const ws = wb.addWorksheet(nombre, { views: [{ showGridLines: false }] });
      ws.getColumn(1).width = anchoPrimera;
      ws.getCell("A1").value = titulo; ws.getCell("A1").font = F({ size: 14, bold: true });
      ws.getCell("A2").value = subtitulo; ws.getCell("A2").font = F({ color: { argb: GRIS } });
      return ws;
    };
    // Escribe una tabla con cabecera en la fila r; devuelve la fila siguiente libre
    const tabla = (ws, r, cabecera, filas, formato = "0.0", c0 = 1) => {
      const cab = ws.getRow(r);
      cabecera.forEach((t, i) => { const c = cab.getCell(c0 + i); c.value = t;
        c.font = F({ bold: true }); c.alignment = { wrapText: true, vertical: "bottom", horizontal: i ? "right" : "left" };
        c.border = { top: { style: "medium", color: { argb: GRIS } }, bottom: { style: "thin", color: { argb: GRIS } } }; });
      cab.height = 66;
      filas.forEach((fila, j) => {
        const row = ws.getRow(r + 1 + j);
        fila.forEach((v, i) => { if (typeof v === "number") v = Math.round(v * 1000) / 1000; const c = row.getCell(c0 + i); c.value = v === null || v === undefined || (typeof v === "number" && isNaN(v)) ? null : v;
          c.font = F(); if (i && typeof v === "number") c.numFmt = formato;
          if (i === 0) c.alignment = { horizontal: "left" };
          if (v instanceof Date) c.numFmt = "mmm-yy";
          if (j === filas.length - 1) c.border = { bottom: { style: "thin", color: { argb: GRIS } } }; });
      });
      return r + filas.length + 1;
    };
    const fuente = (ws, r, extra = "") => { const c = ws.getCell("A" + (r + 1));
      c.value = (extra ? extra + "; " : "") + "Source: INE (IPC, ECOICOP ver.2), RB analysis"; c.font = F({ size: 8, color: { argb: GRIS } }); };
    const anchos = (ws, n, w = 15) => { for (let i = 2; i <= n + 1; i++) ws.getColumn(i).width = w; };
    const cabCats = cats.map(nombreConClase);

    // 1. Variación anual mensual
    let ws = hoja("Var. anual mensual", "Variación anual de precios, mensual", "Variación respecto al mismo mes del año anterior [%], " + periodoTxt);
    let r = tabla(ws, 4, ["Mes", ...cabCats], meses.map(f => [fecha(f), ...cats.map(c => val(c, f))]));
    fuente(ws, r); anchos(ws, cats.length); ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }];

    // 2. Índice mensual
    const baseM = Object.fromEntries(cats.map(c => [c, mediaIndice(c, st.base, 12)]));
    ws = hoja("Índice mensual", "Índice de precios, mensual", `Índice [media ${st.base} = 100], ` + periodoTxt);
    r = tabla(ws, 4, ["Mes", ...cabCats], meses.map(f => [fecha(f), ...cats.map(c => { const x = ind(c, f); return x && baseM[c] ? x / baseM[c] * 100 : null; })]));
    fuente(ws, r, `1) Índice reescalado por RB a media ${st.base} = 100 a partir del índice publicado por el INE`);
    anchos(ws, cats.length); ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }];

    // 3. Datos anuales: tres tablas apiladas
    ws = hoja("Anual", "Datos anuales", "Años completos o parciales dentro del periodo seleccionado; " + periodoTxt, 16);
    const bloque = (r0, titulo, fn) => { ws.getCell("A" + r0).value = titulo; ws.getCell("A" + r0).font = F({ size: 12, bold: true });
      return tabla(ws, r0 + 1, ["Año", ...cabCats], aniosSel.map(a => [etiAnio(a), ...cats.map(c => fn(c, a))])) + 2; };
    r = bloque(4, "Variación media anual [%]", (c, a) => a > 2010 ? varMediaAnual(c, a) : null);
    r = bloque(r, "Variación diciembre sobre diciembre [%]", (c, a) => a > 2010 ? varDicDic(c, a) : null);
    r = bloque(r, `Índice medio anual [media ${st.base} = 100]`, (c, a) => { const x = mediaIndice(c, a, ultimoMesDe(a)); return x && baseM[c] ? x / baseM[c] * 100 : null; });
    fuente(ws, r - 2, parcial ? `1) ${ultAnio}: media de enero a ${MESES[ultimoMesDe(ultAnio) - 1]}, comparada con los mismos meses de ${ultAnio - 1}` : "");
    anchos(ws, cats.length);

    // 4. Diferencial vs IPC general y vs total alimentación
    const prods = cats.filter(c => c !== GENERAL && c !== TOTAL);
    ws = hoja("Diferencial", "Diferencial de variación anual frente al IPC general y al total de alimentación",
              "Variación anual del producto menos la de la referencia [p.p.], " + periodoTxt);
    const vsG = [TOTAL, ...prods], ncG = vsG.length;
    ws.getCell("B4").value = "vs. IPC general [p.p.]"; ws.getCell("B4").font = F({ bold: true });
    ws.getCell(4, ncG + 3).value = "vs. total alimentación [p.p.]"; ws.getCell(4, ncG + 3).font = F({ bold: true });
    r = tabla(ws, 5, ["Mes", ...vsG.map(nombreConClase)], meses.map(f => [fecha(f), ...vsG.map(c => { const a = val(c, f), b = val(GENERAL, f); return a !== null && b !== null ? a - b : null; })]));
    tabla(ws, 5, prods.map(nombreConClase), meses.map(f => prods.map(c => { const a = val(c, f), b = val(TOTAL, f); return a !== null && b !== null ? a - b : null; })), "0.0", ncG + 3);
    // la tabla de la derecha no tiene columna de fechas: su primera celda de cada fila es numérica
    meses.forEach((f, j) => { const c = ws.getRow(6 + j).getCell(ncG + 3); if (typeof c.value === "number") c.numFmt = "0.0"; c.alignment = { horizontal: "right" }; });
    ws.getRow(5).getCell(ncG + 3).alignment = { wrapText: true, vertical: "bottom", horizontal: "right" };
    fuente(ws, r); for (let i = 2; i <= ncG + prods.length + 3; i++) ws.getColumn(i).width = 13; ws.getColumn(ncG + 2).width = 3;
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }];

    // 5. Tasas por periodo (hasta el final del periodo seleccionado)
    const ps = periodosTasas(st.hasta);
    ws = hoja("Tasas por periodo", "Crecimiento medio anual de precios por periodo", "CAGR [%], hasta " + nombreMes(st.hasta), 34);
    r = tabla(ws, 4, ["Producto", ...ps.map(p => p.eti + " (" + p.detalle + ")")], cats.map(c => [nombreConClase(c), ...ps.map(p => p.f(c))]));
    fuente(ws, r, "1) CAGR entre el mismo mes de cada año; 2010-2019 compara medias anuales");
    anchos(ws, ps.length, 15);

    // 6. Notas
    ws = hoja("Notas", "Notas y definiciones", "Dashboard IPC de alimentación en España", 30);
    const notas = [
      ["Fuente", "INE, Índice de Precios de Consumo (IPC), índices nacionales mensuales, clasificación ECOICOP ver.2"],
      ["Periodo exportado", periodoTxt],
      ["Último dato disponible", nombreMes(D.ultimo)],
      ["Datos descargados del INE", D.info.descargado || "–"],
      ["Variación anual", "Variación del índice respecto al mismo mes del año anterior, publicada por el INE"],
      ["Variación media anual", "Media del índice del año frente a la media del año anterior (mismos meses si el año está incompleto)"],
      ["Variación dic/dic", "Índice de diciembre frente al de diciembre del año anterior"],
      ["Índice base", `Índice del INE reescalado a media ${st.base} = 100 para cada producto`],
      ["Diferencial [p.p.]", "Variación anual del producto menos la variación anual de la referencia"],
      ["CAGR", "Tasa de crecimiento anual compuesta del índice entre dos fechas"],
      ["Tipos de producto", "Clases ECOICOP; los productos concretos (subclases) llevan entre paréntesis su tipo de producto"]
    ];
    notas.forEach((n, i) => { const row = ws.getRow(4 + i); row.getCell(1).value = n[0]; row.getCell(1).font = F({ bold: true });
      row.getCell(2).value = n[1]; row.getCell(2).font = F(); row.getCell(2).alignment = { wrapText: true, vertical: "top" }; });
    ws.getColumn(2).width = 100;

    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `IPC_alimentacion_${st.desde}_a_${st.hasta}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { console.error(e); alert("No se ha podido generar el Excel: " + e.message); }
  boton.disabled = false; boton.textContent = "Descargar Excel";
}

iniciar();
