/**
 * Bitácora Flotilla — servicio para la app Android.
 * Se pega en: Hoja "Bitácora Flotilla" → Extensiones → Apps Script.
 * Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier usuario
 * Copia la URL que termina en /exec y pégala en la app (Ajustes).
 */

const CONFIG = {
  TOKEN: 'hjS36zxuCyNVX7H2pNeZKx2Z',                       // mismo valor que en la app
  SHEET_ID: '11VXRMhswSoNfCqnZiAGv_KgrWUqGpeRfmNSDLqEk4v0',
  FOLDER_ID: '1mgISCQa_doMf-vZWSCGjhrqIhX0m-qvx',          // "Bitácora Flotilla - Evidencias"
  TAB: 'Bitácora',
  EVIDENCE_TABS: ['1a Evidencia', '2a Evidencia', '3a Evidencia'],
  FIRST_ROW: 9,              // primera fila de captura; la última se calcula (fila anterior a TOTAL)
  REST_LABEL: 'DÍA DE DESCANSO'
};

// Recuadros de las pestañas de Evidencia (fila, columna, filas, columnas)
const BOXES = {
  ticketCar:   { row: 3,  col: 1, rows: 10, cols: 3 },   // TICKET CAR   A3:C12
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
    switch (req.action) {
      case 'ping':   fixTotals_(sh_()); return json_({ ok: true, version: 2 });
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

// ---------- utilidades ----------
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function ss_() { return SpreadsheetApp.openById(CONFIG.SHEET_ID); }
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
  throw new Error('No encontré la fila de TOTAL en la hoja Bitácora');
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
  return {
    ok: true,
    header: { mes: String(head[1]), usuario: String(head[6]), placas: String(head[11]), tag: String(head[14]) },
    rows: rows, firstFree: firstFree, lastKm: lastKm, capacity: last - CONFIG.FIRST_ROW + 1
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
  for (let i = 0; i < data.length; i++) if (!rowFilled_(data[i])) return CONFIG.FIRST_ROW + i;
  // sin filas libres: se agrega una fila nueva antes de TOTAL con el mismo formato
  addRows_(sh, 1);
  return last + 1;
}

// Escribe la fila exactamente con las columnas de la hoja (A–O)
function writeRow_(sh, r, e) {
  sh.getRange(r, 1, 1, 8).setValues([[
    e.factura || '',                 // A  NO. FACTURA
    date_(e.fCarga),                 // B  FECHA DE CARGA
    num_(e.importe),                 // C  IMPORTE (PESOS $)
    num_(e.litros),                  // D  CANTIDAD (LITROS)
    e.ticket || '',                  // E  # DE TICKET O FOLIO
    date_(e.fTras),                  // F  FECHA TRASLADO
    num_(e.kmIni),                   // G  KILOMETRAJE INICIAL
    num_(e.kmFin)                    // H  KILOMETRAJE FINAL
  ]]);
  sh.getRange(r, 9).setFormula('=IF(OR(G' + r + '="",H' + r + '=""),"",H' + r + '-G' + r + ')'); // I KM RECORRIDO
  sh.getRange(r, 10).setValue(e.asunto || '');   // J  ASUNTO (J:K combinadas)
  sh.getRange(r, 12, 1, 4).setValues([[e.de || '', e.deC || '', e.a || '', e.aC || '']]); // L–O TRASLADO
}

// ---------- guardar registro ----------
function save_(req) {
  const sh = sh_();
  const e = req.entry || {};
  const r = pickRow_(sh, req.row);
  writeRow_(sh, r, e);
  SpreadsheetApp.flush();

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
  if (num_(e.importe) !== '' && num_(e.importe) > 0) {
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
  return { ok: true, row: r, links: links, evidenceTab: evidenceTab };
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
  const root = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const name = (iso || Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd')).slice(0, 7);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// ---------- día de descanso ----------
function rest_(req) {
  const sh = sh_();
  const r = pickRow_(sh, req.row);
  const km = num_(req.km);
  writeRow_(sh, r, { fTras: req.date, kmIni: km, kmFin: km, asunto: CONFIG.REST_LABEL });
  return { ok: true, row: r };
}

// ---------- borrar ----------
function del_(req) {
  const r = Number(req.row);
  const sh = sh_();
  if (!(r >= CONFIG.FIRST_ROW && r <= lastRow_(sh))) throw new Error('Fila no válida');
  sh.getRange(r, 1, 1, 15).clearContent();
  return { ok: true, row: r };
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
  const root = DriveApp.getFolderById(CONFIG.FOLDER_ID);
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
