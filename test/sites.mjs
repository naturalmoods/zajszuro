// Végpontok közti próba valódi oldalakon, Jev-kulcs nélkül: headless Chromiumban megnyitja az oldalt,
// beinjektálja a content.js-t egy szimulált háttérszkripttel (véletlen pontszámok, a kereső a politikai
// címekre ad találatot), majd valódi egér- és billentyűeseményekkel végigpróbálja: pontozás, gépelés +
// Enter, válogatás, fülváltás (a két nézet nem keveredik), elrejtés/nyitás ikonnal.
//   node test/sites.mjs https://telex.hu/ https://24.hu/      (képernyőképek: test/out/)
import { spawn } from "node:child_process";
import fs from "node:fs";
const STUB = "var __sent = [];\nvar chrome = { storage: { local: { get: async () => ({ extras: true }), set: async () => {} } }, runtime: { sendMessage() {}, connect() {\n  let L, D = [], dead = false;\n  window.__conns = (window.__conns || 0) + 1;\n  const P = { __kill() { dead = true; D.forEach((f) => f()); }, onDisconnect: { addListener(f) { D.push(f); } }, onMessage: { addListener(f) { L = f; } }, disconnect() { dead = true; }, postMessage(m) {\n    if (dead) throw new Error(\"Attempting to use a disconnected port object\");\n    if (m.type === \"cancel\") return;\n    __sent.push({ run: m.run, n: m.items.length });\n    const run = m.run, at = Date.now();\n    L({ type: \"start\", run, at, provider: \"TypeSafe \u00b7 jev-latest\", extras: true, qpc: m.type === \"interest\" ? 1 : 4, batchSize: 10, concurrency: 6,\n        labels: { levels: [\"T\u00e9nyszer\u0171\",\"T\u00f6bbnyire t\u00e9nyszer\u0171\",\"Vegyes\",\"Kattint\u00e1svad\u00e1sz\",\"Er\u0151sen kattint\u00e1svad\u00e1sz\"], tones: { negative: \"Negat\u00edv\", neutral: \"Semleges\", positive: \"Pozit\u00edv\" }, topics: { politics: \"Politika\", sport: \"Sport\", economy: \"Gazdas\u00e1g\", celebrity: \"Bulv\u00e1r, celeb\", crime: \"B\u0171n\u00fcgy, baleset\" } } });\n    const chunks = []; for (let i = 0; i < m.items.length; i += 10) chunks.push(m.items.slice(i, i + 10));\n    let next = 0, active = 0;\n    let seed = run * 7 + 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);\n    function worker(slot) {\n      if (next >= chunks.length) { if (--active === 0) L({ type: \"done\", run, at: Date.now(), errors: 0, scored: m.items.length }); return; }\n      const k = next++, chunk = chunks[k], req = { id: run + \":\" + k, slot, n: chunk.length, s: Date.now() };\n      L({ type: \"req\", run, req });\n      setTimeout(() => {\n        L({ type: \"req\", run, req: { ...req, e: Date.now(), ok: true } });\n        if (m.type === \"interest\") { L({ type: \"results\", run, results: chunk.map((it) => ({ id: it.id, match: /Magyar P\u00e9ter|Tisza|Orb\u00e1n|korm\u00e1ny|fidesz/i.test(it.title) ? 0.9 : 0.05 })) }); worker(slot); return; }\n        L({ type: \"results\", run, results: chunk.map((it) => { const s = rnd() * 4; const p = {}; for (let i = 0; i < 5; i++) p[i] = Math.max(0, 1 - Math.abs(i - s)) ; const t = Object.values(p).reduce((a, b) => a + b, 0); for (const i in p) p[i] /= t;\n          return { id: it.id, score: Math.round(s * 25), level: Math.round(s), confidence: 0.5 + rnd() / 2, probs: p, emotion: Math.round(rnd() * 100), tone: [\"negative\",\"neutral\",\"positive\"][Math.floor(rnd()*3)], topic: [\"politics\",\"sport\",\"economy\",\"celebrity\",\"crime\"][Math.floor(rnd()*5)] }; }) });\n        worker(slot);\n      }, 350 + rnd() * 700);\n    }\n    const c = Math.min(6, chunks.length); active = c; for (let s = 0; s < c; s++) worker(s);\n  } };\n  window.__port = P;\n  return P;\n} } };\n";
const ROOT = new URL("..", import.meta.url).pathname;
fs.mkdirSync(`${ROOT}test/out`, { recursive: true });
const cs = fs.readFileSync(`${ROOT}src/content.js`, "utf8");
const css = fs.readFileSync(`${ROOT}src/content.css`, "utf8");
const stub = STUB;
const port = 9334;
const br = spawn("chromium", ["--headless=new", "--no-sandbox", `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync("/tmp/hirrosta-")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(200); } }
async function test(url) {
  const tag = new URL(url).hostname.replace(/^www\./, "");
const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pend = new Map(); const ev = [];
  const exc = [];
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else { ev.push(d.method); if (d.method === "Runtime.exceptionThrown") exc.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300)); } });
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  const shot = async (name) => { const s = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${ROOT}test/out/${tag}-${name}.png`, Buffer.from(s.result.data, "base64")); };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url });
  for (let i = 0; i < 100 && !ev.includes("Page.loadEventFired"); i++) await sleep(200);
  await sleep(2500);
  // süti-ablak elfogadása, ha van
  let consent = false;
  for (let i = 0; i < 15 && !consent; i++) {
    consent = await js(`(() => { const b = [...document.querySelectorAll("button, a")].find((x) => /^(elfogadom|elfogad|accept all|i agree|agree|accept|yes, i agree)$/i.test(x.textContent.trim())); if (b) b.click(); return !!b; })()`);
    if (!consent) await sleep(400);
  }
  await sleep(800);
  // A valódi tartalomszkripthez hasonlóan elszigetelt környezetben (isolated world) fut: az oldal
  // felülírásai (pl. window.open) nem hatnak rá, a DOM és az események viszont közösek.
  const frameId = (await call("Page.getFrameTree")).result.frameTree.frame.id;
  const ctx = (await call("Page.createIsolatedWorld", { frameId, worldName: "hirrosta" })).result.executionContextId;
  const iso = async (expression) => { const r = await call("Runtime.evaluate", { expression, contextId: ctx, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  await js(`(() => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(css)}; document.head.appendChild(st); return 1; })()`);
  await iso(`window.eval(${JSON.stringify(stub)}); window.eval(${JSON.stringify(cs)}); 1`);
  const R = `document.getElementById("kvm-panel-host").shadowRoot`;
  const clickAt = async (sel) => {
    const r = await js(`(() => { const e = ${R}.querySelector(${JSON.stringify(sel)}); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await call("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
    await sleep(300);
  };
  const typeText = async (t) => { await call("Input.insertText", { text: t }); };
  const pressEnter = async () => { for (const type of ["keyDown", "keyUp"]) await call("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined }); };
  const waitFor = async (cond, ms = 30000) => { for (let i = 0; i < ms / 200; i++) { if (await js(cond)) return true; await sleep(200); } return false; };
  const scored = await waitFor(`${R}.getElementById("lTime").textContent === "teljes idő"`);
  await shot("1-pick");
  await clickAt("#q");
  await typeText("kisvállalkozásokat érintő hírek");
  const typed = await js(`${R}.getElementById("q").value`);
  const placeholder = await js(`${R}.getElementById("q").placeholder`);
  const examples = await js(`${R}.querySelectorAll("#ex").length`);
  await pressEnter();
  const searched = await waitFor(`${R}.getElementById("hitsum").textContent.includes("címből")`);
  const pickState = await js(`({ view: document.body.className.match(/kvm-view-\\w+/g), dim: document.querySelectorAll(".kvm-dim").length, hit: document.querySelectorAll(".kvm-hit").length, badgesVisible: [...document.querySelectorAll(".kvm-badge")].filter((b) => b.offsetParent).length, hitsum: ${R}.getElementById("hitsum").textContent })`);
  await shot("2-pick-search");
  await clickAt('.tabs button[data-tab="bait"]');
  await sleep(500);
  const baitState = await js(`({ view: document.body.className.match(/kvm-view-\\w+/g), dimVisible: [...document.querySelectorAll(".kvm-dim")].filter((r) => getComputedStyle(r).opacity < 0.5).length, badgesVisible: [...document.querySelectorAll(".kvm-badge")].filter((b) => b.offsetParent).length })`);
  await shot("3-bait");
  await clickAt('.tabs button[data-tab="speed"]');
  await sleep(400);
  const speedState = await js(`({ view: document.body.className.match(/kvm-view-\\w+/g) })`);
  await clickAt('.tabs button[data-tab="pick"]');
  await sleep(400);
  const backState = await js(`({ view: document.body.className.match(/kvm-view-\\w+/g), dimVisible: [...document.querySelectorAll(".kvm-dim")].filter((r) => getComputedStyle(r).opacity < 0.5).length, badgesVisible: [...document.querySelectorAll(".kvm-badge")].filter((b) => b.offsetParent).length })`);
  // ikon újrakattintás: csukja, majd nyitja
  await iso(`window.eval(${JSON.stringify(cs)})`); await sleep(300);
  const collapsed = await js(`${R}.querySelector(".p").hidden`);
  await iso(`window.eval(${JSON.stringify(cs)})`); await sleep(300);
  const reopened = !(await js(`${R}.querySelector(".p").hidden`));
  // lista-elemre kattintva a cikkre kell jutni (ugyanazon a lapon vagy új lapon, ahogy az oldal linkje)
  await clickAt('.tabs button[data-tab="bait"]');
  const topCount = await js(`${R}.querySelectorAll("#top a").length`);
  const itemCount = await js(`${R}.getElementById("nTotal").textContent`);
  const from = await js("location.href");
  // csak a valódi lapok számítanak (a listában háttérfolyamatok is jönnek-mennek)
  const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((x) => x.type === "page").length;
  const tabsBefore = await pages();
  const expected = await js(`${R}.querySelector("#top a").href`);
  await clickAt("#top a");
  await sleep(3000);
  const tabsAfter = await pages();
  let now = "?";
  try { now = await js("location.href"); } catch {}
  const navigated = now !== from || tabsAfter > tabsBefore;
  const p = pickState, b = baitState, k = backState;
    const ok = placeholder.startsWith("pl. ") && examples === 0 && topCount === Math.min(10, Number(itemCount)) && navigated && scored && searched && p.badgesVisible === 0 && p.dim > 0 && String(b.view) === "kvm-view-bait" && b.dimVisible === 0 && b.badgesVisible > 0 && String(speedState.view) === "kvm-view-bait" && String(k.view) === "kvm-view-pick" && k.badgesVisible === 0 && collapsed && reopened;
    if (!ok) process.exitCode = 1;
    console.log(ok ? "OK  " : "HIBA", url, "|", p.hitsum, "| pontszám látható:", b.badgesVisible, "| top:", topCount, "| helyőrző:", placeholder, "| kattintás →", tabsAfter > tabsBefore ? "új lap" : now.slice(0, 70), "(link:", expected.slice(0, 50) + ")");
  ws.close();
  
}
for (const u of process.argv.slice(2)) await test(u);
br.kill();
