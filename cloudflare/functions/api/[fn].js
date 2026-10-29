// POST /api/<fn> with a JSON array of arguments — the Cloudflare twin of the google.script.run API in
// apps-script/viewer/Code.gs (listRuns, listStats, getRun, getProfile, listChecks, setCheck), reading the
// same "LinkedIn Review data" Drive folder through the Google service account (Editor on the folder, so
// setCheck can rewrite checks.json). Results keep Code.gs's shapes (JSON strings) so the Index.html shim
// is the same on both hosts. Cloudflare Access sits in front of the site; this function also verifies
// the Access token itself so a misconfigured policy fails closed.

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive";
const CHECK_ID_RE = /^r\d{8}-\d{4}__[A-Za-z0-9_-]{1,40}$/;
const RUN_ID_RE = /^r\d{8}-\d{4}$/;
// Workers allow 50 subrequests per invocation (token + folder listing + one per file), so a listing
// returns the newest files only. Code.gs returns up to 100.
const MAX_LIST = 40;

let cachedToken = null; // { value, exp } — reused across requests on a warm isolate
let cachedCerts = null; // { keys, exp }

const API = { listRuns, listStats, getRun, getProfile, listChecks, setCheck };

export async function onRequestPost({ request, env, params }) {
  try {
    await verifyAccess(request, env);
  } catch (e) {
    return json({ error: "Unauthorized" }, 401);
  }
  const fn = Object.hasOwn(API, params.fn) ? API[params.fn] : null;
  if (!fn) return json({ error: "Unknown function" }, 404);
  try {
    const args = await request.json().catch(() => []);
    const result = await fn(env, ...(Array.isArray(args) ? args : []));
    return json({ result }, 200);
  } catch (e) {
    console.error(params.fn + ": " + e.message);
    return json({ error: e.message }, e.status || 502);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/* ---------- API ---------- */

function listRuns(env) { return list(env, /^run_(r\d{8}-\d{4})\.json$/); }
function listStats(env) { return list(env, /^stats_(r\d{8}-\d{4})\.json$/); }

async function getRun(env, id) {
  if (!RUN_ID_RE.test(id || "")) throw badRequest("bad run id");
  return readByName(env, "run_" + id + ".json");
}

async function getProfile(env, id) {
  if (!RUN_ID_RE.test(id || "")) throw badRequest("bad run id");
  return readByName(env, "profile_" + id + ".json");
}

async function listChecks(env) {
  const m = JSON.parse((await readByName(env, "checks.json")) || "{}");
  return JSON.stringify(Object.keys(m).map(k => ({ id: k, data: m[k] })));
}

// No script lock here (Code.gs has one): two ticks landing at the same instant can lose one.
async function setCheck(env, id, text) {
  if (!CHECK_ID_RE.test(id || "")) throw badRequest("bad check id");
  const value = JSON.parse(text);
  const file = (await folderFiles(env)).find(f => f.name === "checks.json");
  // A service account has no Drive storage quota, so it can update checks.json but not create it.
  if (!file) throw new Error("checks.json is missing from the Drive folder.");
  const m = JSON.parse((await readFile(env, file.id)) || "{}");
  m[id] = value;
  const res = await drive(env, UPLOAD + "/" + file.id + "?uploadType=media", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(m)
  });
  if (!res.ok) throw new Error("Drive update failed (HTTP " + res.status + ").");
  return true;
}

async function list(env, re) {
  const files = (await folderFiles(env))
    .map(f => ({ id: f.id, m: f.name.match(re) }))
    .filter(f => f.m)
    .sort((a, b) => b.m[1].localeCompare(a.m[1])) // ids are timestamps: newest first
    .slice(0, MAX_LIST);
  const out = [];
  await Promise.all(files.map(async f => {
    try { out.push({ id: f.m[1], data: JSON.parse(await readFile(env, f.id)) }); }
    catch (e) { console.warn("Skipping unreadable " + f.m[0]); }
  }));
  out.sort((a, b) => String(b.data.run_at || "").localeCompare(String(a.data.run_at || "")));
  return JSON.stringify(out);
}

/* ---------- Drive ---------- */

async function folderFiles(env) {
  if (!env.FOLDER_ID) throw new Error("Set the FOLDER_ID secret.");
  const q = "'" + env.FOLDER_ID + "' in parents and trashed = false";
  const res = await drive(env, DRIVE + "?pageSize=1000&fields=files(id,name)&q=" + encodeURIComponent(q));
  if (!res.ok) throw new Error("Drive listing failed (HTTP " + res.status + ").");
  return (await res.json()).files || [];
}

async function readByName(env, name) {
  const file = (await folderFiles(env)).find(f => f.name === name);
  return file ? readFile(env, file.id) : null;
}

async function readFile(env, id) {
  const res = await drive(env, DRIVE + "/" + id + "?alt=media");
  if (!res.ok) throw new Error("Drive read failed (HTTP " + res.status + ").");
  return res.text();
}

async function drive(env, url, init = {}) {
  const token = await googleToken(env);
  return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: "Bearer " + token } });
}

/* ---------- Cloudflare Access ---------- */

async function verifyAccess(request, env) {
  if (env.DEV_NO_ACCESS === "1") return; // local `wrangler pages dev` only (.dev.vars)
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new Error("Access not configured");
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) throw new Error("Missing Access token");
  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(b64urlDecodeText(h));
  const claims = JSON.parse(b64urlDecodeText(p));
  const issuer = "https://" + env.ACCESS_TEAM_DOMAIN;
  if (claims.iss !== issuer) throw new Error("Bad issuer");
  const allowed = env.ACCESS_AUD.split(",").map(s => s.trim()).filter(Boolean);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some(a => allowed.includes(a))) throw new Error("Bad audience");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("Expired");
  const jwk = (await accessCerts(issuer)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(h + "." + p));
  if (!ok) throw new Error("Bad signature");
}

async function accessCerts(issuer) {
  if (cachedCerts && cachedCerts.exp > Date.now()) return cachedCerts.keys;
  const res = await fetch(issuer + "/cdn-cgi/access/certs");
  if (!res.ok) throw new Error("Access certs HTTP " + res.status);
  const keys = (await res.json()).keys;
  cachedCerts = { keys, exp: Date.now() + 60 * 60 * 1000 };
  return keys;
}

/* ---------- Google service account ---------- */

async function googleToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60 * 1000) return cachedToken.value;
  // Accept the value as written in .dev.vars, where it may be wrapped in quotes.
  const sa = JSON.parse(env.GOOGLE_SA_KEY.trim().replace(/^'([\s\S]*)'$/, "$1"));
  const now = Math.floor(Date.now() / 1000);
  const enc = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." +
    enc({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 });
  const der = b64Decode(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + b64url(sig)
    })
  });
  if (!res.ok) throw new Error("Google sign-in failed (HTTP " + res.status + ").");
  const data = await res.json();
  cachedToken = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

/* ---------- base64 helpers ---------- */

function base64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64url(bytes) {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64Decode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  return b64Decode(str + "=".repeat((4 - str.length % 4) % 4));
}
function b64urlDecodeText(str) {
  return new TextDecoder().decode(b64urlDecode(str));
}
