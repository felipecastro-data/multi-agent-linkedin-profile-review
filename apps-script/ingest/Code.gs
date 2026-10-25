/**
 * LinkedIn Review — ingest web app (deploy: Execute as me, Access: Anyone).
 * Claude Code POSTs each run (and its profile and agent stats) here; the script saves it as a JSON file in the
 * Drive folder the viewer reads. Every request must carry INGEST_TOKEN.
 * This project serves no review data: doGet only returns "ok".
 *
 * First time: run setup() once from the editor, copy the two values it logs.
 */

const KINDS = { run: 'run_', profile: 'profile_', stats: 'stats_' };
const ID_RE = /^r\d{8}-\d{4}$/;
const MAX_BYTES = 400 * 1024;

function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('FOLDER_ID')) {
    p.setProperty('FOLDER_ID', DriveApp.createFolder('LinkedIn Review data').getId());
  }
  if (!p.getProperty('INGEST_TOKEN')) {
    p.setProperty('INGEST_TOKEN', Utilities.getUuid() + Utilities.getUuid().replace(/-/g, ''));
  }
  console.log('FOLDER_ID (paste into the viewer project): ' + p.getProperty('FOLDER_ID'));
  console.log('INGEST_TOKEN (paste into .env as LR_INGEST_TOKEN): ' + p.getProperty('INGEST_TOKEN'));
}

function doGet() {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    if (!raw || raw.length > MAX_BYTES * 2) return reply_({ ok: false, error: 'empty or too large' });
    const body = JSON.parse(raw);
    const p = PropertiesService.getScriptProperties();
    const token = p.getProperty('INGEST_TOKEN');
    if (!token || body.token !== token) return reply_({ ok: false, error: 'unauthorized' });

    const folder = DriveApp.getFolderById(p.getProperty('FOLDER_ID'));

    if (body.kind === 'checks') {           // one-time backfill of checklist ticks
      const name = 'checks.json';
      return reply_(write_(folder, name, JSON.stringify(body.data || {})));
    }
    const prefix = KINDS[body.kind];
    if (!prefix) return reply_({ ok: false, error: 'kind must be run, profile, stats or checks' });
    if (!ID_RE.test(body.id || '')) return reply_({ ok: false, error: 'id must look like r20261015-2302' });
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return reply_({ ok: false, error: 'data must be a JSON object' });
    }
    const text = JSON.stringify(body.data);
    if (text.length > MAX_BYTES) return reply_({ ok: false, error: 'document over 400 KB' });
    return reply_(write_(folder, prefix + body.id + '.json', text));
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message || err) });
  }
}

function write_(folder, name, text) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const it = folder.getFilesByName(name);
    if (it.hasNext()) it.next().setContent(text);
    else folder.createFile(name, text, 'application/json');
  } finally {
    lock.releaseLock();
  }
  return { ok: true, file: name, bytes: text.length };
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
