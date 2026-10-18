/**
 * LinkedIn Review — viewer web app (deploy: Execute as me, Access: Only myself).
 * Reads run / profile JSON files that the ingest web app saved to one Drive
 * folder, and stores action-checklist ticks in checks.json in that folder.
 *
 * Script property required: FOLDER_ID (printed by the ingest project's setup()).
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('LinkedIn Review')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setFaviconUrl('https://www.gstatic.com/images/branding/product/1x/apps_script_48dp.png');
}

function folder_() {
  const id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!id) throw new Error('Set the FOLDER_ID script property (Project Settings → Script properties).');
  return DriveApp.getFolderById(id);
}

function readJson_(name) {
  const it = folder_().getFilesByName(name);
  return it.hasNext() ? it.next().getBlob().getDataAsString('UTF-8') : null;
}

/** All runs, newest first, as a JSON string: [{id, data}]. */
function listRuns() {
  const out = [];
  const it = folder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = f.getName().match(/^run_(r\d{8}-\d{4})\.json$/);
    if (!m) continue;
    try { out.push({ id: m[1], data: JSON.parse(f.getBlob().getDataAsString('UTF-8')) }); }
    catch (e) { console.warn('Skipping unreadable ' + f.getName()); }
  }
  out.sort((a, b) => String(b.data.run_at || '').localeCompare(String(a.data.run_at || '')));
  return JSON.stringify(out.slice(0, 100));
}

function getRun(id) { return readJson_('run_' + id + '.json'); }
function getProfile(id) { return readJson_('profile_' + id + '.json'); }

/** Checklist ticks as a JSON string: [{id, data}], id = "<run_id>__<item>". */
function listChecks() {
  const m = JSON.parse(readJson_('checks.json') || '{}');
  return JSON.stringify(Object.keys(m).map(k => ({ id: k, data: m[k] })));
}

function setCheck(id, json) {
  if (!/^r\d{8}-\d{4}__[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('bad check id');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const folder = folder_();
    const it = folder.getFilesByName('checks.json');
    const file = it.hasNext() ? it.next() : null;
    const m = JSON.parse(file ? file.getBlob().getDataAsString('UTF-8') : '{}');
    m[id] = JSON.parse(json);
    const text = JSON.stringify(m);
    if (file) file.setContent(text); else folder.createFile('checks.json', text, 'application/json');
  } finally {
    lock.releaseLock();
  }
  return true;
}
