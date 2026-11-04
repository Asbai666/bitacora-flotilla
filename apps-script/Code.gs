/**
 * Bitácora Flotilla — servicio para la app Android (multiusuario).
 * Se pega en: Hoja "Bitácora Flotilla" del coordinador → Extensiones → Apps Script.
 * Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier usuario
 *
 * Cada técnico se registra desde la app (nombre, No. de empleado, correo, placas): el servicio le crea
 * su propia bitácora copiando una plantilla limpia, en la carpeta "Bitácoras por usuario" del Drive del
 * coordinador, y se la comparte a su correo. Cada petición trae la clave del usuario y solo toca su hoja.
 * La hoja "Bitácora Flotilla – Usuarios" (misma carpeta raíz) lista a todos con sus enlaces.
 */

const CONFIG = {
  TOKEN: 'hjS36zxuCyNVX7H2pNeZKx2Z',                       // mismo valor que en la app
  SHEET_ID: '11VXRMhswSoNfCqnZiAGv_KgrWUqGpeRfmNSDLqEk4v0',
  FOLDER_ID: '1mgISCQa_doMf-vZWSCGjhrqIhX0m-qvx',          // "Bitácora Flotilla - Evidencias"
  OWNER: '65071932',         // No. de empleado del coordinador: al registrarse usa la bitácora original (SHEET_ID)
  TAB: 'Bitácora',
  EVIDENCE_TABS: ['1a Evidencia', '2a Evidencia', '3a Evidencia'],
  FIRST_ROW: 9,              // primera fila de captura; la última se calcula (fila anterior a TOTAL)
  REST_LABEL: 'DÍA DE DESCANSO'
};

// Recuadros de las pestañas de Evidencia (fila, columna, filas, columnas)
const BOXES = {
  ticketCar:   { row: 3,  col: 1, rows: 10, cols: 3 },   // TICKET CAR (voucher de cobro)  A3:C12
  odometro:    { row: 3,  col: 4, rows: 10, cols: 3 },   // ODOMETRO     D3:F12
  ticketBomba: { row: 14, col: 1, rows: 10, cols: 3 },   // TICKET BOMBA A14:C23
  respaldo:    { row: 14, col: 4, rows: 10, cols: 3 }    // RESPALDO     D14:F23
};

function doGet() {
  return json_({ ok: true, service: 'bitacora-flotilla' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (req.token !== CONFIG.TOKEN) return json_({ ok: false, error: 'Clave de acceso incorrecta' });
    lock.waitLock(30000);
    if (req.action === 'register') return json_(register_(req));
    CTX = req.key ? user_(req.key) : null;      // sin clave: apps anteriores del coordinador → bitácora original
    if (CTX && ['save', 'carga', 'rest'].indexOf(req.action) >= 0) touch_();
    switch (req.action) {
      case 'ping':   fixTotals_(sh_()); return json_({ ok: true, version: 6, owner: isOwner_(), user: CTX ? { nombre: CTX.nombre, empleado: CTX.emp, sheetUrl: sheetUrl_() } : null });
      case 'insert': return json_(insert_(req));
      case 'team':   return json_(team_());
      case 'xlsx':   return json_(xlsx_(req));
      case 'carga':  return json_(carga_(req));
      case 'read':   return json_(read_());
      case 'save':   return json_(save_(req));
      case 'rest':   return json_(rest_(req));
      case 'delete': return json_(del_(req));
      case 'header': return json_(header_(req));
      case 'track':  return json_(track_(req));
      default:       return json_({ ok: false, error: 'Acción desconocida: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// ---------- usuario de la petición ----------
let CTX = null, SS = null;
const PROPS = PropertiesService.getScriptProperties();
function sheetId_() { return CTX ? CTX.sheet : CONFIG.SHEET_ID; }
function isOwner_() { return !CTX || CTX.emp === CONFIG.OWNER; }
function sheetUrl_() { return 'https://docs.google.com/spreadsheets/d/' + sheetId_() + '/edit'; }
function rootFolder_() { return DriveApp.getFolderById(CTX ? CTX.folder : CONFIG.FOLDER_ID); }
function user_(key) {
  const s = PROPS.getProperty('k:' + key);
  if (!s) throw new Error('USUARIO_NO_REGISTRADO: tu registro ya no existe; vuelve a registrarte en la app.');
  return JSON.parse(s);
}

// ---------- utilidades ----------
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function ss_() { if (!SS) SS = SpreadsheetApp.openById(sheetId_()); return SS; }
function sh_() { return ss_().getSheetByName(CONFIG.TAB); }
function blank_(v) { return v === '' || v === null || v === undefined; }
function num_(v) {
  if (blank_(v)) return '';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? '' : n;
}
function date_(iso) {                       // "2026-10-30" → fecha real (mediodía evita saltos de zona)
  if (!iso) return '';
  const p = String(iso).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
}
function iso_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return '';
}
// Fila de totales ("TOTAL" en la columna B) y última fila de captura
function totalsRow_(sh) {
  const col = sh.getRange(CONFIG.FIRST_ROW, 2, sh.getMaxRows() - CONFIG.FIRST_ROW + 1, 1).getValues();
  for (let i = 0; i < col.length; i++) if (String(col[i][0]).trim().toUpperCase() === 'TOTAL') return CONFIG.FIRST_ROW + i;
  return rebuildTotals_(sh);
}
// Si alguien borró la fila de TOTAL, se vuelve a crear después del último registro (mínimo 28 filas de captura)
function rebuildTotals_(sh) {
  const f = CONFIG.FIRST_ROW, n = sh.getMaxRows() - f + 1;
  const data = sh.getRange(f, 1, n, 15).getValues();
  let last = f - 1;
  data.forEach((r, i) => { if (rowFilled_(r)) last = f + i; });
  const tot = Math.max(last + 1, f + 28);
  if (tot + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), tot + 1 - sh.getMaxRows());
  sh.getRange(tot, 2).setValue('TOTAL');
  sh.getRange(tot, 6).setValue('KILOMETROS RECORRIDOS:');
  sh.getRange(tot, 10).setValue('RENDIMIENTO (Km/Lt) =');
  sh.getRange(tot + 1, 7).setValue('KILOMETRAJE FINAL - (MENOS) KILOMETRAJE INICIAL');
  sh.getRange(tot + 1, 10).setValue('KILOMETROS RECORRIDOS / (ENTRE) LITROS');
  sh.getRange(tot, 3).setFormula('=SUM(C' + f + ':C' + (tot - 1) + ')');
  sh.getRange(tot, 4).setFormula('=SUM(D' + f + ':D' + (tot - 1) + ')');
  sh.getRange(tot, 9).setFormula('=SUM(I' + f + ':I' + (tot - 1) + ')');
  sh.getRange(tot, 13).setFormula('=IFERROR(I' + tot + '/D' + tot + ',0)');
  return tot;
}
function lastRow_(sh) { return totalsRow_(sh) - 1; }

// Agrega filas antes de TOTAL con el mismo formato y actualiza las sumas
function addRows_(sh, howMany) {
  const tot = totalsRow_(sh);
  sh.insertRowsBefore(tot, howMany);
  const model = sh.getRange(tot - 1, 1, 1, 15);
  for (let i = 0; i < howMany; i++) {
    const r = tot + i;
    model.copyTo(sh.getRange(r, 1, 1, 15), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    try { sh.getRange(r, 10, 1, 2).merge(); } catch (e) {}
    sh.setRowHeight(r, sh.getRowHeight(tot - 1));
  }
  fixTotals_(sh);
}
function fixTotals_(sh) {
  const tot = totalsRow_(sh), last = tot - 1, f = CONFIG.FIRST_ROW;
  sh.getRange(tot, 3).setFormula('=SUM(C' + f + ':C' + last + ')');
  sh.getRange(tot, 4).setFormula('=SUM(D' + f + ':D' + last + ')');
  sh.getRange(tot, 9).setFormula('=SUM(I' + f + ':I' + last + ')');
  sh.getRange(tot, 13).setFormula('=IFERROR(I' + tot + '/D' + tot + ',0)');
  sh.getRange(f, 2, last - f + 1, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(f, 6, last - f + 1, 1).setNumberFormat('dd/mm/yyyy');
}

function rowFilled_(r) { return [0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14].some(i => !blank_(r[i])); }

// ---------- lectura ----------
function read_() {
  const sh = sh_();
  const head = sh.getRange('A5:O5').getValues()[0];
  const last = lastRow_(sh);
  const data = sh.getRange(CONFIG.FIRST_ROW, 1, last - CONFIG.FIRST_ROW + 1, 15).getValues();
  const rows = [];
  let firstFree = null, lastKm = null;
  data.forEach((r, i) => {
    const row = CONFIG.FIRST_ROW + i;
    const filled = rowFilled_(r);
    if (!filled) { if (firstFree === null) firstFree = row; return; }
    const o = {
      r: row, factura: String(r[0]), fCarga: iso_(r[1]), importe: num_(r[2]), litros: num_(r[3]),
      ticket: String(r[4]), fTras: iso_(r[5]), kmIni: num_(r[6]), kmFin: num_(r[7]),
      asunto: String(r[9]), de: String(r[11]), deC: String(r[12]), a: String(r[13]), aC: String(r[14])
    };
    if (o.kmFin !== '') lastKm = o.kmFin; else if (o.kmIni !== '') lastKm = o.kmIni;
    rows.push(o);
  });
  const arch = archives_();
  if (lastKm === null && arch.lastKm !== undefined) lastKm = arch.lastKm;
  return {
    ok: true, owner: isOwner_(),
    header: { mes: String(head[1]), usuario: String(head[6]), placas: String(head[11]), tag: String(head[14]) },
    rows: rows, firstFree: firstFree, lastKm: lastKm, capacity: last - CONFIG.FIRST_ROW + 1,
    archives: Object.keys(arch.months || {}).sort().reverse()
  };
}

function pickRow_(sh, requested) {
  const last = lastRow_(sh);
  if (requested) {
    const r = Number(requested);
    if (r < CONFIG.FIRST_ROW || r > last) throw new Error('Fila fuera del rango de captura (' + CONFIG.FIRST_ROW + '–' + last + ')');
    return r;
  }
  const data = sh.getRange(CONFIG.FIRST_ROW, 1, last - CONFIG.FIRST_ROW + 1, 15).getValues();
  let lastFilled = -1;
  data.forEach((r, i) => { if (rowFilled_(r)) lastFilled = i; });
  if (lastFilled + 1 < data.length) return CONFIG.FIRST_ROW + lastFilled + 1;
  // sin filas libres: se agrega una fila nueva antes de TOTAL con el mismo formato
  addRows_(sh, 1);
  return last + 1;
}

// Escribe la fila exactamente con las columnas de la hoja (A–O).
// Si el registro no trae datos de carga (A–E), se respetan los que ya tenga la fila.
function writeRow_(sh, r, e) {
  const hasCarga = ['factura', 'fCarga', 'importe', 'litros', 'ticket'].some(k => Object.prototype.hasOwnProperty.call(e, k));
  if (hasCarga) sh.getRange(r, 1, 1, 5).setValues([[
    e.factura || '',                 // A  NO. FACTURA
    date_(e.fCarga),                 // B  FECHA DE CARGA
    num_(e.importe),                 // C  IMPORTE (PESOS $)
    num_(e.litros),                  // D  CANTIDAD (LITROS)
    e.ticket || ''                   // E  # DE TICKET O FOLIO
  ]]);
  sh.getRange(r, 6, 1, 3).setValues([[
    date_(e.fTras),                  // F  FECHA TRASLADO
    num_(e.kmIni),                   // G  KILOMETRAJE INICIAL
    num_(e.kmFin)                    // H  KILOMETRAJE FINAL
  ]]);
  sh.getRange(r, 2).setNumberFormat('dd/mm/yyyy');
  sh.getRange(r, 6).setNumberFormat('dd/mm/yyyy');
  sh.getRange(r, 9).setFormula('=IF(OR(G' + r + '="",H' + r + '=""),"",H' + r + '-G' + r + ')'); // I KM RECORRIDO
  sh.getRange(r, 10).setValue(e.asunto || '');   // J  ASUNTO (J:K combinadas)
  sh.getRange(r, 12, 1, 4).setValues([[e.de || '', e.deC || '', e.a || '', e.aC || '']]); // L–O TRASLADO
}

// ---------- guardar registro ----------
// Nunca se guarda un tramo con km final menor que el inicial
function validate_(e) {
  const a = num_(e.kmIni), b = num_(e.kmFin);
  if (a !== '' && b !== '' && b < a) throw new Error('El km final (' + b + ') es menor que el inicial (' + a + '). Revisa la lectura del odómetro.');
}
// Aviso si el km inicial no es el km final de la fila anterior
function continuity_(sh, r) {
  if (r <= CONFIG.FIRST_ROW) return null;
  const rows = sh.getRange(CONFIG.FIRST_ROW, 1, r - CONFIG.FIRST_ROW + 1, 15).getValues();
  const cur = rows[rows.length - 1];
  for (let i = rows.length - 2; i >= 0; i--) {
    if (!rowFilled_(rows[i])) continue;
    const prevFin = num_(rows[i][7]), ini = num_(cur[6]);
    if (prevFin === '' || ini === '' || prevFin === ini) return null;
    return 'El km inicial (' + ini + ') no coincide con el final de la fila ' + (CONFIG.FIRST_ROW + i) + ' (' + prevFin + ').';
  }
  return null;
}

function save_(req) {
  const sh = sh_();
  const e = req.entry || {};
  validate_(e);
  const archived = req.row ? null : ensureMonth_(sh, e.fTras || e.fCarga);
  const r = pickRow_(sh, req.row);
  writeRow_(sh, r, e);
  SpreadsheetApp.flush();
  const warn = continuity_(sh, r);

  // fotos a Drive
  const folder = monthFolder_(e.fTras || e.fCarga);
  const links = {};
  const boxes = [];
  (req.photos || []).forEach(p => {
    if (!p || !p.b64) return;
    const blob = Utilities.newBlob(Utilities.base64Decode(p.b64), 'image/jpeg', p.name || (p.slot + '.jpg'));
    const f = folder.createFile(blob);
    links[p.slot] = f.getUrl();
    if (p.box && p.small) boxes.push({ box: p.box, b64: p.small, name: p.name });
  });

  // pestaña de evidencia cuando hay carga
  let evidenceTab = null;
  if (boxes.length && num_(e.importe) !== '' && num_(e.importe) > 0) {
    const data = sh.getRange(CONFIG.FIRST_ROW, 3, lastRow_(sh) - CONFIG.FIRST_ROW + 1, 1).getValues();
    const cargas = [];
    data.forEach((v, i) => { if (num_(v[0]) !== '' && num_(v[0]) > 0) cargas.push(CONFIG.FIRST_ROW + i); });
    const idx = cargas.indexOf(r);
    if (idx >= 0 && idx < CONFIG.EVIDENCE_TABS.length) {
      const ev = ss_().getSheetByName(CONFIG.EVIDENCE_TABS[idx]);
      if (ev) {
        ev.getRange('I4').setValue(num_(e.litros));     // Litros
        ev.getRange('J4').setValue(num_(e.importe));    // Montos
        ev.getRange('I5').setValue(date_(e.fCarga));    // Fecha
        boxes.forEach(b => placeImage_(ev, BOXES[b.box], b.b64, b.name));
        evidenceTab = ev.getName();
      }
    }
  }
  return { ok: true, row: r, links: links, evidenceTab: evidenceTab, warn: warn, archived: archived };
}

function placeImage_(sheet, box, b64, name) {
  if (!box) return;
  // quita la imagen anterior de ese recuadro
  sheet.getImages().forEach(img => {
    const c = img.getAnchorCell();
    if (c.getRow() >= box.row && c.getRow() < box.row + box.rows && c.getColumn() >= box.col && c.getColumn() < box.col + box.cols) img.remove();
  });
  let w = 0, h = 0;
  for (let c = 0; c < box.cols; c++) w += sheet.getColumnWidth(box.col + c);
  for (let r = 0; r < box.rows; r++) h += sheet.getRowHeight(box.row + r);
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name || 'evidencia.jpg');
  const img = sheet.insertImage(blob, box.col, box.row);
  const iw = img.getWidth(), ih = img.getHeight();
  const s = Math.min((w - 6) / iw, (h - 6) / ih);
  img.setWidth(Math.round(iw * s)).setHeight(Math.round(ih * s)).setAnchorCellXOffset(3).setAnchorCellYOffset(3);
}

function monthFolder_(iso) {
  const root = rootFolder_();
  const name = (iso || Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd')).slice(0, 7);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// ---------- carga de combustible ----------
// Escribe A–E en la fila que corresponde (sin tocar el traslado) y llena la pestaña de Evidencia
// que le toca por orden de carga en el mes: 1a, 2a, 3a… (si no existe se crea copiando la 1a).
function carga_(req) {
  const sh = sh_();
  const c = req.carga || {};
  let r = req.row ? Number(req.row) : null;
  if (r) {
    if (r < CONFIG.FIRST_ROW || r > lastRow_(sh)) throw new Error('Fila fuera del rango de captura');
  } else {
    ensureMonth_(sh, req.date || c.fCarga);
    r = pickRow_(sh, null);
    sh.getRange(r, 6).setValue(date_(req.date || c.fCarga));
    if (!blank_(c.km)) sh.getRange(r, 7, 1, 2).setValues([[num_(c.km), num_(c.km)]]);
    sh.getRange(r, 10).setValue('CARGA DE COMBUSTIBLE');
  }
  sh.getRange(r, 1, 1, 5).setValues([[c.factura || '', date_(c.fCarga), num_(c.importe), num_(c.litros), c.folio || '']]);
  SpreadsheetApp.flush();

  // fotos a Drive
  const folder = monthFolder_(c.fCarga || req.date);
  const links = {}, boxes = [];
  (req.photos || []).forEach(p => {
    if (!p || !p.b64) return;
    const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(p.b64), 'image/jpeg', p.name || (p.slot + '.jpg')));
    links[p.slot] = f.getUrl();
    if (p.box && p.small) boxes.push({ box: p.box, b64: p.small, name: p.name });
  });

  // pestaña de evidencia según el orden de la carga en el mes
  const data = sh.getRange(CONFIG.FIRST_ROW, 3, lastRow_(sh) - CONFIG.FIRST_ROW + 1, 1).getValues();
  const cargas = [];
  data.forEach((v, i) => { if (num_(v[0]) !== '' && num_(v[0]) > 0) cargas.push(CONFIG.FIRST_ROW + i); });
  const n = Math.max(1, cargas.indexOf(r) + 1);
  const ev = evidenceTab_(n);
  ev.getRange('I4').setValue(num_(c.litros)).setNumberFormat('#,##0.000');
  ev.getRange('J4').setValue(num_(c.importe)).setNumberFormat('$#,##0.00');
  const when = dateTime_(c.fCarga, c.hora);
  ev.getRange('I5').setValue(when).setNumberFormat(c.hora ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy');
  const note = ['Folio: ' + (c.folio || '—'),
    'Fecha y hora: ' + Utilities.formatDate(when || new Date(), ss_().getSpreadsheetTimeZone(), c.hora ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy'),
    'Importe: $' + (num_(c.importe) === '' ? '—' : Number(num_(c.importe)).toFixed(2)),
    'Litros: ' + (num_(c.litros) === '' ? '—' : num_(c.litros)),
    c.km ? 'Odómetro: ' + c.km + ' km' : '',
    c.factura ? 'Factura: ' + c.factura : '',
    'Fila ' + r + ' de la Bitácora'].filter(Boolean).join(' · ');
  const cr = commentsRow_(ev);
  if (cr) ev.getRange(cr, 2).setValue(note);
  boxes.forEach(b => placeImage_(ev, BOXES[b.box], b.b64, b.name));
  return { ok: true, row: r, links: links, evidenceTab: ev.getName(), carga: n };
}

function evidenceTab_(n) {
  const name = n + 'a Evidencia';
  const ss = ss_();
  let ev = ss.getSheetByName(name);
  if (ev) return ev;
  const tpl = ss.getSheetByName(CONFIG.EVIDENCE_TABS[0]);
  ev = tpl.copyTo(ss).setName(name);
  ev.getImages().forEach(img => img.remove());
  ['I4', 'J4', 'I5'].forEach(a => ev.getRange(a).clearContent());
  const cr = commentsRow_(ev); if (cr) ev.getRange(cr, 2).clearContent();
  ev.getRange('H2').setValue('CARGA ' + n);
  ss.setActiveSheet(ev); ss.moveActiveSheet(ss.getNumSheets());
  return ev;
}

function commentsRow_(ev) {
  const col = ev.getRange(20, 1, 12, 1).getValues();
  for (let i = 0; i < col.length; i++) if (/COMENTARIOS/i.test(String(col[i][0]))) return 20 + i;
  return null;
}

function dateTime_(iso, hora) {
  if (!iso) return '';
  const p = String(iso).split('-').map(Number);
  const h = String(hora || '').match(/(\d{1,2}):(\d{2})/);
  return h ? new Date(p[0], p[1] - 1, p[2], Number(h[1]), Number(h[2]), 0) : new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
}

// ---------- copia en Excel (XLSX) para compartir ----------
// Exporta todo el libro (Bitácora y pestañas de Evidencia con sus fotos) tal como está en Google Sheets.
function xlsx_(req) {
  SpreadsheetApp.flush();
  const month = req && req.month ? String(req.month) : '';
  const arch = month ? (archives_().months || {})[month] : null;
  if (month && !arch) throw new Error('No hay copia guardada de ese mes');
  const url = 'https://docs.google.com/spreadsheets/d/' + (arch || sheetId_()) + '/export?format=xlsx';
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Google no generó el archivo XLSX (código ' + res.getResponseCode() + ')');
  const sh = arch ? SpreadsheetApp.openById(arch).getSheetByName(CONFIG.TAB) : sh_();
  const mes = String(sh.getRange('B5').getValue() || '').trim() || Utilities.formatDate(new Date(), 'America/Mexico_City', 'MM-yyyy');
  const placas = String(sh.getRange('L5').getValue() || '').trim();
  const name = 'Bitacora Flotilla ' + mes + (placas ? ' ' + placas : '') + '.xlsx';
  const bytes = res.getBlob().getBytes();
  return { ok: true, name: name, size: bytes.length, b64: Utilities.base64Encode(bytes) };
}

// Ejecuta esta función una vez desde el editor (botón ▶ Ejecutar) para dar los permisos
// (exportar a Excel y crear/compartir las bitácoras de los usuarios). También deja lista la plantilla.
function autorizar() {
  const r = xlsx_();
  const t = template_();
  registry_();
  Logger.log('Listo: ' + r.name + ' (' + Math.round(r.size / 1024) + ' KB) · plantilla ' + t);
}

// ---------- usuarios ----------
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function mesActual_() { return MESES[Number(Utilities.formatDate(new Date(), 'America/Mexico_City', 'M')) - 1]; }

function register_(req) {
  const emp = String(req.empleado || '').replace(/\D/g, '');
  const nombre = String(req.nombre || '').replace(/\s+/g, ' ').trim();
  const correo = String(req.correo || '').trim().toLowerCase();
  if (!emp || nombre.length < 5) throw new Error('Escribe tu nombre completo y tu número de empleado.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('Escribe un correo válido (de preferencia Gmail) para compartirte tu hoja.');

  // ya registrado (reinstaló la app o cambió de teléfono): se le devuelve su misma bitácora
  const prev = PROPS.getProperty('e:' + emp);
  if (prev && PROPS.getProperty('k:' + prev)) {
    const u = JSON.parse(PROPS.getProperty('k:' + prev));
    if (u.correo && u.correo !== correo) throw new Error('El empleado ' + emp + ' ya está registrado con otro correo. Pide al coordinador que lo revise.');
    CTX = u;
    return { ok: true, key: prev, nuevo: false, nombre: u.nombre, sheetUrl: sheetUrl_() };
  }

  let sheetId, folderId, shared = true;
  if (emp === CONFIG.OWNER) { sheetId = CONFIG.SHEET_ID; folderId = CONFIG.FOLDER_ID; }
  else {
    const folder = usersFolder_().createFolder(emp + ' ' + nombre);
    const file = DriveApp.getFileById(template_()).makeCopy('Bitácora Flotilla TPLAY_' + emp + ' ' + nombre, folder);
    sheetId = file.getId(); folderId = folder.getId();
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName(CONFIG.TAB);
    sh.getRange('B5').setValue(req.mes || mesActual_());
    sh.getRange('G5').setValue(emp + ' ' + nombre);
    sh.getRange('L5').setValue(String(req.placas || '').toUpperCase());
    sh.getRange('O5').setValue(req.tag || '');
    try { file.addEditor(correo); folder.addViewer(correo); } catch (e) { shared = false; }
  }
  const reg = registry_().getSheets()[0];
  reg.appendRow([new Date(), emp, nombre, correo, String(req.placas || '').toUpperCase(), req.tag || '', '', '', new Date()]);
  const row = reg.getLastRow();
  reg.getRange(row, 7).setFormula('=HYPERLINK("https://docs.google.com/spreadsheets/d/' + sheetId + '/edit","Abrir bitácora")');
  reg.getRange(row, 8).setFormula('=HYPERLINK("https://drive.google.com/drive/folders/' + folderId + '","Fotos y recorridos")');
  const key = Utilities.getUuid().replace(/-/g, '');
  CTX = { emp: emp, nombre: nombre, correo: correo, sheet: sheetId, folder: folderId, row: row };
  PROPS.setProperty('k:' + key, JSON.stringify(CTX));
  PROPS.setProperty('e:' + emp, key);
  return { ok: true, key: key, nuevo: true, shared: shared, nombre: nombre, sheetUrl: sheetUrl_() };
}

// Última actividad en la hoja de usuarios (como mucho una vez cada 10 minutos por usuario)
function touch_() {
  try {
    const c = CacheService.getScriptCache(), k = 't:' + CTX.emp;
    if (c.get(k) || !CTX.row) return;
    registry_().getSheets()[0].getRange(CTX.row, 9).setValue(new Date());
    c.put(k, '1', 600);
  } catch (e) {}
}

function usersFolder_() {
  const root = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = root.getFoldersByName('Bitácoras por usuario');
  return it.hasNext() ? it.next() : root.createFolder('Bitácoras por usuario');
}

// Hoja índice para el coordinador: quién está registrado y el enlace a su bitácora
function registry_() {
  const id = PROPS.getProperty('registry');
  if (id) try { const f = DriveApp.getFileById(id); if (!f.isTrashed()) return SpreadsheetApp.openById(id); } catch (e) {}
  const ss = SpreadsheetApp.create('Bitácora Flotilla – Usuarios');
  const sh = ss.getSheets()[0].setName('Usuarios');
  sh.getRange(1, 1, 1, 9).setValues([['Alta', 'No. empleado', 'Nombre', 'Correo', 'Placas', 'TAG / Tarjeta', 'Bitácora', 'Carpeta', 'Última actividad']])
    .setFontWeight('bold').setBackground('#11181d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm'); sh.getRange('I:I').setNumberFormat('dd/mm/yyyy hh:mm');
  DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(CONFIG.FOLDER_ID));
  PROPS.setProperty('registry', ss.getId());
  return ss;
}

// Plantilla limpia: copia de las pestañas de la bitácora del coordinador sin sus datos ni fotos (y sin este código)
function template_() {
  const id = PROPS.getProperty('template');
  if (id) try { if (!DriveApp.getFileById(id).isTrashed()) return id; } catch (e) {}
  const src = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const t = SpreadsheetApp.create('Bitácora Flotilla – PLANTILLA (no editar)');
  const blank = t.getSheets()[0];
  src.getSheets().forEach(s => {
    const n = s.getName();
    if (/Evidencia/i.test(n) && CONFIG.EVIDENCE_TABS.indexOf(n) < 0) return;   // 4a, 5a… no van en la plantilla
    s.copyTo(t).setName(n);
  });
  t.deleteSheet(blank);
  t.setSpreadsheetTimeZone(src.getSpreadsheetTimeZone());
  t.setSpreadsheetLocale('es_MX');
  const b = t.getSheetByName(CONFIG.TAB);
  let tot = totalsRow_(b);
  if (tot - CONFIG.FIRST_ROW > 28) { b.deleteRows(CONFIG.FIRST_ROW + 28, tot - CONFIG.FIRST_ROW - 28); tot = totalsRow_(b); }
  b.getRange(CONFIG.FIRST_ROW, 1, tot - CONFIG.FIRST_ROW, 15).clearContent();
  ['B5', 'G5', 'L5', 'O5'].forEach(a => b.getRange(a).clearContent());
  fixTotals_(b);
  CONFIG.EVIDENCE_TABS.forEach(n => {
    const ev = t.getSheetByName(n); if (!ev) return;
    ev.getImages().forEach(i => i.remove());
    ['I4', 'J4', 'I5'].forEach(a => ev.getRange(a).clearContent());
    const cr = commentsRow_(ev); if (cr) ev.getRange(cr, 2).clearContent();
  });
  t.setActiveSheet(b); t.moveActiveSheet(1);
  DriveApp.getFileById(t.getId()).moveTo(DriveApp.getFolderById(CONFIG.FOLDER_ID));
  PROPS.setProperty('template', t.getId());
  return t.getId();
}

// ---------- cambio de mes ----------
// Cuando se registra el primer tramo de un mes nuevo, se guarda una copia del mes anterior en
// "Meses anteriores" (misma carpeta del usuario) y la hoja se limpia para empezar el mes.
function archives_() { try { return JSON.parse(PROPS.getProperty('a:' + sheetId_()) || '{}'); } catch (e) { return {}; } }
function sheetMonth_(sh) {
  const last = lastRow_(sh);
  const data = sh.getRange(CONFIG.FIRST_ROW, 1, last - CONFIG.FIRST_ROW + 1, 6).getValues();
  for (const r of data) {
    const d = r[5] instanceof Date ? r[5] : (r[1] instanceof Date ? r[1] : null);
    if (d && !isNaN(d)) return Utilities.formatDate(d, ss_().getSpreadsheetTimeZone(), 'yyyy-MM');
  }
  return null;
}
function ensureMonth_(sh, iso) {
  if (!iso) return null;
  const m = String(iso).slice(0, 7);
  const cur = sheetMonth_(sh);
  const label = mm => MESES[Number(mm.slice(5, 7)) - 1];
  if (!cur || m <= cur) {                       // mismo mes: el encabezado MES dice el mes de la hoja
    const want = label(cur || m);
    if (String(sh.getRange('B5').getValue()).trim() !== want) sh.getRange('B5').setValue(want);
    return null;
  }
  SpreadsheetApp.flush();
  const ss = ss_();
  const root = rootFolder_();
  const it = root.getFoldersByName('Meses anteriores');
  const folder = it.hasNext() ? it.next() : root.createFolder('Meses anteriores');
  const name = ss.getName() + ' – ' + label(cur) + ' ' + cur.slice(0, 4);
  const copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  // último km del mes que cierra (para encadenar el primer tramo del mes nuevo)
  const prev = read_();
  const meta = archives_(); meta.months = meta.months || {}; meta.months[cur] = copy.getId(); meta.lastKm = prev.lastKm;
  PROPS.setProperty('a:' + sheetId_(), JSON.stringify(meta));
  // limpiar la hoja: filas de captura, cargas y evidencias
  let tot = totalsRow_(sh);
  if (tot - CONFIG.FIRST_ROW > 28) { sh.deleteRows(CONFIG.FIRST_ROW + 28, tot - CONFIG.FIRST_ROW - 28); tot = totalsRow_(sh); }
  sh.getRange(CONFIG.FIRST_ROW, 1, tot - CONFIG.FIRST_ROW, 15).clearContent();
  ss.getSheets().forEach(ev => {
    const n = ev.getName(), k = (n.match(/^(\d+)a Evidencia$/) || [])[1];
    if (!k) return;
    if (Number(k) > CONFIG.EVIDENCE_TABS.length) { ss.deleteSheet(ev); return; }
    ev.getImages().forEach(i => i.remove());
    ['I4', 'J4', 'I5'].forEach(a => ev.getRange(a).clearContent());
    const cr = commentsRow_(ev); if (cr) ev.getRange(cr, 2).clearContent();
  });
  sh.getRange('B5').setValue(label(m));
  fixTotals_(sh);
  return { month: cur, label: label(cur) + ' ' + cur.slice(0, 4), url: copy.getUrl() };
}

// ---------- equipo (solo el coordinador) ----------
// Resumen de cada bitácora: km del mes, litros, importe, rendimiento y filas con problemas.
// También se escribe en la hoja "Usuarios" (columnas J–N) para usarlo en otros tableros.
function team_() {
  if (!isOwner_()) throw new Error('Solo el coordinador puede ver el equipo');
  const cache = CacheService.getScriptCache();
  const hit = cache.get('team'); if (hit) return JSON.parse(hit);
  const reg = registry_().getSheets()[0];
  reg.getRange(1, 10, 1, 5).setValues([['Km del mes', 'Litros', 'Importe', 'Km/L', 'Filas con problemas']]).setFontWeight('bold').setBackground('#11181d').setFontColor('#ffffff');
  const users = PROPS.getKeys().filter(k => k.indexOf('k:') === 0).map(k => JSON.parse(PROPS.getProperty(k)));
  const out = [];
  const saveCtx = CTX, saveSS = SS;
  users.forEach(u => {
    try {
      CTX = u; SS = null;
      const r = read_();
      let km = 0, lit = 0, imp = 0, issues = 0, prev = null, lastDate = '';
      r.rows.forEach((x, i) => {
        if (x.kmIni !== '' && x.kmFin !== '') { if (x.kmFin < x.kmIni) issues++; else km += x.kmFin - x.kmIni; }
        if (x.kmIni !== '' && x.kmFin === '' && i < r.rows.length - 1) issues++;
        if (prev && prev.kmFin !== '' && x.kmIni !== '' && prev.kmFin !== x.kmIni) issues++;
        if (x.litros !== '') lit += Number(x.litros) || 0;
        if (x.importe !== '') imp += Number(x.importe) || 0;
        if (x.fTras) lastDate = x.fTras;
        prev = x;
      });
      const last = u.row ? reg.getRange(u.row, 9).getValue() : '';
      const rend = lit > 0 ? Math.round(km / lit * 100) / 100 : '';
      if (u.row) reg.getRange(u.row, 10, 1, 5).setValues([[km, Math.round(lit * 1000) / 1000, Math.round(imp * 100) / 100, rend, issues]]);
      out.push({ empleado: u.emp, nombre: u.nombre, placas: r.header.placas, mes: r.header.mes, km: km, litros: lit, importe: imp, rend: rend === '' ? null : rend,
        issues: issues, registros: r.rows.length, ultimaFecha: lastDate, actividad: last instanceof Date ? last.toISOString() : '', sheetUrl: sheetUrl_() });
    } catch (e) { out.push({ empleado: u.emp, nombre: u.nombre, error: String(e.message || e) }); }
  });
  CTX = saveCtx; SS = saveSS;
  out.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const res = { ok: true, team: out, at: new Date().toISOString() };
  try { cache.put('team', JSON.stringify(res), 300); } catch (e) {}
  return res;
}

// ---------- día de descanso ----------
function rest_(req) {
  const sh = sh_();
  if (!req.row) ensureMonth_(sh, req.date);
  const r = pickRow_(sh, req.row);
  const km = num_(req.km);
  writeRow_(sh, r, { fTras: req.date, kmIni: km, kmFin: km, asunto: CONFIG.REST_LABEL });
  return { ok: true, row: r };
}

// ---------- borrar ----------
// Quita la fila y sube las de abajo (no quedan huecos); se repone una fila vacía antes de TOTAL
function del_(req) {
  const r = Number(req.row);
  const sh = sh_();
  if (!(r >= CONFIG.FIRST_ROW && r <= lastRow_(sh))) throw new Error('Fila no válida');
  if (lastRow_(sh) - CONFIG.FIRST_ROW < 1) { sh.getRange(r, 1, 1, 15).clearContent(); return { ok: true, row: r, shifted: false }; }
  sh.deleteRow(r);
  const tot = totalsRow_(sh);
  sh.insertRowBefore(tot);
  sh.getRange(tot - 1, 1, 1, 15).copyTo(sh.getRange(tot, 1, 1, 15), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  try { sh.getRange(tot, 10, 1, 2).merge(); } catch (e) {}
  sh.getRange(tot, 1, 1, 15).clearContent();
  fixTotals_(sh);
  return { ok: true, row: r, shifted: true };
}

// Inserta una fila (por ejemplo, un ajuste de odómetro) antes de la fila indicada; las de abajo bajan una
function insert_(req) {
  const sh = sh_();
  const r = Number(req.before);
  if (!(r >= CONFIG.FIRST_ROW && r <= lastRow_(sh))) throw new Error('Fila no válida');
  const e = req.entry || {};
  validate_(e);
  sh.insertRowBefore(r);
  sh.getRange(r + 1, 1, 1, 15).copyTo(sh.getRange(r, 1, 1, 15), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  try { sh.getRange(r, 10, 1, 2).merge(); } catch (x) {}
  writeRow_(sh, r, e);
  fixTotals_(sh);
  return { ok: true, row: r, shifted: true };
}

// ---------- encabezado ----------
function header_(req) {
  const sh = sh_();
  sh.getRange('B5').setValue(req.mes || '');
  sh.getRange('G5').setValue(req.usuario || '');
  sh.getRange('L5').setValue(req.placas || '');
  sh.getRange('O5').setValue(req.tag || '');
  return { ok: true };
}

// ---------- recorrido GPS (KML + paradas) ----------
function track_(req) {
  const root = rootFolder_();
  const it = root.getFoldersByName('Recorridos');
  const folder = it.hasNext() ? it.next() : root.createFolder('Recorridos');
  const out = {};
  [['kml', 'application/vnd.google-earth.kml+xml'], ['csv', 'text/csv']].forEach(([k, mime]) => {
    if (!req[k]) return;
    const name = 'Recorrido ' + req.date + (k === 'csv' ? ' - paradas.csv' : '.kml');
    const old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    out[k] = folder.createFile(Utilities.newBlob(req[k], mime, name)).getUrl();
  });
  return { ok: true, links: out };
}
