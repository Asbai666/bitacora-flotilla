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
const call = (action, payload) => nat("call", action, JSON.stringify(payload || {}));

// ---------- estado ----------
const DKEY = "bitacora-dia-v1";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let cfg = JSON.parse(A.config());
let sheet = { rows: [], header: {}, firstFree: null, lastKm: null, loaded: false };
const FIELDS = ["fTras", "kmIni", "kmFin", "asunto", "de", "deC", "a", "aC", "fCarga", "importe", "litros", "ticket", "factura"];
const ADJ = "AJUSTE DE ODÓMETRO · recorrido sin registro";

function freshDay() { return { date: today(), stage: "idle", row: null, entry: { fTras: today() }, photos: {}, cargaSaved: false, tramoStart: 0, stopsDone: {}, done: [], gapOff: false }; }
let day = load(DKEY, null);
if (!day || (day.date !== today() && day.stage !== "running")) day = freshDay();
day.stopsDone = day.stopsDone || {}; day.done = day.done || [];
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
// En pantallas de odómetro el reconocimiento confunde O→0, I/l→1, S→5, B→8, Z→2.
function fixDigits(tok) {
  const real = (tok.match(/\d/g) || []).length;
  if (real < 2) return tok;
  return tok.replace(/[OoQD]/g, "0").replace(/[Il|!]/g, "1").replace(/[Ss]/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G/g, "6");
}
function readOdometer(lines, lastKm) {
  const cands = [];
  lines.forEach(l => {
    const up = l.text.toUpperCase();
    if (/TRIP|ODO\s*B|RPM|°|:\d\d|\bA\b\s*\d|\bB\b\s*\d/.test(up) && !/ODO(?!\s*B)/.test(up)) return;   // parciales, reloj, temperatura
    const t = up.split(/\s+/).map(fixDigits).join(" ");
    (t.match(/\d[\d ,.]{1,9}\d/g) || []).forEach(raw => {
      if (/[.,]\d$/.test(raw.trim())) return;                // 1234.5 suele ser el parcial
      const digits = raw.replace(/[^\d]/g, "");
      if (digits.length < 3 || digits.length > 7) return;
      const v = parseInt(digits, 10);
      let score = (l.h || 10) + (/KM/.test(up) ? 25 : 0) + (/ODO/.test(up) ? 25 : 0) + (digits.length >= 5 ? 14 : 0) + digits.length * 2;
      if (lastKm) { if (v >= lastKm && v < lastKm + 2500) score += 70; else if (v < lastKm) score -= 45; else score -= 15; }
      cands.push({ v, score });
    });
  });
  cands.sort((a, b) => b.score - a.score);
  return cands.length ? cands[0].v : null;
}
function readTicket(lines) {
  const L = lines.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(l => l.text.toUpperCase());
  const out = {};
  const numIn = s => { const m = String(s).match(/\$?\s*(\d{1,3}(?:[,\s]\d{3})*|\d+)[.,](\d{2,3})\b/); return m ? parseFloat(m[1].replace(/[,\s]/g, "") + "." + m[2]) : null; };
  const near = (re, fn) => { for (let i = 0; i < L.length; i++) if (re.test(L[i])) { const v = fn(L[i].replace(re, " ")) ?? (L[i + 1] ? fn(L[i + 1]) : null); if (v !== null && v !== undefined) return v; } return null; };
  out.importe = near(/TOTAL\s*(A\s*PAGAR)?|IMPORTE|MONTO|PAGAR/, numIn);
  out.litros = near(/LITROS|LTS\.?|VOLUMEN|CANTIDAD/, numIn);
  if (out.litros === null) { for (const s of L) { const m = s.match(/(\d+[.,]\d{1,3})\s*(L|LT|LTS|LITROS)\b/); if (m) { out.litros = parseFloat(m[1].replace(",", ".")); break; } } }
  if (out.importe === null) { let best = null; L.forEach(s => { if (/\$/.test(s)) { const v = numIn(s); if (v !== null && (best === null || v > best)) best = v; } }); out.importe = best; }
  for (const s of L) {
    let m = s.match(/(20\d\d)[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) { out.fecha = m[1] + "-" + pad(m[2]) + "-" + pad(m[3]); break; }
    m = s.match(/(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?!\d)/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; const mo = +m[2], d = +m[1]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { out.fecha = y + "-" + pad(mo) + "-" + pad(d); break; } }
  }
  out.folio = near(/FOLIO|NO\.?\s*TICKET|TICKET|TRANSACCI[OÓ]N|TRANS\.?|TKT/, s => { const m = s.match(/[#:\s]*([A-Z0-9][A-Z0-9\-]{3,})/); return m && /\d/.test(m[1]) ? m[1] : null; });
  out.factura = near(/FACTURA/, s => { const m = s.match(/[#:\s]*([A-Z0-9][A-Z0-9\-]{3,})/); return m && /\d/.test(m[1]) ? m[1] : null; });
  return out;
}

// ---------- tarjetas de foto ----------
const SLOTS = {
  ini: { title: "Odómetro al salir", sub: "lee el km inicial" },
  fin: { title: "Odómetro al llegar", sub: "lee el km final" },
  ticket: { title: "Ticket de bomba", sub: "importe, litros y folio" },
  ticketCar: { title: "Ticket Car", sub: "comprobante (opcional)" },
  odoCarga: { title: "Odómetro en la carga", sub: "opcional, va a la evidencia" }
};
function slotInfo(slot) {
  if (SLOTS[slot]) return SLOTS[slot];
  if (slot[0] === "p") return { title: "Odómetro en la parada", sub: "lee el km de la parada" };
  if (slot[0] === "l") return { title: "Foto del lugar", sub: "hora y coordenadas" };
  return { title: slot, sub: "" };
}
function setModal(id, v) { const e = $(id); if (!e || v === null || v === undefined || v === "") return; e.value = v; e.classList.add("auto"); e.classList.remove("bad"); }
function autoFill(id, v) { if (v === null || v === undefined || v === "") return; $(id).value = v; $(id).classList.add("auto"); $(id).classList.remove("bad"); syncEntry(); }

function drawShot(slot) {
  const box = $("shot-" + slot); if (!box) return;
  const p = day.photos[slot]; box.textContent = "";
  const s = el("div", "shot" + (p && p.preview ? " has" : ""));
  const t = el("div", "t"); t.append(el("span", "", slotInfo(slot).title), el("span", "", slotInfo(slot).sub));
  s.appendChild(t);
  if (p && p.busy) s.appendChild(el("div", "hint", "Leyendo la foto…"));
  if (p && p.preview) {
    const img = el("img"); img.src = p.preview; img.alt = slotInfo(slot).title; s.appendChild(img);
    if (p.read) s.appendChild(el("div", "read", p.read));
    const kv = el("dl", "kv");
    const add = (k, v) => { kv.append(el("dt", "", k), el("dd", "", v)); };
    add("Fecha y hora", new Date(p.time).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) + (p.timeSource === "foto" ? "" : " *"));
    add("Coordenadas", coordStr(p.lat, p.lon) || "—");
    if (p.address) add("Lugar", p.address);
    s.appendChild(kv);
    if (p.timeSource !== "foto") s.appendChild(el("div", "hint", "* La foto no traía hora de captura; se usó la hora actual."));
    if (p.note) s.appendChild(el("div", "err", p.note));
    if (typeof p.lat !== "number") {
      const r = el("div", "actions");
      const here = el("button", "small primary", "Usar mi ubicación actual"); here.onclick = () => locateFor(slot);
      r.appendChild(here); s.appendChild(el("div", "hint", "La foto no trae ubicación. Agrégala para la marca de agua:")); s.appendChild(r);
    }
    if (p.uploaded) s.appendChild(el("div", "hint", "Subida a Drive ✓"));
  }
  const pick = el("div", "choice");
  const cam = el("button", "primary small", p && p.preview ? "Tomar otra" : "Tomar foto"); cam.onclick = () => takePhoto(slot, "camera");
  const gal = el("button", "ghost small", "De la galería"); gal.onclick = () => takePhoto(slot, "gallery");
  pick.append(cam, gal); s.appendChild(pick);
  box.appendChild(s);
}

async function takePhoto(slot, source) {
  const prev = day.photos[slot];
  day.photos[slot] = Object.assign({}, prev || {}, { busy: true }); drawShot(slot);
  const r = await nat("photo", slot, source);
  if (!r.ok) { if (prev) day.photos[slot] = prev; else delete day.photos[slot]; drawShot(slot); if (!r.cancelled) banner("bad", "No se pudo procesar la foto", r.error); return; }
  const p = { preview: r.preview, lat: r.lat, lon: r.lon, time: r.time, timeSource: r.timeSource, address: r.address || "", uploaded: false };
  const lines = r.lines || [];
  const atHome = nearHome(r.lat, r.lon);
  const place = atHome ? homeLabel() : r.address;
  if (slot === "ini" || slot === "fin" || slot === "odoCarga") {
    const ref = slot === "ini" ? lastKnownKm() : (num(day.entry.kmIni) ?? lastKnownKm());
    const km = readOdometer(lines, ref);
    p.read = km !== null ? fmt(km) + " km" : "";
    if (km === null) p.note = "No se distingue el odómetro; escribe el km o toma la foto más cerca y sin reflejos.";
    if (slot === "ini") {
      autoFill("kmIni", km); autoFill("fTras", isoOf(new Date(r.time)));
      if (atHome) { autoFill("de", homeLabel()); autoFill("deC", homeCoords()); }
      else { autoFill("deC", coordStr(r.lat, r.lon)); autoFill("de", r.address); }
      setModal("m_kmIni", km);
    }
    if (slot === "fin") {
      autoFill("kmFin", km);
      if (atHome) { autoFill("a", homeLabel()); autoFill("aC", homeCoords()); }
      else { autoFill("aC", coordStr(r.lat, r.lon)); autoFill("a", r.address); }
    }
  } else if (slot[0] === "p") {
    const st = day.stopsDone[Number(slot.slice(1))];
    const km = readOdometer(lines, st && st.km ? st.km : (num(day.entry.kmIni) ?? lastKnownKm()));
    p.read = km !== null ? fmt(km) + " km" : "";
    if (km === null) p.note = "No se distingue el odómetro; escribe el km o toma la foto más cerca.";
    setModal("m_km", km);
    const l = day.photos["l" + slot.slice(1)];
    if (!l || typeof l.lat !== "number") { setModal("m_aC", atHome ? homeCoords() : coordStr(r.lat, r.lon)); setModal("m_a", place); }
  } else if (slot[0] === "l") {
    setModal("m_aC", atHome ? homeCoords() : coordStr(r.lat, r.lon)); setModal("m_a", place);
  } else if (slot === "ticket") {
    const t = readTicket(lines);
    const bits = []; if (t.importe) bits.push(money(t.importe)); if (t.litros) bits.push(fmt(t.litros, 2) + " L"); if (t.folio) bits.push("folio " + t.folio);
    p.read = bits.join(" · ");
    if (!t.importe && !t.litros) p.note = "No pude leer importe ni litros; escríbelos.";
    autoFill("importe", t.importe); autoFill("litros", t.litros); autoFill("ticket", t.folio); autoFill("factura", t.factura);
    autoFill("fCarga", t.fecha || isoOf(new Date(r.time)));
  }
  day.photos[slot] = p; persist(); drawShot(slot); updateOdo(); updateStopModal(); renderGap(); updatePump(); renderCluster();
}

async function locateFor(slot) {
  const r = await nat("location");
  if (!r.ok) { banner("bad", "Sin ubicación", r.error); return; }
  const w = await nat("rewatermark", slot, r.lat, r.lon);
  if (!w.ok) { banner("bad", "No se pudo actualizar la foto", w.error); return; }
  Object.assign(day.photos[slot], { preview: w.preview, lat: r.lat, lon: r.lon, address: r.address || "", uploaded: false });
  const atHome = nearHome(r.lat, r.lon);
  if (slot === "ini") { autoFill("deC", atHome ? homeCoords() : coordStr(r.lat, r.lon)); autoFill("de", atHome ? homeLabel() : r.address); }
  if (slot === "fin") { autoFill("aC", atHome ? homeCoords() : coordStr(r.lat, r.lon)); autoFill("a", atHome ? homeLabel() : r.address); }
  if (slot[0] === "p" || slot[0] === "l") { setModal("m_aC", coordStr(r.lat, r.lon)); setModal("m_a", atHome ? homeLabel() : r.address); }
  persist(); drawShot(slot);
}

// ---------- formulario del día ----------
function fillForm() { FIELDS.forEach(k => { $(k).value = day.entry[k] ?? ""; }); updateOdo(); updatePump(); }
function syncEntry() { FIELDS.forEach(k => day.entry[k] = $(k).value.trim()); persist(); }
FIELDS.forEach(k => $(k).addEventListener("input", () => { $(k).classList.remove("auto", "bad"); syncEntry(); updateOdo(); updatePump(); if (k === "kmIni") { renderGap(); renderCluster(); } }));
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
  const imp = num($("importe").value), lit = num($("litros").value);
  $("pImp").textContent = (imp || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $("pLit").textContent = (lit || 0).toLocaleString("es-MX", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  $("pPre").textContent = imp && lit ? (imp / lit).toFixed(2) : "—";
}
function need(ids, errEl, msg) {
  const bad = ids.filter(([id, ok]) => !ok(day.entry[id]));
  ids.forEach(([id]) => $(id).classList.toggle("bad", bad.some(b => b[0] === id)));
  if (bad.length) { $(errEl).textContent = msg + bad.map(b => b[2]).join(", ") + "."; $(errEl).hidden = false; $(bad[0][0]).focus(); return false; }
  $(errEl).hidden = true; return true;
}

function slotsToSend(list) { return list.filter(s => day.photos[s.slot] && day.photos[s.slot].preview && !day.photos[s.slot].uploaded); }
function markUploaded(list) { list.forEach(s => { if (day.photos[s.slot]) day.photos[s.slot].uploaded = true; }); }
function evidenceSlots() {
  const odo = day.photos.odoCarga ? "odoCarga" : day.photos.fin ? "fin" : "ini";
  return [{ slot: "ticket", box: "ticketBomba" }, { slot: "ticketCar", box: "ticketCar" }, { slot: odo, box: "odometro" }];
}

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
  const box = $("gapBox"); const g = gapInfo(); box.textContent = "";
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

$("btnStart").onclick = async () => {
  syncEntry();
  if (!need([["kmIni", isNum, "km inicial"], ["fTras", has, "fecha"]], "startErr", "Falta: ")) return;
  if (!cfg.scriptUrl) { banner("bad", "Primero conecta tu hoja", "Pega la dirección del servicio de Google."); return; }
  const g = gapInfo();
  if (g && g.diff < 0 && !lowArmed) { lowArmed = true; $("startErr").textContent = "El km es menor que el último registrado. Toca otra vez si es correcto."; $("startErr").hidden = false; return; }
  lowArmed = false;
  if (!has(day.entry.de) && home()) { day.entry.de = homeLabel(); day.entry.deC = homeCoords(); }
  const b = $("btnStart"); b.disabled = true; b.textContent = "Arrancando…";
  try {
    markDeparture();
    const t = await nat("startTracking");
    if (!t.ok) throw new Error(t.error || "No se pudo iniciar el GPS");
    day.stage = "running"; day.startedAt = Date.now(); day.tramoStart = Date.now(); persist();
    render();
    await beginDay();
  } catch (e) {
    if (day.stage === "running") banner("bad", "El inicio no se guardó en la hoja", e.message + ". El recorrido sí se está grabando.", [{ label: "Reintentar", cls: "primary", run: () => beginDay().catch(x => banner("bad", "Sigue sin guardarse", x.message)) }], "startfail");
    else banner("bad", "No se pudo arrancar", e.message);
  } finally { b.disabled = false; b.textContent = "Iniciar jornada y grabar"; render(); }
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
    const d = el("div"); d.id = "shot-ini-m"; sh.appendChild(d);
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
  // reutiliza la tarjeta de la foto de inicio dentro de la hoja
  const box = $("shot-ini-m"); box.id = "shot-ini"; const main = document.querySelector("#stepStart #shot-ini"); if (main) main.id = "shot-ini-hidden";
  drawShot("ini");
  const restore = () => { if (main) main.id = "shot-ini"; box.id = "shot-ini-m"; };
  closeHooks.push(restore);
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

// Carga
$("btnCarga").onclick = async () => {
  syncEntry();
  if (!need([["fCarga", has, "fecha de carga"], ["importe", v => num(v) > 0, "importe"], ["litros", v => num(v) > 0, "litros"]], "cargaErr", "Falta: ")) return;
  const b = $("btnCarga"); b.disabled = true; b.textContent = "Subiendo fotos y guardando…";
  try {
    const r = await saveRow(evidenceSlots());
    day.cargaSaved = true; persist();
    banner("ok", "Carga guardada", "Fila " + r.row + (r.evidenceTab ? " · fotos y datos en la pestaña " + r.evidenceTab : "") + ".", null, "ok");
    $("cargaBox").open = false; loadSheet();
  } catch (e) { banner("bad", "La carga no se guardó", e.message); }
  finally { b.disabled = false; b.textContent = "Guardar carga en la bitácora"; }
};

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
  const fuel = num(day.entry.importe) > 0 && !day.cargaSaved;
  if (fuel && !need([["fCarga", has, "fecha de carga"], ["litros", v => num(v) > 0, "litros"]], "endErr", "La carga está incompleta: ")) { $("cargaBox").open = true; return; }
  const b = $("btnEnd"); b.disabled = true; b.textContent = "Cerrando el día…";
  try {
    A.stopTracking();
    const fin = num(day.entry.kmFin);
    let row;
    if (homeClosed) {
      const entry = Object.assign({}, lastDone.entry, { kmFin: String(fin) });
      if (fuel) Object.assign(entry, { fCarga: day.entry.fCarga, importe: day.entry.importe, litros: day.entry.litros, ticket: day.entry.ticket, factura: day.entry.factura });
      const slots = slotsToSend([{ slot: "fin" }].concat(fuel ? evidenceSlots() : []));
      const r = await call("save", { row: lastDone.row, entry, photoSlots: slots });
      if (!r.ok) throw new Error(r.error);
      markUploaded(slots); lastDone.entry = entry; lastDone.km = fin - (num(entry.kmIni) || fin); row = r.row;
    } else {
      if (!has(day.entry.a) && home() && nearHomeNow()) { day.entry.a = homeLabel(); day.entry.aC = homeCoords(); }
      const slots = [{ slot: "fin" }].concat(fuel ? evidenceSlots() : []);
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
      if (!st.confirmed) { const f = el("button", "small ghost", "Confirmar km con foto"); f.style.marginTop = "6px"; f.onclick = () => openConfirm(s, i, st.row, st.km); a.appendChild(f); }
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
  const fuel = num(day.entry.importe) > 0 && !day.cargaSaved;
  const sl = slots.map(x => ({ slot: x })).concat(fuel ? evidenceSlots() : []);
  const r = await saveRow(sl);
  const g = A.trackKm(day.date, day.tramoStart || 0, gpsTo || s.end || Date.now());
  const prev = { start: day.tramoStart, cargaSaved: day.cargaSaved };
  rowGps[day.entry.fTras + "|" + r.row] = g; save(RGKEY, rowGps);
  day.done.push({ row: r.row, de: day.entry.de, a, km: km - (num(day.entry.kmIni) || km), gps: g, entry: Object.assign({}, day.entry), prev, stop: s.start });
  day.stopsDone[s.start] = { row: r.row, km, confirmed: slots.length > 0 };
  // el siguiente tramo sale de esta parada con el km de este registro
  slots.concat(["ini", "ticket", "ticketCar", "odoCarga"]).forEach(k => { delete day.photos[k]; A.clearPhoto(k); });
  day.entry = { fTras: day.date, kmIni: String(km), de: a, deC: aC, asunto };
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
      const row = await closeTramo(s, km, a, aC, day.entry.asunto || "", [], s.start);
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

// Fotos opcionales para confirmar el km real de una parada ya registrada
function openConfirm(s, i, row, kmEst) {
  const kp = "p" + s.start, kl = "l" + s.start;
  const done = day.done.find(d => d.row === row);
  openModal(sh => {
    sh.appendChild(el("h2", "", "Parada " + (i + 1) + " · fila " + row));
    sh.appendChild(el("p", "hint", "Se registró con el km estimado por GPS (" + fmt(kmEst) + "). Toma la foto del odómetro: la app lee el km y corrige la fila; el siguiente tramo arranca con ese km."));
    const d1 = el("div"); d1.id = "shot-" + kp; const d2 = el("div"); d2.id = "shot-" + kl; sh.append(d1, d2);
    const lab = el("label", "", "Km real en esta parada"); const inp = el("input", "num"); inp.id = "m_km"; inp.type = "number"; inp.value = kmEst; inp.oninput = () => inp.classList.remove("auto", "bad"); lab.appendChild(inp);
    const la = el("label", "", "Llega a"); const ia = el("input"); ia.id = "m_a"; ia.value = done ? done.entry.a : ""; la.appendChild(ia);
    const lc = el("label", "", "Coordenadas"); const ic = el("input", "num"); ic.id = "m_aC"; ic.value = done ? done.entry.aC : ""; lc.appendChild(ic);
    const ls = el("label", "", "Asunto de este tramo"); const is = el("input"); is.value = done ? done.entry.asunto || "" : ""; ls.appendChild(is);
    sh.append(lab, la, lc, ls);
    const err = el("div", "err"); err.hidden = true; sh.appendChild(err);
    const act = el("div", "actions");
    const ok = el("button", "primary", "Actualizar fila " + row), later = el("button", "ghost", "Listo, sin fotos");
    ok.onclick = async () => {
      const km = num(inp.value);
      if (km === null || !done) { inp.classList.add("bad"); return; }
      if (num(done.entry.kmIni) !== null && km < num(done.entry.kmIni)) { inp.classList.add("bad"); err.textContent = "El km no puede ser menor al inicial del tramo (" + fmt(num(done.entry.kmIni)) + ")."; err.hidden = false; return; }
      ok.disabled = true; ok.textContent = "Subiendo fotos…";
      try {
        const entry = Object.assign({}, done.entry, { kmFin: String(km), a: ia.value.trim(), aC: ic.value.trim(), asunto: is.value.trim() });
        const slots = [kp, kl].filter(k => day.photos[k] && day.photos[k].preview && !day.photos[k].uploaded).map(k => ({ slot: k }));
        const res = await call("save", { row, entry, photoSlots: slots });
        if (!res.ok) throw new Error(res.error);
        slots.forEach(x => { delete day.photos[x.slot]; A.clearPhoto(x.slot); });
        done.entry = entry; done.km = km - (num(entry.kmIni) || km); done.a = entry.a;
        day.stopsDone[s.start].km = km; day.stopsDone[s.start].confirmed = true;
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
      const entry = {}; FIELDS.forEach(k => entry[k] = f[k].value.trim());
      if (num(entry.kmFin) !== null && num(entry.kmIni) !== null && num(entry.kmFin) < num(entry.kmIni)) { err.textContent = "El km final no puede ser menor que el inicial."; err.hidden = false; return; }
      ok.disabled = true; ok.textContent = "Guardando…";
      const r = await call("save", { row: x.r, entry, photoSlots: [] });
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

let closeHooks = [];
function openModal(build) { closeHooks.splice(0).forEach(f => f()); const s = $("sheet"); s.textContent = ""; build(s); $("modal").hidden = false; }
function closeModal() { $("modal").hidden = true; closeHooks.splice(0).forEach(f => f()); }
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
  ["ini", "fin", "ticket", "ticketCar", "odoCarga"].forEach(drawShot);
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
