import { DEFAULTS } from "./settings.js";
import { PROMPT_VERSION, LEVEL_LABELS_HU, TONES, TOPICS, USD_PER_MTOK, scoreWithTypeSafe, matchInterest } from "./scorers.js";


const CACHE_TTL_MS = 48 * 3600 * 1000;

// Ikonkattintás: a Zajszűrő panel megnyitása az aktuális lapon (bármely oldalon, activeTab jogosultsággal).
// Ahol nem lehet szkriptet futtatni (chrome://, Chrome Web Store), a beállítások nyílnak meg.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["src/content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content.js"] });
  } catch {
    chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "open-options") chrome.runtime.openOptionsPage();
});

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

// kisbetűs, egységes szóközű cím rövid hash-e (a levágott „…” cím külön kulcs, mert más a válasz)
function titleKey(title) {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (h * 33) ^ t.charCodeAt(i);
  return `t${(h >>> 0).toString(36)}${t.length.toString(36)}`;
}

async function readCache(keys) {
  const got = await chrome.storage.local.get(keys);
  const now = Date.now();
  const hits = {};
  for (const k of keys) if (got[k] && now - got[k].t < CACHE_TTL_MS) hits[k] = got[k].r;
  return hits;
}

async function pruneCache() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const stale = Object.keys(all).filter((k) => k.startsWith("c:") && now - (all[k].t || 0) > CACHE_TTL_MS);
  if (stale.length) await chrome.storage.local.remove(stale);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "kv-score") return;
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => ctrl.abort());
  const runs = new Map(); // run id → AbortController, hogy egy futás (pl. elavult keresés) külön leállítható legyen
  port.onMessage.addListener((msg) => {
    if (msg.type === "cancel") return runs.get(msg.run)?.abort();
    if (msg.type !== "score" && msg.type !== "interest") return;
    const c = new AbortController();
    runs.set(msg.run, c);
    run(port, msg, AbortSignal.any([ctrl.signal, c.signal]))
      .catch((e) => safePost(port, { type: "fatal", run: msg.run, message: e.message }))
      .finally(() => runs.delete(msg.run));
  });
});

function safePost(port, msg) {
  try {
    port.postMessage(msg);
  } catch {}
}

const LABELS = { levels: LEVEL_LABELS_HU, tones: TONES, topics: TOPICS };

// A tartalomszkript több futást is küldhet ugyanazon a porton (új címek, kereső), ezért minden üzenet viszi a `run` azonosítót.
// type "score": kattintásvadász-pontozás gyorsítótárral; type "interest": érdeklődés szerinti keresés (`query`), gyorsítótár nélkül.
async function run(port, msg, signal) {
  const { items, run: runId } = msg;
  const interest = msg.type === "interest";
  const force = interest || !!msg.force;
  const post = (m) => safePost(port, { ...m, run: runId });
  // a témák és a buborék miatt mindig a 3 extra kérdéssel együtt pontozunk
  const cfg = { ...(await getSettings()), extras: true };
  if (!cfg.apiKey) {
    post({ type: "fatal", message: "Nincs megadva TypeSafe API-kulcs. Beállítások: kattints a bővítmény ikonjára." });
    return;
  }
  // A kulcs a cím szövege (nem az oldal saját azonosítója), így ugyanaz a hír másik oldalon
  // (pl. hirstart és telex) vagy aloldalon már a gyorsítótárból jön. Az „x”: az extra kérdésekkel együtt.
  const keyOf = (it) => `c:${PROMPT_VERSION}x:ts:${cfg.model}:${titleKey(it.title)}`;
  const itemById = new Map(items.map((it) => [it.id, it]));
  const batchSize = Math.max(1, Math.min(50, Number(cfg.batchSize) || 10));
  const concurrency = Math.max(1, Math.min(16, Number(cfg.concurrency) || 6));

  const call = interest ? (c) => matchInterest(c, String(msg.query).slice(0, 500), cfg, signal) : (c) => scoreWithTypeSafe(c, cfg, signal);

  post({ type: "start", at: Date.now(), provider: `TypeSafe · ${cfg.model}`, labels: LABELS, batchSize, concurrency, qpc: interest ? 1 : 4, usdPerMtok: USD_PER_MTOK, usdHuf: Number(cfg.usdHuf) || 0 });

  let todo = items;
  if (!force) {
    const hits = await readCache(items.map(keyOf));
    const cached = [];
    todo = [];
    for (const it of items) {
      const h = hits[keyOf(it)];
      if (h) cached.push({ ...h, id: it.id, cached: true });
      else todo.push(it);
    }
    if (cached.length) post({ type: "results", results: cached });
  }

  // az oldalon többször szereplő, azonos című hír csak egyszer megy ki; a válasz mindegyik példányé lesz
  const dupes = new Map();
  todo = todo.filter((it) => {
    const k = keyOf(it);
    if (dupes.has(k)) return dupes.get(k).push(it.id), false;
    return dupes.set(k, []), true;
  });
  const withDupes = (results) => results.flatMap((r) => [r, ...(dupes.get(keyOf(itemById.get(r.id))) || []).map((id) => ({ ...r, id }))]);

  const chunks = [];
  for (let i = 0; i < todo.length; i += batchSize) chunks.push(todo.slice(i, i + batchSize));

  let next = 0;
  let errors = 0;
  let lastError = null;

  async function worker(slot) {
    while (next < chunks.length && !signal.aborted) {
      const k = next;
      const chunk = chunks[next++];
      const req = { id: `${runId}:${k}`, slot, n: chunk.length, s: Date.now() };
      post({ type: "req", req });
      try {
        const { results, tokens } = await call(chunk);
        post({ type: "req", req: { ...req, e: Date.now(), ok: true, tokens } });
        const ok = results.filter((r) => !r.error);
        const toStore = {};
        const t = Date.now();
        for (const r of ok) {
          const { id, ...rest } = r;
          toStore[keyOf(itemById.get(id))] = { t, r: rest };
        }
        if (ok.length && !interest) await chrome.storage.local.set(toStore);
        post({ type: "results", results: withDupes(results) });
      } catch (e) {
        if (signal.aborted) return;
        post({ type: "req", req: { ...req, e: Date.now(), ok: false } });
        errors++;
        lastError = e.message;
        post({ type: "results", results: withDupes(chunk.map((it) => ({ id: it.id, error: e.message }))) });
        // kulcs- vagy kéréshiba esetén nincs értelme a többi csomagot is elküldeni
        if ([401, 403, 404, 422].includes(e.status)) {
          const rest = chunks.slice(next).flat();
          next = chunks.length;
          if (rest.length) post({ type: "results", results: withDupes(rest.map((it) => ({ id: it.id, error: e.message }))) });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, (_, slot) => worker(slot)));
  post({ type: "done", at: Date.now(), errors, lastError, scored: todo.length });
  pruneCache().catch(() => {});
}

// ---------------------------------------------------------------- kijelölt szöveg pontozása bármely oldalon (13)

chrome.runtime.onInstalled.addListener(() => {
  // frissítéskor a régi menüpont megmarad, ezért előbb töröljük (különben duplikált azonosító)
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({ id: "kvm-score-selection", title: "Zajszűrő: mennyire kattintásvadász?", contexts: ["selection"] })
  );
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "kvm-score-selection" || !tab || tab.id == null) return;
  const text = (info.selectionText || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const show = (payload) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showToast, args: [payload] }).catch(() => {});
  if (!text) return;
  await show({ pending: true, text });
  const cfg = await getSettings();
  if (!cfg.apiKey) return show({ text, error: "Nincs megadva TypeSafe API-kulcs. Beállítások: kattints a bővítmény ikonjára." });
  const t0 = performance.now();
  try {
    const { results: [r], tokens } = await scoreWithTypeSafe([{ id: "sel", title: text, hint: "" }], { ...cfg, extras: true });
    const ms = Math.round(performance.now() - t0);
    const usd = tokens == null ? null : (tokens * USD_PER_MTOK) / 1e6;
    const huf = usd == null ? null : usd * (Number(cfg.usdHuf) || 0);
    show(r.error ? { text, error: r.error } : { text, r, ms, tokens, usd, huf, model: cfg.model, labels: LABELS });
  } catch (e) {
    show({ text, error: e.message });
  }
});

// Az oldalba injektált függvény: önállónak kell lennie (nem látja a modul változóit).
function showToast(p) {
  const ID = "kvm-toast-host";
  let host = document.getElementById(ID);
  if (!host) {
    host = document.createElement("div");
    host.id = ID;
    host.style.cssText = "position:fixed;z-index:2147483647;top:16px;right:16px;";
    host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    const close = (e) => {
      if (e.type === "keydown" && e.key !== "Escape") return;
      if (e.type === "mousedown" && e.composedPath().includes(host)) return;
      host.remove();
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
  }
  // a kijelölés mellé kerül, ha van
  try {
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) {
      host.style.top = `${Math.min(window.innerHeight - 260, Math.max(8, rect.bottom + 8))}px`;
      host.style.left = `${Math.min(window.innerWidth - 336, Math.max(8, rect.left))}px`;
      host.style.right = "auto";
    }
  } catch {}
  const STOPS = [[0, [36, 138, 82]], [25, [104, 146, 48]], [50, [201, 138, 24]], [75, [214, 92, 38]], [100, [190, 40, 44]]];
  const color = (s) => {
    for (let i = 1; i < STOPS.length; i++) {
      const [s1, c1] = STOPS[i], [s0, c0] = STOPS[i - 1];
      if (s <= s1) return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * ((s - s0) / (s1 - s0)))).join(",")})`;
    }
    return "rgb(190,40,44)";
  };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let body;
  if (p.pending) body = `<div class="muted">Jev pontoz…</div>`;
  else if (p.error) body = `<div class="err">Hiba: ${esc(p.error)}</div>`;
  else {
    const r = p.r, L = p.labels;
    const probs = [0, 1, 2, 3, 4].map((i) => (r.probs && r.probs[String(i)]) || 0);
    body = `
      <div class="big"><span class="pill" style="background:${color(r.score)}">${r.score}</span><b>${esc(L.levels[r.level] || "")}</b></div>
      <div class="bars">${probs.map((v, i) => `<div><i style="height:${Math.max(2, v * 40)}px;background:${color(i * 25)}"></i><span>${Math.round(v * 100)}%</span></div>`).join("")}</div>
      <dl>
        ${r.emotion != null ? `<dt>Érzelmi töltet</dt><dd>${r.emotion}/100</dd>` : ""}
        ${r.tone ? `<dt>Hangvétel</dt><dd>${esc(L.tones[r.tone] || r.tone)}</dd>` : ""}
        ${r.topic ? `<dt>Téma</dt><dd>${esc(L.topics[r.topic] || r.topic)}</dd>` : ""}
        ${r.confidence != null ? `<dt>Biztosság</dt><dd>${r.confidence.toFixed(2).replace(".", ",")}</dd>` : ""}
      </dl>
      <div class="muted">${esc(p.model)} · 4 kérdés · <b>${p.ms} ms</b>${p.tokens != null ? `<br>${p.tokens.toLocaleString("hu-HU")} token · <b>${p.huf.toLocaleString("hu-HU", { maximumSignificantDigits: 2 })} Ft</b> (${p.usd.toLocaleString("hu-HU", { maximumSignificantDigits: 3 })} USD)` : ""}</div>`;
  }
  host.shadowRoot.innerHTML = `
    <style>
      :host { all: initial; }
      .t { width: 320px; box-sizing: border-box; background:#fff; color:#16181d; border:1px solid #e3e6eb; border-radius:12px; padding:12px 14px;
           box-shadow: 0 12px 32px -8px rgba(16,24,40,.25); font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
      .h { font-size:11px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:.05em; }
      .q { margin:4px 0 10px; font-size:12px; color:#4b5260; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      .big { display:flex; gap:8px; align-items:center; font-size:14px; }
      .pill { color:#fff; font-weight:700; border-radius:9px; padding:2px 8px; font-variant-numeric:tabular-nums; }
      .bars { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; align-items:end; height:58px; margin:10px 0 6px; }
      .bars div { display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; gap:2px; }
      .bars i { display:block; width:100%; border-radius:3px 3px 1px 1px; }
      .bars span { font-size:10px; color:#6b7280; font-variant-numeric:tabular-nums; }
      dl { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; margin:6px 0 8px; font-size:12px; }
      dt { color:#6b7280; } dd { margin:0; font-weight:550; }
      .muted { font-size:11.5px; color:#6b7280; }
      .err { font-size:12px; color:#8a1c1c; background:#fdecec; padding:8px 10px; border-radius:8px; }
    </style>
    <div class="t" role="status"><div class="h">Zajszűrő</div><div class="q">„${esc(p.text)}”</div>${body}</div>`;
}
