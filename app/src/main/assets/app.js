(() => {
"use strict";
const A = window.Android;
const $ = id => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
const pad = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => isoOf(new Date());
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const num = v => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; };
const money = n => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n, d = 0) => (n || 0).toLocaleString("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const coordStr = (lat, lon) => (typeof lat === "number" && typeof lon === "number") ? lat.toFixed(6) + ", " + lon.toFixed(6) : "";
const parseCoords = s => { const m = String(s || "").match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/); if (!m) return null; const lat = +m[1], lon = +m[2]; return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null; };
const fechaLarga = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }); };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const has = v => v !== undefined && v !== null && String(v).trim() !== "";
const isNum = v => num(v) !== null;
const metersBetween = (a, b) => { const r = 6371000, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2; return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };

if (!A) { document.body.innerHTML = "<p style='padding:20px;color:#fff'>Abre esta pantalla desde la app Bitácora Flotilla en Android.</p>"; return; }

// ---------- puente con Android ----------
let cbSeq = 1; const cbs = {};
window.__cb = (id, s) => { const f = cbs[id]; delete cbs[id]; if (f) f(JSON.parse(s)); };
const nat = (fn, ...args) => new Promise(res => { const id = cbSeq++; cbs[id] = res; A[fn](id, ...args); });
const call = async (action, payload) => {
  payload = payload || {};
  if (action === "save" && payload.entry && !payload.keepCarga) payload.entry = stripCarga(payload.entry);
  delete payload.keepCarga;
  const r = await nat("call", action, JSON.stringify(payload));
  if (!r.ok && /Acci[oó]n desconocida/.test(r.error || "")) r.error = "El servicio de Google es de una versión anterior. Actualízalo (Extensiones → Apps Script → pega el nuevo Code.gs → Implementar → Nueva versión).";
  return r;
};

// ---------- estado ----------
const DKEY = "bitacora-dia-v1";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let cfg = JSON.parse(A.config());
let sheet = { rows: [], header: {}, firstFree: null, lastKm: null, loaded: false };
const FIELDS = ["fTras", "kmIni", "kmFin", "asunto", "de", "deC", "a", "aC"];
const CARGAF = ["fCarga", "importe", "litros", "ticket", "factura"];
const ROWF = FIELDS.concat(CARGAF);
const ADJ = "AJUSTE DE ODÓMETRO · recorrido sin registro";

function freshDay() { return { date: today(), stage: "idle", row: null, entry: { fTras: today() }, photos: {}, cargaSaved: false, tramoStart: 0, stopsDone: {}, done: [], gapOff: false }; }
let day = load(DKEY, null);
if (!day || (day.date !== today() && day.stage !== "running")) day = freshDay();
day.stopsDone = day.stopsDone || {}; day.done = day.done || [];
// desde la 2.1 la carga va aparte: los registros del recorrido no tocan las columnas A–E
const stripCarga = e => { const o = Object.assign({}, e || {}); CARGAF.forEach(k => delete o[k]); return o; };
day.entry = stripCarga(day.entry); day.done.forEach(d => { if (d.entry) d.entry = stripCarga(d.entry); });
const RGKEY = "bitacora-gps-filas";
const rowGps = load(RGKEY, {});
const tramoKm = () => { try { return A.trackKm(day.date, day.tramoStart || 0, 0); } catch (e) { return null; } };
const persist = () => {
  save(DKEY, day);
  A.setDay(JSON.stringify({ date: day.date, started: day.stage === "running" || day.stage === "closed", ended: day.stage === "closed", rest: day.stage === "rest" }));
};

// ---------- domicilio ----------
const home = () => cfg.home && typeof cfg.home.lat === "number" ? cfg.home : null;
const homeLabel = () => "Domicilio particular" + (home() && home().address ? " · " + home().address : "");
const homeCoords = () => home() ? coordStr(home().lat, home().lon) : "";
const isHomeText = s => /^Domicilio particular/i.test(String(s || ""));
const nearHome = (lat, lon) => home() && typeof lat === "number" ? metersBetween(home(), { lat, lon }) <= (cfg.stopRadius || 150) : false;
const lastKnownKm = () => sheet.lastKm !== null && sheet.lastKm !== undefined ? sheet.lastKm : (cfg.lastKm >= 0 ? cfg.lastKm : null);

// ---------- avisos en pantalla ----------
function banner(kind, title, text, actions, id) {
  const box = $("banners");
  if (id) { const old = box.querySelector('[data-id="' + id + '"]'); if (old) old.remove(); }
  const b = el("div", "banner " + kind); if (id) b.dataset.id = id;
  if (title) b.appendChild(el("b", "", title));
  if (text) b.appendChild(el("div", "", text));
  const row = el("div", "actions");
  (actions || []).forEach(a => { const x = el("button", "small " + (a.cls || "ghost"), a.label); x.onclick = () => { a.run && a.run(); if (!a.keep) b.remove(); }; row.appendChild(x); });
  if (!actions || !actions.length) { const x = el("button", "small ghost", "Entendido"); x.onclick = () => b.remove(); row.appendChild(x); }
  b.appendChild(row);
  box.prepend(b);
  window.scrollTo({ top: 0, behavior: "smooth" });
  return b;
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(.4, ctx.currentTime + t + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + t + .25);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .3); });
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  } catch (e) {}
}

window.onNative = (type, s) => {
  const d = JSON.parse(s);
  if (type === "alert" && d.kind !== "test") { beep(); showAlert(d.kind, d.title, d.text); }
  if (type === "openAlert") { if (d.kind === "stop" || d.kind === "home") { renderTrack(); setTimeout(autoRegisterPending, 300); } else showAlert(d.kind); }
  if (type === "departed") { cfg = JSON.parse(A.config()); startFromDeparture(d.t); }
  if (type === "track" || type === "stopClosed") renderTrack();
  if (type === "resume") { cfg = JSON.parse(A.config()); renderPerms(); checkDeparture(); renderTrack(); checkReminders(); setTimeout(autoRegisterPending, 500); }
  if (type === "perms") { cfg.perms = d; renderPerms(); }
};
function showAlert(kind, title, text) {
  if ($("tab-hoy").hidden && kind !== "test") showTab("hoy");
  if (kind === "start") banner("alert", title || "Registra el inicio de jornada", text || "Toma la foto del odómetro al salir.", [{ label: "Ir al arranque", cls: "primary", run: () => $("stepStart").scrollIntoView() }], "a-start");
  else if (kind === "end") banner("alert", title || "Registra el fin de jornada", text || "Toma la foto del odómetro al llegar.", [{ label: "Ir al cierre", cls: "primary", run: goEnd }], "a-end");
  else if (kind === "stop") { banner("alert", title || "Parada detectada", text || "Se agregó un registro.", [{ label: "Ver parada", cls: "primary", run: autoRegisterPending }], "a-stop"); setTimeout(autoRegisterPending, 300); }
  else if (kind === "home") { banner("alert", title || "Llegaste al domicilio", text || "Cierra la jornada con la foto del odómetro.", [{ label: "Cerrar jornada", cls: "primary", run: goEnd }], "a-home"); setTimeout(autoRegisterPending, 300); }
  else if (kind === "departed") { checkDeparture(); }
  else if (kind === "resume") banner("bad", "La grabación del recorrido se detuvo", "Toca Reanudar para seguir grabando.", [{ label: "Reanudar", cls: "primary", run: startTracking }], "a-resume");
}
function goEnd() { showTab("hoy"); setTimeout(() => $("endBox").scrollIntoView({ behavior: "smooth" }), 100); }
window.onBack = () => { if (!$("modal").hidden) { closeModal(); return true; } return false; };

// ---------- lectura de fotos (texto reconocido en el teléfono) ----------
// El reconocimiento se hace en varias versiones de la foto (v): original, alto contraste, invertida y centro ampliado.
// En pantallas de 7 segmentos se confunden letras con dígitos: O→0, I/l→1, S→5, B→8, Z→2, G/b→6, g/q→9.
const CONF = { O: "0", o: "0", Q: "0", D: "0", U: "0", I: "1", l: "1", "|": "1", "!": "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6", b: "6", g: "9", q: "9", T: "7" };
function fixDigits(tok) {
  const t = tok.replace(/[^0-9A-Za-z|!]/g, "");
  if (t.length < 3 || t.length > 8) return tok;
  const real = (t.match(/\d/g) || []).length, conf = t.split("").filter(c => CONF[c]).length;
  if (real + conf < t.length || real < Math.ceil(t.length / 3)) return tok;
  return t.split("").map(c => CONF[c] || c).join("");
}
function rowsOf(lines) {
  // une piezas de texto a la misma altura (el odómetro a veces sale partido: "56" "565")
  const byV = {};
  lines.forEach(l => (byV[l.v || 0] = byV[l.v || 0] || []).push(l));
  const out = [];
  Object.keys(byV).forEach(v => {
    const L = byV[v].slice().sort((a, b) => a.y - b.y);
    const used = new Set();
    L.forEach((l, i) => {
      if (used.has(i)) return;
      const row = [l]; used.add(i);
      L.forEach((m, j) => { if (!used.has(j) && Math.abs((m.y + m.h / 2) - (l.y + l.h / 2)) < Math.max(l.h, m.h) * 0.5) { row.push(m); used.add(j); } });
      row.sort((a, b) => a.x - b.x);
      out.push({ v: +v, h: Math.max(...row.map(r => r.h || 0)), parts: row.map(r => r.text), text: row.map(r => r.text).join(" ") });
    });
  });
  return out;
}
function odoCands(lines, ref, regionBonus) {
  const map = {};
  const add = (val, score, v) => { const k = String(val); const c = map[k] || (map[k] = { v: val, score: 0, seen: new Set() }); c.score = Math.max(c.score, score); c.seen.add(v); };
  const consider = (text, h, v, joined) => {
    const up = text.toUpperCase();
    if (/TRIP|ODO\s*B|RPM|°|\d:\d\d|KM\/H|MPH|AVG|PROM|L\/100|KM\/L/.test(up) && !/\bODO\b(?!\s*B)/.test(up)) return;
    const t = text.split(/\s+/).map(fixDigits).join(" ");
    (t.match(/\d[\d ,.]{1,9}\d/g) || []).forEach(raw => {
      if (/[.,]\d$/.test(raw.trim())) return;                 // 1234.5 suele ser el parcial
      const digits = raw.replace(/[^\d]/g, "");
      if (digits.length < 3 || digits.length > 7) return;
      const val = parseInt(digits, 10);
      if (val < 100) return;
      let sc = Math.min(120, h || 10) * 0.6 + (/KM/.test(up) ? 25 : 0) + (/ODO/.test(up) ? 30 : 0);
      sc += digits.length >= 5 ? 40 : digits.length === 4 ? 12 : -25;
      if (joined) sc -= 6;
      if (ref) { if (val >= ref && val <= ref + 3000) sc += 80 - Math.min(40, (val - ref) / 50); else if (val < ref) sc -= 60; else sc -= 20; }
      add(val, sc + (regionBonus || 0), v);
    });
  };
  lines.forEach(l => consider(l.text, l.h, l.v || 0, false));
  rowsOf(lines).forEach(r => { if (r.parts.length > 1) consider(r.parts.join(""), r.h, r.v, true); });
  return Object.values(map).map(c => ({ v: c.v, score: c.score + (c.seen.size - 1) * 15 })).sort((a, b) => b.score - a.score).slice(0, 5);
}
function readOdometer(lines, ref) { const c = odoCands(lines, ref); return c.length ? c[0].v : null; }

function readTicketOne(lines) {
  const L = lines.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(l => l.text.toUpperCase());
  const out = {};
  const numIn = s => { const m = String(s).replace(/O/g, "0").match(/\$?\s*(\d{1,3}(?:[,\s]\d{3})*|\d+)[.,](\d{2,3})\b/); return m ? parseFloat(m[1].replace(/[,\s]/g, "") + "." + m[2]) : null; };
  const near = (res, fn) => { for (const re of res) for (let i = 0; i < L.length; i++) if (re.test(L[i])) { const v = fn(L[i].replace(re, " ")) ?? (L[i + 1] ? fn(L[i + 1]) : null); if (v !== null && v !== undefined) return v; } return null; };
  out.importe = near([/TOTAL\s*(A\s*PAGAR)?/, /IMPORTE/, /MONTO/, /PAGAR|VENTA/], numIn);
  out.litros = near([/LITROS/, /\bLTS?\b\.?/, /VOLUMEN|VOL\./, /CANTIDAD|CANT\./], numIn);
  if (out.litros === null) { for (const s of L) { const m = s.match(/(\d+[.,]\d{1,3})\s*(L|LT|LTS|LITROS)\b/); if (m) { out.litros = parseFloat(m[1].replace(",", ".")); break; } } }
  out.precio = near([/PRECIO|P\.?\s*UNIT|\$\s*\/\s*L/], numIn);
  if (out.importe === null) { let best = null; L.forEach(s => { if (/\$/.test(s)) { const v = numIn(s); if (v !== null && (best === null || v > best)) best = v; } }); out.importe = best; }
  // deriva el dato que falte con precio por litro
  if (out.litros === null && out.importe && out.precio) out.litros = Math.round(out.importe / out.precio * 1000) / 1000;
  if (out.importe === null && out.litros && out.precio) out.importe = Math.round(out.litros * out.precio * 100) / 100;
  for (const s of L) {
    let m = s.match(/(20\d\d)[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) { out.fecha = m[1] + "-" + pad(m[2]) + "-" + pad(m[3]); break; }
    m = s.match(/(?<!\d)(\d{1,2})[\/\-.](\d{1,2}|[A-Z]{3})[\/\-.](\d{2,4})(?!\d)/);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      let mo = /^\d+$/.test(m[2]) ? +m[2] : ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"].indexOf(m[2]) + 1;
      const d = +m[1]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { out.fecha = y + "-" + pad(mo) + "-" + pad(d); break; }
    }
  }
  for (const s of L) {
    const m = s.match(/(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?::[0-5]\d)?\s*(A\.?\s?M\.?|P\.?\s?M\.?)?/);
    if (m && !/\$|LITRO|TOTAL/.test(s)) { let h = +m[1]; const pm = m[3] && /P/.test(m[3]); if (pm && h < 12) h += 12; if (m[3] && !pm && h === 12) h = 0; out.hora = pad(h) + ":" + m[2]; break; }
  }
  const code = s => { const m = s.match(/[#:\s.]*([A-Z0-9][A-Z0-9\-]{3,})/); return m && /\d/.test(m[1]) ? m[1] : null; };
  out.folio = near([/FOLIO/, /NO\.?\s*(DE\s*)?TICKET|TICKET/, /TRANSACCI[OÓ]N|TRANS\.?|NO\.?\s*OPERACI[OÓ]N|OPERACI[OÓ]N/, /TKT|REF\.?|REFERENCIA/], code);
  out.factura = near([/FACTURA/], code);
  return out;
}
function readTicket(lines) {
  const byV = {}; lines.forEach(l => (byV[l.v || 0] = byV[l.v || 0] || []).push(l));
  const res = Object.keys(byV).sort().map(v => readTicketOne(byV[v]));
  const out = {};
  ["importe", "litros", "precio", "fecha", "hora", "folio", "factura"].forEach(k => { const r = res.find(x => x[k] !== null && x[k] !== undefined); out[k] = r ? r[k] : null; });
  return out;
}

// ---------- tarjetas de foto ----------
const SLOTS = {
  ini: { title: "Odómetro al salir", sub: "lee el km inicial" },
  fin: { title: "Odómetro al llegar", sub: "lee el km final" },
  ticket: { title: "Ticket de bomba", sub: "folio, fecha, importe y litros" },
  ticketCar: { title: "Voucher de cobro", sub: "comprobante de la tarjeta" },
  odoCarga: { title: "Odómetro en la carga", sub: "lee el km" },
  extra: { title: "Evidencia adicional", sub: "opcional (respaldo)" }
};
const isOdoSlot = slot => slot === "ini" || slot === "fin" || slot === "odoCarga" || slot[0] === "p";
function slotInfo(slot) {
  if (SLOTS[slot]) return SLOTS[slot];
  if (slot[0] === "p") return { title: "Odómetro en la parada", sub: "lee el km de la parada" };
  if (slot[0] === "l") return { title: "Foto del lugar", sub: "hora y coordenadas" };
  return { title: slot, sub: "" };
}
function setModal(id, v) { const e = $(id); if (!e || v === null || v === undefined || v === "") return; e.value = v; e.classList.add("auto"); e.classList.remove("bad"); e.dispatchEvent(new Event("change")); }
function autoFill(id, v) { if (v === null || v === undefined || v === "" || !$(id)) return; $(id).value = v; $(id).classList.add("auto"); $(id).classList.remove("bad"); syncEntry(); }
function odoRef(slot) {
  if (slot === "ini") return lastKnownKm();
  if (slot[0] === "p") { const st = day.stopsDone[Number(slot.slice(1))]; return st && st.km ? st.km - 200 : (num(day.entry.kmIni) ?? lastKnownKm()); }
  return num(day.entry.kmIni) ?? lastKnownKm();
}
// el km leído va al campo que corresponde a cada foto
function applyOdo(slot, km) {
  const p = day.photos[slot]; if (p) { p.km = km; p.read = km !== null ? fmt(km) + " km" : ""; p.note = km === null ? "No se distingue el odómetro: toca los números en la foto o escribe el km." : ""; }
  if (km === null) return;
  if (slot === "ini") { autoFill("kmIni", km); setModal("m_kmIni", km); renderGap(); }
  else if (slot === "fin") autoFill("kmFin", km);
  else if (slot === "odoCarga") setModal("c_km", km);
  else if (slot[0] === "p") setModal("m_km", km);
  updateOdo(); renderCluster();
}

function drawShot(slot) {
  const box = $("shot-" + slot); if (!box) return;
  const p = day.photos[slot]; box.textContent = "";
  const s = el("div", "shot" + (p && p.preview ? " has" : ""));
  const t = el("div", "t"); t.append(el("span", "", slotInfo(slot).title), el("span", "", slotInfo(slot).sub));
  s.appendChild(t);
  if (p && p.busy) s.appendChild(el("div", "hint", "Leyendo la foto…"));
  if (p && p.preview) {
    const wrap = el("div", isOdoSlot(slot) ? "tap" : "");
    const img = el("img"); img.src = p.preview; img.alt = slotInfo(slot).title; wrap.appendChild(img); s.appendChild(wrap);
    if (isOdoSlot(slot)) img.onclick = ev => readZone(slot, ev, wrap);
    if (p.read) s.appendChild(el("div", "read", p.read));
    if (isOdoSlot(slot) && p.cands && p.cands.length > 1) {
      const ch = el("div", "chips"); ch.appendChild(el("span", "hint", "¿No es ese? Elige la lectura correcta:"));
      p.cands.forEach(c => { const b = el("button", "chip" + (c.v === p.km ? " on" : ""), fmt(c.v)); b.onclick = () => { applyOdo(slot, c.v); persist(); drawShot(slot); }; ch.appendChild(b); });
      s.appendChild(ch);
    }
    const kv = el("dl", "kv");
    const add = (k, v) => { kv.append(el("dt", "", k), el("dd", "", v)); };
    add("Fecha y hora", new Date(p.time).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) + (p.timeSource === "foto" ? "" : " *"));
    add("Coordenadas", coordStr(p.lat, p.lon) || "—");
    if (p.address) add("Lugar", p.address);
    s.appendChild(kv);
    if (p.note) s.appendChild(el("div", "err", p.note));
    if (typeof p.lat !== "number" && (isOdoSlot(slot) || slot[0] === "l")) {
      const r = el("div", "actions");
      const here = el("button", "small ghost", "Agregar mi ubicación a la foto"); here.onclick = () => locateFor(slot);
      r.appendChild(here); s.appendChild(r);
    }
    if (p.uploaded) s.appendChild(el("div", "hint", "Subida a Drive ✓"));
  }
  const pick = el("div", "choice");
  const cam = el("button", "primary small", p && p.preview ? "Tomar otra" : "Tomar foto"); cam.onclick = () => takePhoto(slot, "camera");
  const gal = el("button", "ghost small", "De la galería"); gal.onclick = () => takePhoto(slot, "gallery");
  pick.append(cam, gal); s.appendChild(pick);
  box.appendChild(s);
}

// Lee de nuevo solo la zona tocada (útil cuando la foto trae reloj, temperatura o el parcial)
async function readZone(slot, ev, wrap) {
  const r = ev.target.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
  wrap.classList.add("reading");
  const res = await nat("ocrRegion", slot, x, y);
  wrap.classList.remove("reading");
  if (!res.ok) { banner("bad", "No se pudo leer la zona", res.error); return; }
  const p = day.photos[slot];
  const cands = odoCands(res.lines || [], odoRef(slot), 30);
  // mezcla con las lecturas anteriores, dando prioridad a la zona tocada
  const merged = cands.concat((p.cands || []).filter(c => !cands.some(x => x.v === c.v)).map(c => ({ v: c.v, score: c.score - 40 })));
  p.cands = merged.sort((a, b) => b.score - a.score).slice(0, 5);
  applyOdo(slot, cands.length ? cands[0].v : (p.km ?? null));
  if (!cands.length) p.note = "No encontré números en esa zona; toca justo sobre el kilometraje.";
  persist(); drawShot(slot);
}

async function takePhoto(slot, source) {
  const prev = day.photos[slot];
  day.photos[slot] = Object.assign({}, prev || {}, { busy: true }); drawShot(slot);
  const r = await nat("photo", slot, source);
  if (!r.ok) { if (prev) day.photos[slot] = prev; else delete day.photos[slot]; drawShot(slot); if (!r.cancelled) banner("bad", "No se pudo procesar la foto", r.error); return; }
  const p = { preview: r.preview, lat: r.lat, lon: r.lon, time: r.time, timeSource: r.timeSource, address: r.address || "", uploaded: false };
  day.photos[slot] = p;
  const lines = r.lines || [];
  const atHome = nearHome(r.lat, r.lon);
  const place = atHome ? homeLabel() : r.address;
  if (isOdoSlot(slot)) {
    p.cands = odoCands(lines, odoRef(slot));
    applyOdo(slot, p.cands.length ? p.cands[0].v : null);
    if (slot === "ini") {
      autoFill("fTras", isoOf(new Date(r.time)));
      const de = atHome ? homeLabel() : r.address, deC = atHome ? homeCoords() : coordStr(r.lat, r.lon);
      if (!(home() && isHomeText(day.entry.de)) || atHome) { autoFill("de", de); autoFill("deC", deC); setModal("m_de", de); setModal("m_deC", deC); }
    }
    if (slot === "fin") {
      if (atHome) { autoFill("a", homeLabel()); autoFill("aC", homeCoords()); autoFill("aAsunto", "Regreso a domicilio"); }
      else { autoFill("aC", coordStr(r.lat, r.lon)); autoFill("a", r.address); }
    }
    if (slot[0] === "p") { const l = day.photos["l" + slot.slice(1)]; if (!l || typeof l.lat !== "number") { setModal("m_aC", atHome ? homeCoords() : coordStr(r.lat, r.lon)); setModal("m_a", place); } }
  } else if (slot[0] === "l") {
    setModal("m_aC", atHome ? homeCoords() : coordStr(r.lat, r.lon)); setModal("m_a", place);
  } else if (slot === "ticket" || slot === "ticketCar") {
    const t = readTicket(lines);
    const bits = []; if (t.folio) bits.push("Folio " + t.folio); if (t.importe) bits.push(money(t.importe)); if (t.litros) bits.push(fmt(t.litros, 3) + " L");
    p.read = bits.join(" · ");
    if (!t.importe && !t.litros && slot === "ticket") p.note = "No pude leer importe ni litros; escríbelos o toma la foto más de frente y con luz.";
    // el ticket de bomba manda; el voucher solo completa lo que falte
    const put = (id, v) => { if (v === null || v === undefined) return; if (slot === "ticket" || !has($(id) && $(id).value)) setModal(id, v); };
    put("c_folio", t.folio); put("c_importe", t.importe); put("c_litros", t.litros); put("c_factura", t.factura);
    put("c_fecha", t.fecha || isoOf(new Date(r.time)));
    put("c_hora", t.hora || (r.timeSource === "foto" ? hm(r.time) : null));
    saveCargaForm();
  }
  persist(); drawShot(slot); updateOdo(); renderGap(); updatePump(); renderCluster();
}

async function locateFor(slot) {
  const r = await nat("location");
  if (!r.ok) { banner("bad", "Sin ubicación", r.error); return; }
  const w = await nat("rewatermark", slot, r.lat, r.lon);
  if (!w.ok) { banner("bad", "No se pudo actualizar la foto", w.error); return; }
  Object.assign(day.photos[slot], { preview: w.preview, lat: r.lat, lon: r.lon, address: r.address || "", uploaded: false });
  const atHome = nearHome(r.lat, r.lon);
  if (slot === "ini") { const de = atHome ? homeLabel() : r.address, deC = atHome ? homeCoords() : coordStr(r.lat, r.lon); autoFill("deC", deC); autoFill("de", de); setModal("m_de", de); setModal("m_deC", deC); }
  if (slot === "fin") { autoFill("aC", atHome ? homeCoords() : coordStr(r.lat, r.lon)); autoFill("a", atHome ? homeLabel() : r.address); }
  if (slot[0] === "p" || slot[0] === "l") { setModal("m_aC", coordStr(r.lat, r.lon)); setModal("m_a", atHome ? homeLabel() : r.address); }
  persist(); drawShot(slot);
}

// ---------- formulario del día ----------
function fillForm() { FIELDS.forEach(k => { $(k).value = day.entry[k] ?? ""; }); updateOdo(); }
function syncEntry() { FIELDS.forEach(k => day.entry[k] = $(k).value.trim()); persist(); }
FIELDS.forEach(k => $(k).addEventListener("input", () => { $(k).classList.remove("auto", "bad"); syncEntry(); updateOdo(); if (k === "kmIni") { renderGap(); renderCluster(); } }));
function drums(box, value, digits, withDec) {
  box.textContent = "";
  if (value === null || value === undefined || isNaN(value)) { box.classList.add("empty"); for (let i = 0; i < digits; i++) box.appendChild(el("span", "", "-")); return; }
  box.classList.remove("empty");
  const int = Math.floor(value), s = String(int).padStart(digits, "0");
  s.split("").forEach(c => box.appendChild(el("span", "", c)));
  if (withDec) box.appendChild(el("span", "dec", String(Math.floor((value - int) * 10))));
}
function updateOdo() {
  const a = num($("kmIni").value), b = num($("kmFin").value), d = a !== null && b !== null ? Math.max(0, b - a) : 0;
  drums($("odo"), d, Math.max(3, String(Math.round(d)).length), false);
  updateCompare();
}
function updatePump() {
  if (!$("c_importe")) return;
  const imp = num($("c_importe").value), lit = num($("c_litros").value);
  $("c_pImp").textContent = (imp || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $("c_pLit").textContent = (lit || 0).toLocaleString("es-MX", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  $("c_pPre").textContent = imp && lit ? (imp / lit).toFixed(2) : "—";
}
function need(ids, errEl, msg) {
  const bad = ids.filter(([id, ok]) => !ok(day.entry[id]));
  ids.forEach(([id]) => $(id).classList.toggle("bad", bad.some(b => b[0] === id)));
  if (bad.length) { $(errEl).textContent = msg + bad.map(b => b[2]).join(", ") + "."; $(errEl).hidden = false; $(bad[0][0]).focus(); return false; }
  $(errEl).hidden = true; return true;
}

function slotsToSend(list) { return list.filter(s => day.photos[s.slot] && day.photos[s.slot].preview && !day.photos[s.slot].uploaded); }
function markUploaded(list) { list.forEach(s => { if (day.photos[s.slot]) day.photos[s.slot].uploaded = true; }); }
// recuadros de la pestaña de Evidencia: voucher → TICKET CAR, ticket → TICKET BOMBA, odómetro → ODÓMETRO, adicional → RESPALDO
const CARGA_SLOTS = [{ slot: "ticket", box: "ticketBomba" }, { slot: "ticketCar", box: "ticketCar" }, { slot: "odoCarga", box: "odometro" }, { slot: "extra", box: "respaldo" }];

async function saveRow(extraSlots) {
  const slots = slotsToSend(extraSlots);
  const r = await call("save", { row: day.row, entry: day.entry, photoSlots: slots });
  if (!r.ok) throw new Error(r.error || "Error al guardar");
  day.row = r.row; markUploaded(slots); persist();
  return r;
}

// ---------- continuidad del odómetro ----------
// Si el km de hoy no empieza donde terminó el último registro, se agrega una fila de ajuste
// para que la suma de KM RECORRIDO de la hoja coincida con el odómetro.
function lastSheetRow() { const r = sheet.rows || []; for (let i = r.length - 1; i >= 0; i--) if (r[i].kmFin !== "" || r[i].kmIni !== "") return r[i]; return null; }
function gapInfo() {
  const last = lastKnownKm(), ini = num(day.entry.kmIni);
  if (last === null || ini === null) return null;
  return { last, ini, diff: ini - last };
}
let lowArmed = false;
function renderGap() {
  const box = $("gapBox"); if (!box) return; const g = gapInfo(); box.textContent = "";
  if (!g || g.diff === 0 || day.stage !== "idle") { box.hidden = true; return; }
  box.hidden = false;
  if (g.diff > 0) {
    box.className = "note fuel";
    box.appendChild(el("div", "", "El último registro termina en " + fmt(g.last) + " km y hoy arrancas en " + fmt(g.ini) + " km: hay " + fmt(g.diff) + " km sin registrar."));
    const l = el("label", "check"); const c = el("input"); c.type = "checkbox"; c.checked = !day.gapOff;
    c.onchange = () => { day.gapOff = !c.checked; persist(); };
    l.append(c, el("span", "", "Agregar un registro de ajuste (" + fmt(g.last) + " → " + fmt(g.ini) + " km) antes del de hoy para que el cálculo cuadre."));
    box.appendChild(l);
  } else {
    box.className = "note bad";
    box.appendChild(el("div", "", "El km inicial (" + fmt(g.ini) + ") es menor que el último registrado en la hoja (" + fmt(g.last) + "). Revisa la lectura de la foto; si es correcto, toca Iniciar dos veces."));
  }
}
async function saveGapRow(g) {
  const prev = lastSheetRow();
  const entry = { fTras: day.entry.fTras || today(), kmIni: String(g.last), kmFin: String(g.ini), asunto: ADJ,
    de: prev ? (prev.a || prev.de || "Último registro") : "Último registro", deC: prev ? (prev.aC || prev.deC || "") : "",
    a: day.entry.de || "", aC: day.entry.deC || "" };
  const r = await call("save", { row: null, entry, photoSlots: [] });
  if (!r.ok) throw new Error(r.error || "No se guardó el registro de ajuste");
  return r.row;
}

// ---------- inicio ----------
async function beginDay(t, label) {
  const g = gapInfo();
  let gapRow = null;
  if (g && g.diff > 0 && !day.gapOff) gapRow = await saveGapRow(g);
  await saveRow([{ slot: "ini" }]);
  if (has(day.entry.kmIni)) A.setConfig(JSON.stringify({ lastKm: num(day.entry.kmIni) }));
  banner("ok", label || "Jornada iniciada", (gapRow ? "Registro de ajuste en la fila " + gapRow + ". " : "") + "Tramo 1 en la fila " + day.row + ". El recorrido se está grabando.", null, "ok");
  loadSheet();
}

// Iniciar jornada: hoja con la foto del odómetro, el km leído y el punto de salida
$("btnStart").onclick = () => {
  if (!cfg.scriptUrl) { banner("bad", "Primero conecta tu hoja", "Pega la dirección del servicio de Google."); return; }
  day.entry.fTras = today();
  if (!has(day.entry.kmIni) && lastKnownKm() !== null) day.entry.kmIni = String(lastKnownKm());
  if (!has(day.entry.de) && home()) { day.entry.de = homeLabel(); day.entry.deC = homeCoords(); }
  fillForm(); persist();
  openModal(sh => {
    sh.append(el("h2", "", "Iniciar jornada"), el("p", "hint", fechaLarga(today()) + ". Toma la foto del odómetro: la app lee el km. Si la lectura no es correcta, toca los números en la foto o escribe el km."));
    const d = el("div"); d.id = "shot-ini"; sh.appendChild(d);
    const lk = el("label", "", "Km inicial del odómetro"); const ik = el("input", "num bigkm"); ik.id = "m_kmIni"; ik.type = "number"; ik.inputMode = "numeric"; ik.value = day.entry.kmIni || "";
    const onKm = () => { ik.classList.remove("bad"); day.entry.kmIni = ik.value.trim(); $("kmIni").value = day.entry.kmIni; persist(); renderGap(); renderCluster(); };
    ik.oninput = onKm; ik.onchange = onKm; lk.appendChild(ik);
    const gap = el("div", "note fuel"); gap.id = "gapBox"; gap.hidden = true;
    const ld = el("label", "", "Sale de"); const id_ = el("input"); id_.id = "m_de"; id_.value = day.entry.de || ""; ld.appendChild(id_);
    const lc = el("label", "", "Coordenadas de salida"); const ic = el("input", "num"); ic.id = "m_deC"; ic.value = day.entry.deC || ""; lc.appendChild(ic);
    id_.oninput = id_.onchange = () => { day.entry.de = id_.value.trim(); $("de").value = day.entry.de; persist(); };
    ic.oninput = ic.onchange = () => { day.entry.deC = ic.value.trim(); $("deC").value = day.entry.deC; persist(); };
    const err = el("div", "err"); err.hidden = true;
    const go = el("button", "go big", "Arrancar y grabar recorrido"); const no = el("button", "ghost", "Cancelar"); no.onclick = closeModal;
    let low = false;
    go.onclick = async () => {
      const km = num(ik.value);
      if (km === null) { ik.classList.add("bad"); err.textContent = "Falta el km inicial: toma la foto o escríbelo."; err.hidden = false; return; }
      const g = gapInfo();
      if (g && g.diff < 0 && !low) { low = true; err.textContent = "El km es menor que el último registrado (" + fmt(g.last) + "). Revisa la lectura; toca otra vez si es correcto."; err.hidden = false; return; }
      go.disabled = true; go.textContent = "Arrancando…";
      try {
        markDeparture();
        const t = await nat("startTracking");
        if (!t.ok) throw new Error(t.error || "No se pudo iniciar el GPS");
        day.stage = "running"; day.startedAt = Date.now(); day.tramoStart = Date.now(); persist();
        closeModal(); render();
        await beginDay();
      } catch (e) {
        if (day.stage === "running") banner("bad", "El inicio no se guardó en la hoja", e.message + ". El recorrido sí se está grabando.", [{ label: "Reintentar", cls: "primary", run: () => beginDay().catch(x => banner("bad", "Sigue sin guardarse", x.message)) }], "startfail");
        else { err.textContent = e.message; err.hidden = false; go.disabled = false; go.textContent = "Arrancar y grabar recorrido"; }
      } finally { render(); }
    };
    const act = el("div", "actions"); act.append(no);
    sh.append(lk, gap, ld, lc, err, go, act);
  });
  drawShot("ini"); renderGap();
  if (!day.photos.ini) takePhoto("ini", "camera");
};

$("btnArm").onclick = async () => {
  if (!home()) { showTab("aj"); $("btnHome").scrollIntoView({ block: "center" }); banner("alert", "Falta tu domicilio", "Guarda la ubicación de tu domicilio para saber cuándo sales.", null, "nohome"); return; }
  const r = await nat("arm");
  cfg = JSON.parse(A.config());
  if (!r.ok) { banner("bad", "No se pudo activar la espera", r.error || "Revisa los permisos de ubicación."); return; }
  if (cfg.perms && !cfg.perms.background) banner("alert", "Permite la ubicación “todo el tiempo”", "Para detectar la salida con la app cerrada, Android necesita ese permiso.", [{ label: "Permitir", cls: "primary", run: () => A.backgroundLocation() }], "bg");
  render();
};
$("btnDisarm").onclick = () => { A.disarm(); cfg.armed = false; setTimeout(() => { cfg = JSON.parse(A.config()); render(); }, 300); render(); };

// Salida detectada por el GPS con la app cerrada o abierta (se atiende una sola vez)
const DEPKEY = "bitacora-salida-atendida";
function markDeparture() { if (cfg.departedAt > 0) save(DEPKEY, cfg.departedAt); }
function checkDeparture() {
  cfg = JSON.parse(A.config());
  if (cfg.departedAt > 0 && cfg.departedAt !== load(DEPKEY, 0) && day.stage === "idle" && day.date === today()) startFromDeparture(cfg.departedAt);
}
let departing = false;
async function startFromDeparture(t) {
  if (departing || day.stage !== "idle") return;
  departing = true; save(DEPKEY, t);
  try {
    if (!has(day.entry.kmIni)) { const k = lastKnownKm(); if (k !== null) day.entry.kmIni = String(k); }
    day.entry.fTras = today();
    if (home()) { day.entry.de = homeLabel(); day.entry.deC = homeCoords(); }
    day.stage = "running"; day.startedAt = t; day.tramoStart = t; day.fromDeparture = true; persist(); render();
    showTab("hoy");
    if (!cfg.scriptUrl) return;
    if (!has(day.entry.kmIni)) { openIniConfirm(true); return; }
    await beginDay(t, "Saliste del domicilio a las " + hm(t));
    banner("alert", "Confirma el km inicial", "Se tomó " + fmt(num(day.entry.kmIni)) + " km del último registro. Toma la foto del odómetro para confirmarlo.", [{ label: "Tomar foto", cls: "primary", run: () => openIniConfirm(false) }], "confirmIni");
  } catch (e) {
    banner("bad", "La salida quedó grabada, pero no se guardó en la hoja", e.message, [{ label: "Reintentar", cls: "primary", run: () => beginDay().catch(x => banner("bad", "Sigue sin guardarse", x.message)) }], "startfail");
  } finally { departing = false; }
}

// Confirma (o captura) el km inicial con la foto después de una salida automática
function openIniConfirm(required) {
  openModal(sh => {
    sh.appendChild(el("h2", "", "Km inicial del día"));
    sh.appendChild(el("p", "hint", required ? "No hay un km anterior registrado. Toma la foto del odómetro para empezar el registro." : "Toma la foto del odómetro: si el km es distinto al último registro se corrige y, si hace falta, se agrega el registro de ajuste."));
    const d = el("div"); d.id = "shot-ini"; sh.appendChild(d);
    const lab = el("label", "", "Km del odómetro"); const inp = el("input", "num"); inp.id = "m_kmIni"; inp.type = "number"; inp.value = day.entry.kmIni || ""; lab.appendChild(inp); sh.appendChild(lab);
    const err = el("div", "err"); err.hidden = true; sh.appendChild(err);
    const act = el("div", "actions");
    const ok = el("button", "primary", "Guardar km inicial"), later = el("button", "ghost", "Después");
    ok.onclick = async () => {
      const km = num(inp.value); if (km === null) { inp.classList.add("bad"); return; }
      ok.disabled = true; ok.textContent = "Guardando…";
      try {
        const last = lastKnownKm();
        if (!day.row) { day.entry.kmIni = String(km); persist(); await beginDay(); }
        else if (num(day.entry.kmIni) !== km && day.done.length === 0) {
          // la fila guardada se convierte en el ajuste y el tramo 1 arranca con el km real
          if (last !== null && km > last && !day.gapOff) {
            const prev = lastSheetRow();
            const adj = { fTras: day.entry.fTras, kmIni: String(last), kmFin: String(km), asunto: ADJ, de: prev && prev.r !== day.row ? (prev.a || prev.de || "Último registro") : "Último registro", deC: prev && prev.r !== day.row ? (prev.aC || "") : "", a: day.entry.de, aC: day.entry.deC };
            const r1 = await call("save", { row: day.row, entry: adj, photoSlots: [] }); if (!r1.ok) throw new Error(r1.error);
            day.row = null;
          }
          day.entry.kmIni = String(km); persist();
          await saveRow([{ slot: "ini" }]);
        } else { day.entry.kmIni = String(km); persist(); await saveRow([{ slot: "ini" }]); }
        A.setConfig(JSON.stringify({ lastKm: km }));
        closeModal(); render(); loadSheet(); setTimeout(autoRegisterPending, 300);
        banner("ok", "Km inicial confirmado", fmt(km) + " km · fila " + day.row + ".", null, "ok");
      } catch (e) { err.textContent = e.message; err.hidden = false; ok.disabled = false; ok.textContent = "Reintentar"; }
    };
    later.onclick = closeModal;
    act.append(ok, later); sh.appendChild(act);
  });
  drawShot("ini");
}

// Descanso
$("btnRest").onclick = () => {
  openModal(sh => {
    sh.append(el("h2", "", "¿" + fechaLarga(today()) + " es día de descanso?"),
      el("p", "hint", "Se escribe una fila con la fecha, “DÍA DE DESCANSO” en asunto y el mismo kilometraje inicial y final (" + (lastKnownKm() !== null ? fmt(lastKnownKm()) + " km" : "último km registrado") + "). Hoy no sonarán alertas."));
    const r = el("div", "actions");
    const yes = el("button", "warnbtn", "Sí, hoy descanso"); const no = el("button", "ghost", "Cancelar");
    no.onclick = closeModal;
    yes.onclick = async () => {
      yes.disabled = true; yes.textContent = "Guardando…";
      const res = await call("rest", { date: today(), km: lastKnownKm() });
      closeModal();
      if (!res.ok) { banner("bad", "No se guardó el día de descanso", res.error); return; }
      A.disarm();
      day = freshDay(); day.stage = "rest"; day.row = res.row; persist(); render(); loadSheet();
      banner("ok", "Día de descanso registrado", "Fila " + res.row + ". Las alertas de hoy quedan apagadas.", null, "ok");
    };
    r.append(yes, no); sh.appendChild(r);
  });
};

// ---------- carga de combustible ----------
// Fotos: ticket de bomba, voucher de cobro, odómetro y una adicional. Del ticket se leen folio, fecha y hora,
// importe y litros. Se guarda en la fila del traslado que corresponde y en la pestaña de Evidencia que le toca.
const CKEY = "bitacora-carga";
const CF = ["c_folio", "c_fecha", "c_hora", "c_importe", "c_litros", "c_factura", "c_km"];
function saveCargaForm() { const o = {}; CF.forEach(k => { if ($(k)) o[k] = $(k).value; }); if ($("c_row")) o.c_row = $("c_row").value; save(CKEY, o); updatePump(); }
function cargaRowOptions(date) {
  const opts = [];
  const isToday = date === day.date && day.stage === "running";
  if (isToday) opts.push({ v: "cur", t: "Tramo en curso" + (day.row ? " (fila " + day.row + ")" : "") + " · desde " + (day.entry.de || "inicio") });
  (sheet.rows || []).filter(x => x.fTras === date && !/DESCANSO/i.test(x.asunto) && (!isToday || x.r !== day.row)).slice().reverse()
    .forEach(x => opts.push({ v: String(x.r), t: "Fila " + x.r + " · " + (x.de || "—") + " → " + (x.a || "abierto") + (x.importe ? " · ya tiene carga" : "") }));
  opts.push({ v: "new", t: "Fila nueva solo para la carga" });
  return opts;
}
function openCarga() {
  const saved = load(CKEY, {});
  openModal(sh => {
    sh.append(el("h2", "", "Carga de combustible"), el("p", "hint", "Toma o sube la foto del ticket de bomba: la app lee folio, fecha y hora, importe y litros. Las fotos van a la pestaña de Evidencia que le toca a esta carga."));
    const pump = el("div", "pump");
    [["Importe $", "c_pImp", ""], ["Litros", "c_pLit", ""], ["Precio / L", "c_pPre", " s"]].forEach(([k, id, c]) => { const r = el("div", "r"); const v = el("span", "v" + c, "0"); v.id = id; r.append(el("span", "k", k), v); pump.appendChild(r); });
    sh.appendChild(pump);
    ["ticket", "ticketCar", "odoCarga", "extra"].forEach(k => { const d = el("div"); d.id = "shot-" + k; sh.appendChild(d); });
    const mk = (id, label, type, cls, ph) => { const l = el("label", "", label); const i = el("input", cls || ""); i.id = id; i.type = type || "text"; if (ph) i.placeholder = ph; if (type === "number") i.step = "any"; i.value = saved[id] ?? ""; i.oninput = i.onchange = () => { i.classList.remove("bad"); saveCargaForm(); if (id === "c_fecha") fillRows(); }; l.appendChild(i); return l; };
    const g1 = el("div", "grid"); g1.append(mk("c_folio", "Folio / # ticket"), mk("c_fecha", "Fecha", "date"), mk("c_hora", "Hora", "time"));
    const g2 = el("div", "grid"); g2.append(mk("c_importe", "Importe ($)", "number", "num"), mk("c_litros", "Litros", "number", "num"));
    const g3 = el("div", "grid"); g3.append(mk("c_km", "Odómetro (km)", "number", "num"), mk("c_factura", "No. factura (opcional)"));
    const lr = el("label", "", "Guardar en el registro"); const sel = el("select"); sel.id = "c_row"; sel.onchange = saveCargaForm; lr.appendChild(sel);
    const err = el("div", "err"); err.hidden = true;
    const ok = el("button", "primary big", "Guardar carga y evidencias"); const no = el("button", "ghost", "Cerrar"); no.onclick = closeModal;
    const clear = el("button", "ghost", "Limpiar"); clear.onclick = () => { save(CKEY, {}); ["ticket", "ticketCar", "odoCarga", "extra"].forEach(k => { delete day.photos[k]; A.clearPhoto(k); }); persist(); openCarga(); };
    sh.append(g1, g2, g3, lr, err, ok);
    const act = el("div", "actions"); act.append(clear, no); sh.appendChild(act);
    function fillRows() {
      const d = $("c_fecha").value || today(); const prev = sel.value || saved.c_row;
      sel.textContent = ""; const opts = cargaRowOptions(d);
      opts.forEach(o => { const op = el("option", "", o.t); op.value = o.v; sel.appendChild(op); });
      if (opts.some(o => o.v === prev)) sel.value = prev;
    }
    if (!$("c_fecha").value) $("c_fecha").value = today();
    fillRows();
    ok.onclick = async () => {
      const v = id => $(id).value.trim();
      const miss = [];
      if (!v("c_fecha")) miss.push(["c_fecha", "fecha"]);
      if (!(num(v("c_importe")) > 0)) miss.push(["c_importe", "importe"]);
      if (!(num(v("c_litros")) > 0)) miss.push(["c_litros", "litros"]);
      miss.forEach(([id]) => $(id).classList.add("bad"));
      if (miss.length) { err.textContent = "Falta: " + miss.map(m => m[1]).join(", ") + "."; err.hidden = false; return; }
      if (!day.photos.ticket || !day.photos.ticket.preview) { if (!ok.dataset.armed) { ok.dataset.armed = "1"; ok.textContent = "Guardar sin foto del ticket"; err.textContent = "Falta la foto del ticket de bomba para la evidencia."; err.hidden = false; return; } }
      ok.disabled = true; ok.textContent = "Subiendo fotos y guardando…"; err.hidden = true;
      try {
        let row = null; const choice = sel.value;
        if (choice === "cur") { if (!day.row) await saveRow([]); row = day.row; }
        else if (choice !== "new") row = Number(choice);
        const carga = { folio: v("c_folio"), fCarga: v("c_fecha"), hora: v("c_hora"), importe: v("c_importe"), litros: v("c_litros"), factura: v("c_factura"), km: v("c_km") };
        const slots = slotsToSend(CARGA_SLOTS);
        const r = await call("carga", { row, date: v("c_fecha"), carga, photoSlots: slots });
        if (!r.ok) throw new Error(r.error || "Error al guardar la carga");
        markUploaded(slots);
        CARGA_SLOTS.forEach(x => { delete day.photos[x.slot]; A.clearPhoto(x.slot); });
        save(CKEY, {}); persist(); closeModal(); loadSheet();
        banner("ok", "Carga guardada en la fila " + r.row, money(num(carga.importe)) + " · " + fmt(num(carga.litros), 3) + " L · folio " + (carga.folio || "—") + (r.evidenceTab ? ". Fotos y datos en la pestaña " + r.evidenceTab + "." : "."), null, "ok");
      } catch (e) { err.textContent = e.message; err.hidden = false; ok.disabled = false; ok.textContent = "Reintentar"; }
    };
  });
  ["ticket", "ticketCar", "odoCarga", "extra"].forEach(drawShot);
  updatePump();
}
["btnCarga", "btnCargaIdle", "btnCargaDone", "btnCargaReg"].forEach(id => $(id).onclick = () => { if (!cfg.scriptUrl) { banner("bad", "Primero conecta tu hoja", ""); return; } openCarga(); });

// Fin
$("btnArriveHome").onclick = () => { autoFill("a", homeLabel()); autoFill("aC", homeCoords()); };
$("btnEnd").onclick = async () => {
  syncEntry();
  const ini = num(day.entry.kmIni);
  const lastDone = day.done[day.done.length - 1];
  const tk = tramoKm() || 0;
  // si la última parada fue la llegada al domicilio y no se movió después, la foto corrige esa fila
  const homeClosed = lastDone && !day.row && isHomeText(lastDone.a) && tk < 0.5;
  if (!homeClosed && !need([["kmFin", v => isNum(v) && (ini === null || num(v) >= ini), "km final (no menor al inicial)"]], "endErr", "Revisa: ")) return;
  if (homeClosed && !isNum(day.entry.kmFin)) { day.entry.kmFin = String(num(lastDone.entry.kmFin)); }
  const asuntoFin = $("aAsunto").value.trim() || (isHomeText(day.entry.a) || (homeClosed && isHomeText(lastDone.a)) ? "Regreso a domicilio" : "");
  const b = $("btnEnd"); b.disabled = true; b.textContent = "Cerrando el día…";
  try {
    A.stopTracking();
    const fin = num(day.entry.kmFin);
    let row;
    if (homeClosed) {
      const entry = Object.assign({}, lastDone.entry, { kmFin: String(fin) });
      if (asuntoFin && !has(entry.asunto)) entry.asunto = asuntoFin;
      const slots = slotsToSend([{ slot: "fin" }]);
      const r = await call("save", { row: lastDone.row, entry, photoSlots: slots });
      if (!r.ok) throw new Error(r.error);
      markUploaded(slots); lastDone.entry = entry; lastDone.km = fin - (num(entry.kmIni) || fin); row = r.row;
    } else {
      if (!has(day.entry.a) && home() && nearHomeNow()) { day.entry.a = homeLabel(); day.entry.aC = homeCoords(); }
      day.entry.asunto = asuntoFin || (isHomeText(day.entry.a) ? "Regreso a domicilio" : day.entry.asunto || "");
      const slots = [{ slot: "fin" }];
      const r = await saveRow(slots); row = r.row;
      const g = tramoKm(); rowGps[day.entry.fTras + "|" + r.row] = g; save(RGKEY, rowGps);
      day.done.push({ row: r.row, de: day.entry.de, a: day.entry.a, km: fin - (ini || 0), gps: g, entry: Object.assign({}, day.entry) });
    }
    A.setConfig(JSON.stringify({ lastKm: fin }));
    b.textContent = "Guardando recorrido…";
    const odoTot = day.done.reduce((t, x) => t + (x.km || 0), 0);
    const k = await nat("exportTrack", day.date, true, String(odoTot));
    day.gpsKm = gpsKm(day.date);
    day.stage = "closed"; day.kml = k; persist();
    banner("ok", "Día cerrado", day.done.length + (day.done.length === 1 ? " tramo guardado" : " tramos guardados") + " (última fila " + row + ")." + (k.links && k.links.kml ? " Recorrido KML en Drive." : "") + (k.local ? " Copia en " + k.local + "." : ""), null, "ok");
    loadSheet();
  } catch (e) {
    banner("bad", "El cierre no se guardó en la hoja", e.message + ". El recorrido ya se detuvo; toca Terminar otra vez cuando tengas señal.");
    day.stage = "running"; persist();
  } finally { b.disabled = false; b.textContent = "Terminar jornada y guardar"; render(); }
};
function nearHomeNow() { try { const t = JSON.parse(A.track(day.date)); return t.last ? nearHome(t.last.lat, t.last.lon) : false; } catch (e) { return false; } }

async function startTracking() { const t = await nat("startTracking"); if (!t.ok) banner("bad", "No se pudo reanudar", t.error || ""); renderTrack(); }
async function shareKml(scope) {
  const r = await nat("shareKml", scope);
  if (!r.ok) banner("bad", "No se pudo exportar el KML", r.error);
  else if (r.local) banner("ok", "KML listo", "También quedó en " + r.local + ".", null, "kml");
}
$("btnEarth").onclick = () => A.openEarth(day.date);
$("btnEarth2").onclick = () => A.openEarth(day.date);
$("btnShareKml").onclick = () => shareKml(day.date);
$("btnShareKml2").onclick = () => shareKml(day.date);
$("btnNewDay").onclick = () => { day = freshDay(); persist(); render(); };

// ---------- tablero ----------
function gpsKm(date) { try { const t = JSON.parse(A.track(date || day.date)); return t.points > 1 ? t.km : null; } catch (e) { return null; } }
(function drawTicks() {
  const g = $("ticks"); const NS = "http://www.w3.org/2000/svg";
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI - i / 20 * Math.PI, major = i % 5 === 0;
    const r1 = major ? 104 : 110, r2 = 118;
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", 160 + r1 * Math.cos(a)); l.setAttribute("y1", 160 - r1 * Math.sin(a));
    l.setAttribute("x2", 160 + r2 * Math.cos(a)); l.setAttribute("y2", 160 - r2 * Math.sin(a));
    l.setAttribute("stroke", major ? "#c7d1d7" : "#4a5862"); l.setAttribute("stroke-width", major ? 3 : 1.5); l.setAttribute("stroke-linecap", "round");
    g.appendChild(l);
  }
  const mid = document.createElementNS(NS, "text");
  mid.setAttribute("x", 160); mid.setAttribute("y", 14); mid.setAttribute("fill", "#8a9aa5"); mid.setAttribute("font-size", "13"); mid.setAttribute("text-anchor", "middle"); mid.setAttribute("font-family", "monospace"); mid.id = "gMid";
  g.appendChild(mid);
})();
function monthStats() {
  let km = 0, lit = 0, imp = 0;
  (sheet.rows || []).forEach(x => {
    if (x.kmIni !== "" && x.kmFin !== "" && x.kmFin >= x.kmIni) km += x.kmFin - x.kmIni;
    if (x.litros !== "") lit += +x.litros || 0;
    if (x.importe !== "") imp += +x.importe || 0;
  });
  return { km, lit, imp, rend: lit > 0 ? km / lit : null };
}
function renderCluster() {
  let t = { km: 0, stops: [], active: false, points: 0 };
  try { t = JSON.parse(A.track(day.date)); } catch (e) {}
  const km = day.stage === "idle" || day.stage === "rest" ? 0 : (t.km || 0);
  const scales = [50, 100, 200, 300, 500, 800, 1200];
  const max = scales.find(s => s >= km * 1.1) || scales[scales.length - 1];
  const pct = Math.max(0, Math.min(1, km / max));
  $("gMax").textContent = max; $("gMid").textContent = max / 2;
  $("arcFill").setAttribute("stroke-dasharray", (pct * 100).toFixed(2) + " 100");
  $("arcFill").style.opacity = pct > 0.005 ? 1 : 0;
  $("needle").style.transform = "rotate(" + (-90 + pct * 180) + "deg)";
  $("gKm").textContent = fmt(km, 1);
  // odómetro: km del inicio del tramo + GPS del tramo
  let odo = null;
  const ini = num(day.entry.kmIni);
  if (day.stage === "running" && ini !== null) { const tk = tramoKm(); odo = ini + (tk || 0); }
  else if (day.stage === "closed") odo = num(day.entry.kmFin) ?? ini;
  else odo = ini ?? lastKnownKm();
  drums($("gEst"), odo, 6, true);
  $("gStops").textContent = day.stage === "idle" ? "0" : String(t.stops.length);
  if (day.startedAt && day.stage === "running") { const m = Math.max(0, Math.round((Date.now() - day.startedAt) / 60000)); $("gTime").textContent = Math.floor(m / 60) + "h " + pad(m % 60); }
  else $("gTime").textContent = "—";
  const ms = monthStats();
  $("gRend").innerHTML = ""; if (ms.rend !== null) { $("gRend").append(fmt(ms.rend, 1)); $("gRend").appendChild(el("small", "", " km/L")); } else $("gRend").textContent = "—";
  const st = $("gStatus"); st.className = "status"; st.textContent = "";
  if (day.stage === "running") {
    if (!t.active) { st.className = "status warn"; st.textContent = "La grabación del GPS está detenida"; }
    else if (t.last && Date.now() - t.last.t > 5 * 60000) { st.className = "status warn"; st.textContent = "Sin señal de GPS desde las " + hm(t.last.t); }
    else { st.append("Grabando GPS"); if (t.last) { st.append(" · último punto "); st.appendChild(el("b", "", hm(t.last.t))); } }
  } else if (cfg.armed) st.textContent = "Esperando la salida del domicilio para grabar";
  else if (day.stage === "idle") st.textContent = home() ? "Toma la foto del odómetro o arma la salida automática" : "Toma la foto del odómetro para arrancar";
  else if (day.stage === "closed") st.textContent = "Jornada cerrada · " + fmt(t.km || 0, 1) + " km por GPS";
  else if (day.stage === "rest") st.textContent = "Día de descanso";
}

// ---------- tramos del día ----------
let armedStop = -1;
function renderTrack() {
  renderCluster();
  updateCompare();
  if (day.stage !== "running") return;
  const t = JSON.parse(A.track(day.date));
  const ini = num(day.entry.kmIni);
  const tk = tramoKm();
  $("gIni").textContent = "Tramo " + (day.done.length + 1) + (day.row ? " · fila " + day.row : "") + (ini !== null ? " · desde km " + fmt(ini) : "") + ". Cada parada de " + cfg.stopMinutes + " min dentro de " + cfg.stopRadius + " m agrega un registro.";
  $("runSince").textContent = day.startedAt ? "desde las " + hm(day.startedAt) : "";
  $("btnArriveHome").hidden = !home();
  const list = $("stopList"); list.textContent = "";
  // salida
  const first = day.done[0] ? day.done[0].entry : day.entry;
  const s0 = el("div", "leg start");
  const a0 = el("div", "a"); a0.append(el("div", "ttl", "Salida · " + (first.de || "inicio")), el("div", "hint", "km " + (first.kmIni ? fmt(num(first.kmIni)) : "—")));
  s0.append(el("span", "n", "S"), a0, el("span", "m", day.startedAt ? hm(day.startedAt) : ""));
  list.appendChild(s0);
  t.stops.forEach((s, i) => {
    const st = day.stopsDone[s.start];
    const atHome = isHomeText(s.address);
    const r = el("div", "leg" + (atHome ? " home" : ""));
    const a = el("div", "a");
    const t1 = el("div", "ttl", s.address || coordStr(s.lat, s.lon));
    if (s.manual) t1.appendChild(el("span", "tag", "manual"));
    a.append(t1, el("div", "hint", coordStr(s.lat, s.lon)));
    if (st && st.row) {
      const info = el("div", "hint"); info.append("Fila " + st.row + " · ");
      info.appendChild(el("span", "km", "km " + fmt(st.km)));
      info.appendChild(el("span", "tag" + (st.confirmed ? " ok" : ""), st.confirmed ? "foto ✓" : "estimado GPS"));
      a.appendChild(info);
      const dn = day.done.find(d => d.row === st.row);
      const asu = dn && dn.entry ? dn.entry.asunto : "";
      a.appendChild(el("div", "hint", asu ? "Asunto: " + asu : "Sin asunto"));
      if (!st.confirmed || !asu) { const f = el("button", "small " + (asu ? "ghost" : "primary"), asu ? "Confirmar km con foto" : "Agregar asunto"); f.style.marginTop = "6px"; f.onclick = () => openConfirm(s, i, st.row, st.km); a.appendChild(f); }
    }
    else if (st && st.ignored) a.appendChild(el("div", "hint", "No fue parada (sin registro)"));
    else if (registering) a.appendChild(el("div", "hint", "Guardando registro…"));
    else { const f = el("button", "small primary", "Registrar parada"); f.style.marginTop = "6px"; f.onclick = autoRegisterPending; a.appendChild(f); }
    const m = el("span", "m", hm(s.start) + (s.open ? " · ahora" : "–" + hm(s.end)) + "\n" + s.minutes + " min");
    const x = el("button", "x" + (armedStop === i ? " armed" : ""), armedStop === i ? "¿Borrar?" : "✕");
    x.setAttribute("aria-label", "Borrar parada " + (i + 1));
    x.onclick = () => { if (armedStop !== i) { armedStop = i; renderTrack(); return; } armedStop = -1; A.removeStop(day.date, i); setTimeout(renderTrack, 400); };
    const mm = el("div"); mm.style.cssText = "display:grid;gap:6px;justify-items:end"; mm.append(m, x);
    r.append(el("span", "n", String(i + 1)), a, mm);
    list.appendChild(r);
  });
  // tramo en curso
  const cur = el("div", "leg");
  const ac = el("div", "a"); ac.append(el("div", "ttl", "En camino"), el("div", "hint", t.stops.length ? "Desde " + (day.entry.de || "la última parada") : "Las paradas se registran solas al quedarte " + cfg.stopMinutes + " min dentro de " + cfg.stopRadius + " m."));
  const est = ini !== null && tk !== null ? "≈ " + fmt(Math.round(ini + tk)) + " km" : "";
  cur.append(el("span", "n", "›"), ac, el("span", "m", (tk !== null ? fmt(tk, 1) + " km" : "") + (est ? "\n" + est : "")));
  list.appendChild(cur);
  const w = $("gpsWarn");
  if (!t.active) { w.hidden = false; w.textContent = "La grabación del recorrido está detenida. "; const b = el("button", "small primary", "Reanudar"); b.onclick = startTracking; w.appendChild(b); }
  else w.hidden = true;
}

// ---------- paradas: cada una es un registro ----------
function pendingStops() { try { return JSON.parse(A.track(day.date)).stops.map((s, i) => ({ s, i })).filter(o => !day.stopsDone[o.s.start]); } catch (e) { return []; } }
function updateStopModal() {}
async function closeTramo(s, km, a, aC, asunto, slots, gpsTo) {
  day.entry = Object.assign({}, day.entry, { kmFin: String(km), a, aC, asunto });
  const sl = slots.map(x => ({ slot: x }));
  const r = await saveRow(sl);
  const g = A.trackKm(day.date, day.tramoStart || 0, gpsTo || s.end || Date.now());
  const prev = { start: day.tramoStart, cargaSaved: day.cargaSaved };
  rowGps[day.entry.fTras + "|" + r.row] = g; save(RGKEY, rowGps);
  day.done.push({ row: r.row, de: day.entry.de, a, km: km - (num(day.entry.kmIni) || km), gps: g, entry: Object.assign({}, day.entry), prev, stop: s.start });
  day.stopsDone[s.start] = { row: r.row, km, confirmed: slots.length > 0 };
  // el siguiente tramo sale de esta parada con el km de este registro
  slots.concat(["ini"]).forEach(k => { delete day.photos[k]; A.clearPhoto(k); });
  // el asunto se captura en cada parada; el tramo siguiente empieza sin asunto
  day.entry = { fTras: day.date, kmIni: String(km), de: a, deC: aC, asunto: "" };
  day.row = null; day.tramoStart = gpsTo || s.end || Date.now(); day.cargaSaved = false;
  A.setConfig(JSON.stringify({ lastKm: km }));
  persist(); render();
  loadSheet();
  return r.row;
}
let registering = false;
async function autoRegisterPending() {
  if (day.stage !== "running" || registering) return;
  const pend = pendingStops();
  if (!pend.length) return;
  if (num(day.entry.kmIni) === null) { if ($("modal").hidden) openIniConfirm(true); return; }
  registering = true; renderTrack();
  let last = null;
  try {
    for (const o of pend) {
      const s = o.s, ini = num(day.entry.kmIni);
      const tk = A.trackKm(day.date, day.tramoStart || 0, s.start);
      const km = Math.round(ini + (tk || 0));
      const atHome = isHomeText(s.address) || nearHome(s.lat, s.lon);
      const a = atHome ? homeLabel() : (s.address || coordStr(s.lat, s.lon));
      const aC = atHome ? homeCoords() : coordStr(s.lat, s.lon);
      const row = await closeTramo(s, km, a, aC, atHome ? "Regreso a domicilio" : "", [], s.start);
      last = { s, i: o.i, row, km, atHome };
    }
  } catch (e) {
    banner("bad", "La parada quedó en el recorrido, pero no se guardó en la hoja", e.message + ". Se reintentará al volver a abrir la app.", [{ label: "Reintentar ahora", cls: "primary", run: autoRegisterPending }], "regfail");
  } finally { registering = false; renderTrack(); }
  if (last && last.atHome) { banner("alert", "Llegaste al domicilio", "Fila " + last.row + " con km estimado " + fmt(last.km) + ". Toma la foto del odómetro para cerrar la jornada con el km real.", [{ label: "Cerrar jornada", cls: "primary", run: goEnd }], "a-home"); autoFill("a", homeLabel()); autoFill("aC", homeCoords()); }
  else if (last && $("modal").hidden) { showTab("hoy"); openConfirm(last.s, last.i, last.row, last.km); }
}

$("btnAddStop").onclick = async () => {
  const b = $("btnAddStop"); b.disabled = true; b.textContent = "Ubicando…";
  const r = await nat("addStop", day.date);
  b.disabled = false; b.textContent = "+ Parada aquí";
  if (!r.ok) { banner("bad", "No se agregó la parada", r.error); return; }
  await new Promise(res => setTimeout(res, 700));
  b.disabled = true; b.textContent = "Guardando…";
  try { await autoRegisterPending(); } finally { b.disabled = false; b.textContent = "+ Parada aquí"; }
};

// Asunto de cada parada (con los usados recientemente a un toque) y fotos para confirmar el km real
const AKEY = "bitacora-asuntos";
function rememberAsunto(t) { t = String(t || "").trim(); if (!t || /^Regreso a domicilio$/i.test(t)) return; const l = load(AKEY, []).filter(x => x.toLowerCase() !== t.toLowerCase()); l.unshift(t); save(AKEY, l.slice(0, 6)); }
function openConfirm(s, i, row, kmEst) {
  const kp = "p" + s.start, kl = "l" + s.start;
  const done = day.done.find(d => d.row === row);
  openModal(sh => {
    sh.appendChild(el("h2", "", "Parada " + (i + 1) + " · fila " + row));
    sh.appendChild(el("p", "hint", (s.address || coordStr(s.lat, s.lon)) + " · desde las " + hm(s.start) + ". ¿A qué viniste? El asunto queda en esta fila de la bitácora."));
    const ls = el("label", "", "Asunto de la parada"); const is = el("input"); is.placeholder = "Supervisión de OS, soporte en campo, junta…"; is.value = done ? done.entry.asunto || "" : ""; ls.appendChild(is);
    const recent = load(AKEY, []);
    const chips = el("div", "chips");
    recent.forEach(t => { const b = el("button", "chip", t); b.style.fontFamily = "var(--body)"; b.onclick = () => { is.value = t; is.classList.add("auto"); chips.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === b)); }; chips.appendChild(b); });
    sh.append(ls); if (recent.length) sh.appendChild(chips);
    sh.appendChild(el("p", "hint", "Km estimado por GPS: " + fmt(kmEst) + ". Toma la foto del odómetro para corregirlo con el km real; el siguiente tramo arranca con ese km."));
    const d1 = el("div"); d1.id = "shot-" + kp; const d2 = el("div"); d2.id = "shot-" + kl; sh.append(d1, d2);
    const lab = el("label", "", "Km real en esta parada"); const inp = el("input", "num"); inp.id = "m_km"; inp.type = "number"; inp.value = kmEst; inp.oninput = () => inp.classList.remove("auto", "bad"); lab.appendChild(inp);
    const la = el("label", "", "Llega a"); const ia = el("input"); ia.id = "m_a"; ia.value = done ? done.entry.a : ""; la.appendChild(ia);
    const lc = el("label", "", "Coordenadas"); const ic = el("input", "num"); ic.id = "m_aC"; ic.value = done ? done.entry.aC : ""; lc.appendChild(ic);
    sh.append(lab, la, lc);
    const err = el("div", "err"); err.hidden = true; sh.appendChild(err);
    const act = el("div", "actions");
    const ok = el("button", "primary", "Guardar parada en la fila " + row), later = el("button", "ghost", "Después");
    ok.onclick = async () => {
      const km = num(inp.value);
      if (km === null || !done) { inp.classList.add("bad"); return; }
      if (num(done.entry.kmIni) !== null && km < num(done.entry.kmIni)) { inp.classList.add("bad"); err.textContent = "El km no puede ser menor al inicial del tramo (" + fmt(num(done.entry.kmIni)) + ")."; err.hidden = false; return; }
      ok.disabled = true; ok.textContent = "Subiendo fotos…";
      try {
        const entry = Object.assign({}, done.entry, { kmFin: String(km), a: ia.value.trim(), aC: ic.value.trim(), asunto: is.value.trim() });
        rememberAsunto(entry.asunto);
        const slots = [kp, kl].filter(k => day.photos[k] && day.photos[k].preview && !day.photos[k].uploaded).map(k => ({ slot: k }));
        const res = await call("save", { row, entry, photoSlots: slots });
        if (!res.ok) throw new Error(res.error);
        slots.forEach(x => { delete day.photos[x.slot]; A.clearPhoto(x.slot); });
        done.entry = entry; done.km = km - (num(entry.kmIni) || km); done.a = entry.a;
        day.stopsDone[s.start].km = km; day.stopsDone[s.start].confirmed = day.stopsDone[s.start].confirmed || slots.some(x => x.slot === kp);
        // el registro siguiente toma este km como inicial
        const idx = day.done.indexOf(done);
        const next = day.done[idx + 1];
        if (next) {
          const ne = Object.assign({}, next.entry, { kmIni: String(km), de: entry.a, deC: entry.aC });
          const r2 = await call("save", { row: next.row, entry: ne, photoSlots: [] });
          if (r2.ok) { next.entry = ne; next.km = num(ne.kmFin) - km; }
        } else { day.entry.kmIni = String(km); day.entry.de = entry.a; day.entry.deC = entry.aC; if (day.row) await saveRow([]); }
        A.setConfig(JSON.stringify({ lastKm: km }));
        persist(); render(); closeModal(); loadSheet();
        banner("ok", "Fila " + row + " actualizada", "Km " + fmt(km) + (slots.length ? " y fotos en Drive." : "."), null, "ok");
      } catch (e) { err.textContent = e.message; err.hidden = false; ok.disabled = false; ok.textContent = "Reintentar"; }
    };
    later.onclick = closeModal;
    act.append(ok, later);
    if (day.done[day.done.length - 1] === done) {
      const undo = el("button", "danger", "No fue parada: quitar fila " + row);
      let armed = false;
      undo.onclick = async () => {
        if (!armed) { armed = true; undo.textContent = "Toca otra vez para quitar la fila " + row; return; }
        undo.disabled = true;
        const res = await call("delete", { row });
        if (!res.ok) { err.textContent = res.error; err.hidden = false; undo.disabled = false; return; }
        const e = done.entry;
        day.entry = Object.assign({}, e, { kmFin: "", a: "", aC: "" });
        day.row = null; day.tramoStart = done.prev ? done.prev.start : day.tramoStart; day.cargaSaved = done.prev ? done.prev.cargaSaved : false;
        day.done.pop(); day.stopsDone[s.start] = { ignored: true };
        persist(); render(); closeModal(); loadSheet();
        banner("ok", "Fila " + row + " quitada", "El tramo sigue abierto desde " + (e.de || "el inicio") + ".", null, "ok");
      };
      act.appendChild(undo);
    }
    sh.appendChild(act);
  });
  drawShot(kp); drawShot(kl);
}
function updateCompare() {
  const ini = num($("kmIni").value), fin = num($("kmFin").value);
  const odo = ini !== null && fin !== null ? fin - ini : null;
  const gps = day.stage === "running" || day.stage === "idle" ? tramoKm() : gpsKm(day.date);
  $("cOdo").textContent = odo !== null ? fmt(odo) + " km" : "—";
  $("cGps").textContent = gps !== null ? fmt(gps, 1) + " km" : "—";
  const dif = $("cDif");
  if (odo !== null && gps !== null) {
    const d = odo - gps, pct = gps > 0 ? Math.abs(d) / gps * 100 : 0;
    dif.textContent = (d > 0 ? "+" : "") + fmt(d, 1) + " km";
    dif.className = "v" + (pct > 15 && Math.abs(d) > 3 ? " warn" : "");
  } else { dif.textContent = "—"; dif.className = "v"; }
  $("btnUseGps").hidden = !(day.stage === "running" && fin === null && ini !== null && gps !== null && gps > 0);
}
$("btnUseGps").onclick = () => { const ini = num($("kmIni").value), gps = tramoKm(); if (ini === null || gps === null) return; autoFill("kmFin", Math.round(ini + gps)); updateOdo(); };
setInterval(renderTrack, 30000);

// ---------- hoja ----------
async function loadSheet() {
  if (!cfg.scriptUrl) return;
  const r = await call("read");
  if (!r.ok) { banner("bad", "No se pudo leer la hoja", r.error, [{ label: "Reintentar", cls: "primary", run: loadSheet }], "readfail"); return; }
  sheet = r; sheet.loaded = true;
  const h = r.header || {};
  $("vMes").value = h.mes || ""; $("vUser").value = h.usuario || ""; $("vPlacas").value = h.placas || ""; $("vTag").value = h.tag || "";
  if (h.placas && h.placas !== cfg.plates) { A.setConfig(JSON.stringify({ plates: h.placas })); cfg.plates = h.placas; }
  if (r.lastKm !== null && r.lastKm !== undefined) A.setConfig(JSON.stringify({ lastKm: r.lastKm }));
  $("plate").hidden = !h.placas; $("plate").textContent = h.placas || "";
  $("who").textContent = [h.mes, h.usuario].filter(Boolean).join(" · ") || cfg.name;
  if (day.stage === "idle" && !has(day.entry.kmIni) && r.lastKm !== null) { $("kmIni").value = r.lastKm; syncEntry(); updateOdo(); }
  renderList(); renderGap(); renderCluster();
}
function renderList() {
  const rows = sheet.rows || [];
  $("capacity").textContent = rows.length + " registros";
  const ms = monthStats();
  $("mKm").textContent = fmt(ms.km); $("mLit").textContent = fmt(ms.lit, 2); $("mImp").textContent = fmt(ms.imp, 2); $("mRend").textContent = ms.rend !== null ? fmt(ms.rend, 2) : "—";
  const list = $("list"); list.textContent = "";
  if (!rows.length) list.appendChild(el("div", "empty", "Todavía no hay registros este mes."));
  rows.slice().reverse().forEach(x => {
    const rest = /DESCANSO/i.test(x.asunto), adj = /^AJUSTE/i.test(x.asunto);
    const b = el("button", "rec" + (rest ? " restday" : "") + (adj ? " adj" : ""));
    const t = el("span", "t"); t.append(el("b", "", x.asunto || "Sin asunto"), el("span", "", rest ? "Sin movimiento" : (x.de || "—") + " → " + (x.a || "—")));
    const km = x.kmIni !== "" && x.kmFin !== "" ? fmt(x.kmFin - x.kmIni) + " km" : "abierto";
    const m = el("span", "m", km);
    const g = !rest ? rowGps[x.fTras + "|" + x.r] ?? null : null;
    if (g !== null) { m.appendChild(el("br")); m.appendChild(el("span", "hint", "GPS " + fmt(g, 1))); }
    if (x.importe) { m.appendChild(el("br")); m.appendChild(el("span", "fuelchip", money(x.importe) + " · " + fmt(x.litros, 1) + " L")); }
    const d = el("span", "d"); d.appendChild(el("b", "", x.fTras ? x.fTras.slice(8, 10) : "—")); d.append(x.fTras ? MESES[+x.fTras.slice(5, 7) - 1].slice(0, 3) : ""); d.appendChild(el("br")); d.append("f" + x.r);
    b.append(d, t, m);
    b.onclick = () => editRow(x);
    list.appendChild(b);
  });
  renderDays();
}
function renderDays() {
  const month = (day.date || today()).slice(0, 7);
  $("kmlMonth").textContent = MESES[+month.slice(5, 7) - 1] + " " + month.slice(0, 4);
  let days = []; try { days = JSON.parse(A.monthDays(month)); } catch (e) {}
  const box = $("dayList"); box.textContent = "";
  if (!days.length) { box.appendChild(el("div", "empty", "Aún no hay recorridos grabados este mes.")); return; }
  days.slice().reverse().forEach(d => {
    const r = el("div", "daykml");
    const t = el("div"); t.append(el("div", "", fechaLarga(d.date)), el("div", "m", fmt(d.km, 1) + " km · " + d.stops + " paradas"));
    const e = el("button", "ghost small", "Earth"); e.onclick = () => A.earthScope(d.date);
    const k = el("button", "ghost small", "KML"); k.onclick = () => shareKml(d.date);
    r.append(t, e, k); box.appendChild(r);
  });
}
$("btnReload").onclick = loadSheet;
$("btnMonthKml").onclick = () => shareKml((day.date || today()).slice(0, 7));
$("btnMonthEarth").onclick = () => A.earthScope((day.date || today()).slice(0, 7));

// Corrección de una fila existente
function editRow(x) {
  openModal(sh => {
    sh.appendChild(el("h2", "", "Fila " + x.r));
    const f = {};
    const mk = (k, label, type, cls) => { const l = el("label", "", label); const i = el("input", cls || ""); i.type = type || "text"; i.value = x[k] ?? ""; i.id = "e_" + k; f[k] = i; l.appendChild(i); return l; };
    const g1 = el("div", "grid"); g1.append(mk("fTras", "Fecha traslado", "date"), mk("kmIni", "Km inicial", "number", "num"), mk("kmFin", "Km final", "number", "num"));
    const g2 = el("div", "grid"); g2.append(mk("de", "De"), mk("deC", "Coordenadas de", "text", "num"));
    const g3 = el("div", "grid"); g3.append(mk("a", "A"), mk("aC", "Coordenadas a", "text", "num"));
    const g4 = el("div", "grid"); g4.append(mk("fCarga", "Fecha carga", "date"), mk("importe", "Importe", "number", "num"), mk("litros", "Litros", "number", "num"));
    const g5 = el("div", "grid"); g5.append(mk("ticket", "# Ticket o folio"), mk("factura", "No. factura"));
    sh.append(g1, mk("asunto", "Asunto"), g2, g3, el("h3", "", "Carga"), g4, g5);
    const err = el("div", "err"); err.hidden = true; sh.appendChild(err);
    const act = el("div", "actions");
    const ok = el("button", "primary", "Guardar cambios"), del = el("button", "danger", "Borrar fila"), cancel = el("button", "ghost", "Cancelar");
    cancel.onclick = closeModal;
    ok.onclick = async () => {
      const entry = {}; ROWF.forEach(k => entry[k] = f[k].value.trim());
      if (num(entry.kmFin) !== null && num(entry.kmIni) !== null && num(entry.kmFin) < num(entry.kmIni)) { err.textContent = "El km final no puede ser menor que el inicial."; err.hidden = false; return; }
      ok.disabled = true; ok.textContent = "Guardando…";
      const r = await call("save", { row: x.r, entry, photoSlots: [], keepCarga: true });
      if (!r.ok) { err.textContent = r.error; err.hidden = false; ok.disabled = false; ok.textContent = "Guardar cambios"; return; }
      closeModal(); banner("ok", "Fila " + x.r + " actualizada", "", null, "ok"); loadSheet();
    };
    let armed = false;
    del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = "Toca otra vez para borrar"; return; }
      del.disabled = true;
      const r = await call("delete", { row: x.r });
      closeModal();
      if (!r.ok) banner("bad", "No se borró", r.error); else { banner("ok", "Fila " + x.r + " borrada", "", null, "ok"); if (day.row === x.r) { day = freshDay(); persist(); render(); } loadSheet(); }
    };
    act.append(ok, del, cancel); sh.appendChild(act);
  });
}

function openModal(build) { const s = $("sheet"); s.textContent = ""; build(s); $("modal").hidden = false; s.scrollTop = 0; }
function closeModal() { $("modal").hidden = true; $("sheet").textContent = ""; }
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });

// ---------- ajustes ----------
const DAYN = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const toTime = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
const fromTime = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + m; };
function renderHome() {
  const h = home();
  $("homeState").className = "homebox" + (h ? "" : " none");
  $("homeTitle").textContent = h ? (h.address || "Domicilio guardado") : "Sin definir";
  $("homeText").textContent = h ? coordStr(h.lat, h.lon) + " · radio " + (cfg.stopRadius || 150) + " m" : "Cada día el primer tramo sale del domicilio y el último llega a él.";
  $("btnHome").textContent = h ? "Actualizar con mi ubicación" : "Usar mi ubicación actual";
  $("homeHint").hidden = !!h || day.stage !== "idle" || !cfg.scriptUrl;
}
function renderSettings() {
  $("sStart").value = toTime(cfg.startAt); $("sEnd").value = toTime(cfg.endAt); $("sStop").value = cfg.stopMinutes; $("sRadius").value = cfg.stopRadius;
  $("sAuto").checked = !!cfg.autoStart;
  $("sName").value = cfg.name; $("sUrl").value = cfg.scriptUrl;
  const d = $("sDays"); d.textContent = "";
  DAYN.forEach((n, i) => { const l = el("label"); const c = el("input"); c.type = "checkbox"; c.id = "day" + i; c.checked = !!((cfg.workDays >> i) & 1); l.append(c, document.createTextNode(n)); d.appendChild(l); });
  renderPerms(); renderHome();
}
async function setHomeHere(btn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "Ubicando…";
  const r = await nat("setHomeHere");
  btn.disabled = false; btn.textContent = old;
  if (!r.ok) { banner("bad", "No se guardó el domicilio", r.error); return; }
  cfg = JSON.parse(A.config()); renderHome();
  if (day.stage === "idle" && (!has(day.entry.de) || isHomeText(day.entry.de))) { day.entry.de = homeLabel(); day.entry.deC = homeCoords(); persist(); fillForm(); }
  banner("ok", "Domicilio guardado", (r.address || "") + " · " + coordStr(r.lat, r.lon), null, "ok");
  render();
}
$("btnHome").onclick = () => setHomeHere($("btnHome"));
$("btnHomeHere").onclick = () => setHomeHere($("btnHomeHere"));
$("btnHomeEdit").onclick = () => {
  openModal(sh => {
    sh.append(el("h2", "", "Domicilio particular"), el("p", "hint", "Pega las coordenadas (por ejemplo desde Google Maps, manteniendo presionado sobre tu casa)."));
    const lc = el("label", "", "Coordenadas"); const ic = el("input", "num"); ic.placeholder = "19.829600, -99.207200"; ic.value = homeCoords(); lc.appendChild(ic);
    const la = el("label", "", "Dirección (opcional)"); const ia = el("input"); ia.value = home() ? home().address || "" : ""; la.appendChild(ia);
    const err = el("div", "err"); err.hidden = true;
    const act = el("div", "actions"); const ok = el("button", "primary", "Guardar"); const no = el("button", "ghost", "Cancelar"); no.onclick = closeModal;
    ok.onclick = async () => {
      const c = parseCoords(ic.value); if (!c) { ic.classList.add("bad"); err.textContent = "Escribe latitud y longitud separadas por coma."; err.hidden = false; return; }
      let addr = ia.value.trim();
      if (!addr) { ok.disabled = true; ok.textContent = "Buscando dirección…"; const g = await nat("geocode", c.lat, c.lon); addr = g.address || ""; }
      A.setConfig(JSON.stringify({ home: { lat: c.lat, lon: c.lon, address: addr } })); cfg = JSON.parse(A.config());
      closeModal(); renderHome(); render();
      banner("ok", "Domicilio guardado", addr || coordStr(c.lat, c.lon), null, "ok");
    };
    act.append(ok, no); sh.append(lc, la, err, act);
  });
};
function renderPerms() {
  const p = cfg.perms || JSON.parse(A.config()).perms;
  const box = $("perms"); box.textContent = "";
  const row = (label, ok, fix, fixLabel) => {
    const r = el("div", "perm"); r.appendChild(el("span", "", label));
    if (ok) r.appendChild(el("span", "s y", "Listo"));
    else { const b = el("button", "small primary", fixLabel || "Activar"); b.onclick = fix; r.appendChild(b); }
    box.appendChild(r);
  };
  row("Ubicación precisa", p.location, () => nat("permissions").then(x => { cfg.perms = x; renderPerms(); }));
  row("Ubicación todo el tiempo (salida automática)", p.background, () => A.backgroundLocation(), "Permitir");
  row("Notificaciones y alertas", p.notifications, () => nat("permissions").then(x => { cfg.perms = x; renderPerms(); }));
  row("Funcionar con pantalla apagada (batería sin restricción)", p.battery, () => A.battery());
  row("Alarmas a la hora exacta", p.exactAlarm, () => A.exactAlarms());
  if (!p.location || !p.notifications || !p.background) row("Si negaste un permiso", false, () => A.appSettings(), "Abrir ajustes");
}
$("btnTest").onclick = () => { A.testAlert(); beep(); };
$("btnSaveSettings").onclick = async () => {
  let wd = 0; DAYN.forEach((n, i) => { if ($("day" + i).checked) wd |= 1 << i; });
  const c = { startAt: fromTime($("sStart").value), endAt: fromTime($("sEnd").value), stopMinutes: Math.max(2, Math.min(30, +$("sStop").value || 7)),
    stopRadius: Math.max(50, Math.min(500, +$("sRadius").value || 150)), autoStart: $("sAuto").checked,
    workDays: wd, name: $("sName").value.trim() || "Asbai Jimenez", scriptUrl: $("sUrl").value.trim(), plates: $("vPlacas").value.trim() };
  A.setConfig(JSON.stringify(c)); cfg = JSON.parse(A.config());
  const h = { mes: $("vMes").value.trim(), usuario: $("vUser").value.trim(), placas: $("vPlacas").value.trim(), tag: $("vTag").value.trim() };
  const b = $("btnSaveSettings"); b.disabled = true; b.textContent = "Guardando…";
  const r = cfg.scriptUrl ? await call("header", h) : { ok: true };
  b.disabled = false; b.textContent = "Guardar ajustes";
  renderConn(); renderHome();
  if (r.ok) { banner("ok", "Ajustes guardados", "Paradas de " + cfg.stopMinutes + " min dentro de " + cfg.stopRadius + " m. Alertas a las " + toTime(cfg.startAt) + " y " + toTime(cfg.endAt) + ". Los cambios de paradas aplican al siguiente arranque.", null, "ok"); render(); loadSheet(); }
  else banner("bad", "Los ajustes se guardaron en el teléfono, pero no en la hoja", r.error);
};

// Primera vez
$("cfgSave").onclick = async () => {
  const u = $("cfgUrl").value.trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { banner("bad", "Dirección no válida", "Debe empezar con https://script.google.com/ y terminar en /exec."); return; }
  A.setConfig(JSON.stringify({ scriptUrl: u })); cfg = JSON.parse(A.config());
  const b = $("cfgSave"); b.disabled = true; b.textContent = "Probando…";
  const r = await call("ping");
  b.disabled = false; b.textContent = "Probar y guardar";
  if (!r.ok) { banner("bad", "No hubo respuesta correcta del servicio", r.error); return; }
  banner("ok", "Conectado a tu hoja", home() ? "Listo para arrancar." : "Ahora guarda la ubicación de tu domicilio.", null, "ok");
  $("sUrl").value = cfg.scriptUrl; renderConn(); render(); showTab("hoy"); loadSheet(); nat("permissions").then(x => { cfg.perms = x; renderPerms(); });
};

// ---------- recordatorios dentro de la app ----------
function checkReminders() {
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const work = !!((cfg.workDays >> now.getDay()) & 1);
  if (!work || day.stage === "rest") return;
  if (day.stage === "idle" && !cfg.armed && mins >= cfg.startAt) showAlert("start", "Aún no registras el inicio de jornada", "Toma la foto del odómetro al salir, arma la salida automática o marca el día como descanso.");
  if (day.stage === "running" && mins >= cfg.endAt) showAlert("end", "Ya es hora de cerrar la jornada", "Toma la foto del odómetro al llegar.");
  if (day.stage === "running" && day.date !== today()) showAlert("end", "La jornada del " + fechaLarga(day.date) + " sigue abierta", "Ciérrala con la foto del odómetro.");
}

// ---------- pintar ----------
function render() {
  const ready = !!cfg.scriptUrl;
  $("setup").hidden = ready;
  $("stepStart").hidden = !ready || day.stage !== "idle";
  $("stepRun").hidden = !ready || day.stage !== "running";
  $("stepDone").hidden = !ready || !(day.stage === "closed" || day.stage === "rest");
  const armed = day.stage === "idle" && cfg.armed;
  $("armBox").hidden = !armed;
  $("btnArm").hidden = armed;
  $("btnArm").textContent = home() ? "Grabar al salir de casa" : "Grabar al salir de casa (define domicilio)";
  if (day.stage === "idle" && home() && !has(day.entry.de)) { day.entry.de = homeLabel(); day.entry.deC = homeCoords(); }
  const pill = $("dayPill");
  const P = armed ? ["armed", "Esperando salida"] : { idle: ["idle", "Sin iniciar"], running: ["run", "Grabando"], closed: ["closed", "Día cerrado"], rest: ["rest", "Descanso"] }[day.stage];
  pill.className = "pill " + P[0]; pill.textContent = P[1];
  $("startWhen").textContent = fechaLarga(day.date);
  if (day.stage === "closed") {
    $("doneTitle").textContent = "Día cerrado";
    const g = day.gpsKm ?? gpsKm(day.date);
    const odoTot = day.done.reduce((t, x) => t + (x.km || 0), 0);
    $("doneText").textContent = day.done.length + (day.done.length === 1 ? " tramo" : " tramos") + " · filas " + day.done.map(x => x.row).join(", ") + " · " + fmt(odoTot) + " km por odómetro" + (g !== null ? " · " + fmt(g, 1) + " km por GPS" : "") + (day.kml && day.kml.local ? " · KML en " + day.kml.local : "");
    $("btnEarth2").hidden = false; $("btnShareKml2").hidden = false; $("btnNewDay").hidden = false;
  }
  if (day.stage === "rest") {
    $("doneTitle").textContent = "Hoy es día de descanso";
    $("doneText").textContent = "Registrado en la fila " + day.row + ". No sonarán alertas hoy.";
    $("btnEarth2").hidden = true; $("btnShareKml2").hidden = true; $("btnNewDay").hidden = false;
  }
  ["ini", "fin", "ticket", "ticketCar", "odoCarga", "extra"].forEach(drawShot);
  if (day.stage === "running" && !$("aAsunto").value && isHomeText(day.entry.a)) $("aAsunto").value = "Regreso a domicilio";
  fillForm(); renderGap(); renderHome(); renderTrack();
}

// ---------- pestañas ----------
function showTab(t) {
  ["hoy", "reg", "aj"].forEach(k => { $("tab-" + k).hidden = k !== t; $("t-" + k).setAttribute("aria-selected", String(k === t)); });
  save("bitacora-tab", t); window.scrollTo(0, 0);
  if (t === "reg") renderList();
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
function renderConn() {
  $("connState").textContent = cfg.scriptUrl ? "Conectada. La app escribe en tu hoja “Bitácora Flotilla”." : "Sin conectar. Pega la dirección que termina en /exec.";
}
$("btnPing").onclick = async () => {
  const u = $("sUrl").value.trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { banner("bad", "Dirección no válida", "Debe empezar con https://script.google.com/ y terminar en /exec."); return; }
  A.setConfig(JSON.stringify({ scriptUrl: u })); cfg = JSON.parse(A.config());
  const b = $("btnPing"); b.disabled = true; b.textContent = "Probando…";
  const r = await call("ping");
  b.disabled = false; b.textContent = "Probar conexión";
  if (r.ok) { banner("ok", "Conexión correcta", "", null, "ok"); render(); loadSheet(); } else banner("bad", "La conexión falló", r.error);
  renderConn();
};

// ---------- arranque ----------
$("who").textContent = cfg.name;
renderSettings();
persist();
render();
renderConn();
showTab(cfg.scriptUrl ? (load("bitacora-tab", "hoy") || "hoy") : "hoy");
if (cfg.scriptUrl) { setTimeout(autoRegisterPending, 1500); loadSheet().then(checkDeparture); nat("permissions").then(x => { cfg.perms = x; renderPerms(); }); }
setTimeout(checkReminders, 800);
})();
