// Zajszűrő – tartalomszkript. A hirkereso.hu-n és a hirstart.hu-n magától indul, máshol a bővítmény ikonjára
// kattintva injektálja a háttérszkript. Összegyűjti a címeket, és megjeleníti a válogatást és a pontszámokat.
(() => {
  // újabb ikonkattintás: a már futó példány nyitja/csukja a panelt
  if (window.__kvmLoaded) return window.__kvmToggle && window.__kvmToggle();
  window.__kvmLoaded = true;

  // ------------------------------------------------------------ címek összegyűjtése

  // hirkereso: rd.hirkereso.hu/rd/<id>?url=<cikk>, sorok: li
  // hirstart: közvetlen cikklink rel="hs_<id>_…" jelöléssel, sorok: div.rovidhir / div.boxhir
  // bármely más oldal: általános címfelismerés (GENERIC)
  const HIRSTART = location.hostname.endsWith("hirstart.hu");
  const HIRKERESO = location.hostname.endsWith("hirkereso.hu");
  const GENERIC = !HIRSTART && !HIRKERESO;
  const ROW = HIRSTART ? ".rovidhir, .boxhir, li" : "li";
  const LINKS = HIRSTART ? 'a[rel*="hs_"]' : HIRKERESO ? 'a[href*="rd.hirkereso.hu/rd/"]' : "a[href]";
  const HEADING = "h1, h2, h3, h4";
  const GENERIC_MAX = 600; // ponytail: felső korlát a költség miatt; végtelen görgetésnél a többi cím kimarad
  // a legtöbb cím egy oldalon (7)
  const BIG_PAGE = HIRSTART && !location.pathname.startsWith("/osszes_mai_hir") ? "/osszes_mai_hir.php" : null;

  function slugHint(target) {
    try {
      if (!target) return "";
      const path = new URL(target).pathname;
      const parts = path.split("/").filter(Boolean).map((p) => p.replace(/\.(html?|php|aspx?)$/i, ""));
      // a leghosszabb, betűket tartalmazó szakasz általában a cím
      const best = parts.filter((p) => /[a-z]{3,}/i.test(p)).sort((a, b) => b.length - a.length)[0] || "";
      return best.replace(/[-_]\d{3,}.*$/, "").replace(/[-_]+/g, " ").trim().slice(0, 160);
    } catch {
      return "";
    }
  }

  function sourceOf(target) {
    try {
      return new URL(target).hostname.replace(/^(www|m)\./, "");
    } catch {
      return "";
    }
  }

  // Általános oldalon hírcím az a link, amely nem menüben/fejlécben/láblécben van, és a szövege
  // (vagy a benne lévő címsor szövege) címhosszúságú, több szavas mondat.
  const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|taboola\.com|outbrain\.com|adform\.net|criteo\.com)$/i;
  const CHROME_PARTS = "nav, header, footer, aside, form, [role=navigation], [role=banner], [role=contentinfo], [role=menu], [aria-hidden=true]";
  // Általános oldalon a látható szöveg számít (innerText): így a rovatcímke nem tapad a címhez,
  // és a rejtett menük kimaradnak. Az elején álló időpont („08:37 …”) nem a cím része.
  function titleOf(a) {
    if (!GENERIC) return a.textContent.replace(/\s+/g, " ").trim();
    const h = a.querySelector(HEADING);
    return (h || a).innerText.replace(/\s+/g, " ").trim().replace(/^\d{1,2}:\d{2}\s+/, "");
  }
  const NOT_TITLE = /^(tovább a |olvass tovább|bővebben|sign up|subscribe|tip us off|feliratkoz|előfizet)|termékoldal|\d\s?Ft\s+Tovább/i;
  function isTitle(t) {
    if (!GENERIC) return t.length >= 12;
    if (t.length < 20 || t.length > 220 || NOT_TITLE.test(t)) return false;
    // árfolyam- és tőzsdecsíkok: kevés a betű
    const letters = (t.match(/\p{L}/gu) || []).length;
    const words = t.split(" ").filter((w) => /\p{L}{3}/u.test(w)).length;
    return words >= 3 && letters / t.length >= 0.6;
  }
  const hashStr = (t) => {
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = (h * 33) ^ t.charCodeAt(i);
    return (h >>> 0).toString(36);
  };

  function linkInfo(a) {
    if (GENERIC) {
      if (!/^https?:$/.test(a.protocol) || AD_HOSTS.test(a.hostname) || a.closest(CHROME_PARTS)) return null;
      const u = new URL(a.href);
      u.hash = "";
      if (u.href === location.href.split("#")[0]) return null;
      return { id: `g${hashStr(u.href)}`, target: u.href };
    }
    if (HIRSTART) {
      const m = a.rel.match(/\bhs_(\d+)_/);
      return m && { id: `hs${m[1]}`, target: a.href };
    }
    const m = a.href.match(/\/rd\/(\d+)/);
    return m && { id: m[1], target: new URL(a.href).searchParams.get("url") };
  }

  // Új linkeket keres (első betöltéskor és később is, 8). Visszaadja az új címeket.
  const seen = new WeakSet();
  // Két lépésben: előbb minden linket kiolvas, csak utána ír az oldalba, különben minden
  // jelvény beszúrása után újra kellene számolni az elrendezést (innerText).
  function scan() {
    const found = [];
    for (const a of document.querySelectorAll(LINKS)) {
      if (seen.has(a)) continue;
      const title = titleOf(a);
      if (!isTitle(title)) continue;
      const info = linkInfo(a);
      if (info) found.push({ a, title, info });
    }
    const fresh = [];
    for (const { a, title, info } of found) {
      let it = state.byId.get(info.id);
      if (!it && GENERIC && state.items.length >= GENERIC_MAX) continue;
      seen.add(a);
      if (!it) {
        it = { id: info.id, title, hint: slugHint(info.target), src: sourceOf(info.target), anchors: [], badges: [] };
        state.byId.set(it.id, it);
        state.items.push(it);
        fresh.push(it);
      }
      it.anchors.push(a);
      addBadge(it, a);
      const r = state.results.get(it.id);
      if (r) paint(it, r, false);
    }
    return fresh;
  }

  // ------------------------------------------------------------ színek

  // Színskála: zöld → sárgászöld → borostyán → narancs → piros (RGB-interpoláció a pontok között)
  const STOPS = [
    [0, [36, 138, 82]],
    [25, [104, 146, 48]],
    [50, [201, 138, 24]],
    [75, [214, 92, 38]],
    [100, [190, 40, 44]],
  ];
  function rgbAt(s) {
    s = Math.max(0, Math.min(100, s));
    for (let i = 1; i < STOPS.length; i++) {
      const [s1, c1] = STOPS[i];
      const [s0, c0] = STOPS[i - 1];
      if (s <= s1) {
        const t = (s - s0) / (s1 - s0);
        return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  const badgeColor = (s) => `rgb(${rgbAt(s).join(",")})`;
  const tintColor = (s) => `rgba(${rgbAt(s).join(",")},${(0.07 + s / 700).toFixed(3)})`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ------------------------------------------------------------ állapot

  const state = {
    items: [],
    byId: new Map(),
    results: new Map(),
    t0: 0, // a fő futás kezdete / vége (performance.now)
    t1: 0,
    mainDone: false,
    done: true, // nincs folyamatban futás
    runs: new Map(), // run id → { more, n, t }
    reqs: new Map(), // Jev-hívások az idővonalhoz (4)
    base: 0, // az idővonal nullpontja (Date.now)
    lanes: 6,
    batchSize: 10,
    qpc: 1, // kérdés/cím az utolsó futásban (idővonal)
    // költség: a background a start üzenetben küldi az árat és az árfolyamot
    usdPerMtok: 0.042,
    usdHuf: 320,
    mainTokens: 0, // az oldal pontozásának bemeneti tokenjei
    pageTokens: 0, // minden hívás ezen az oldalon (pontozás, újramérés, keresések)
    job: "", // mit mutat az idővonal
    interest: null, // kereső: { query, hits: Map id → 0–1, run, t0, ms, done }
    labels: { levels: [], tones: {}, topics: {} },
    notice: null,
    lastError: null,
    cachedCount: 0,
    ui: { mode: "badge", threshold: 60, hide: false, collapsed: false, topics: [], tab: "pick", view: "pick" },
  };

  // ------------------------------------------------------------ jelvények

  const badgeItem = new WeakMap();
  // a sor, amelyet a szűrés halványít / kiemel
  function rowOf(a) {
    if (!GENERIC) return a.closest(ROW);
    const card = a.closest("article, li");
    if (card && card.textContent.length < 700) return card;
    return a.closest(HEADING) || a;
  }

  function addBadge(it, a) {
    const li = rowOf(a);
    if (li) li.classList.add("kvm-row");
    const b = document.createElement("span");
    b.className = "kvm-badge kvm-pending";
    b.textContent = "00";
    b.setAttribute("aria-label", "Pontozás folyamatban");
    // a hirstart címlinkje blokkszintű (sorvágással), ezért ott a linken belülre kerül
    if (HIRSTART) a.prepend(b);
    else if (GENERIC) (a.querySelector(HEADING) || a).prepend(b);
    else a.parentNode.insertBefore(b, a);
    badgeItem.set(b, it);
    it.badges.push({ b, li });
  }

  function paint(it, r, animate) {
    for (const { b, li } of it.badges) {
      b.classList.remove("kvm-pending");
      if (r.error) {
        b.classList.add("kvm-error");
        b.textContent = "!";
        b.setAttribute("aria-label", `Hiba: ${r.error}`);
        continue;
      }
      b.textContent = String(r.score);
      b.style.backgroundColor = badgeColor(r.score);
      b.setAttribute("aria-label", `Kattintásvadász-pontszám: ${r.score}/100 – ${state.labels.levels[r.level] || ""}`);
      if (animate) {
        // söprés (10): a képernyőn fentről lefelé, hullámszerűen jelennek meg
        const top = b.getBoundingClientRect().top;
        const vh = window.innerHeight;
        b.style.animationDelay = top > 0 && top < vh ? `${Math.round((top / vh) * 450)}ms` : "0ms";
        b.classList.add("kvm-in");
      }
      if (li) {
        li.style.setProperty("--kvm-tint", tintColor(r.score));
        li.classList.toggle("kvm-over", r.score >= state.ui.threshold);
      }
    }
    filterRow(it);
  }

  // Témaszűrő és kereső: a nem illő sorok elhalványulnak, a találatok kiemelődnek.
  // Amíg egy címre nincs válasz, marad normál, így a szűrés a válaszokkal együtt „terjed”.
  const MATCH = 0.5; // ennyi igen-valószínűségtől találat; ha túl sok/kevés a találat, ezt érdemes hangolni
  function filterRow(it) {
    const r = state.results.get(it.id);
    const topics = state.ui.topics;
    const offTopic = topics.length > 0 && !!r && !!r.topic && !topics.includes(r.topic);
    const m = state.interest ? state.interest.hits.get(it.id) : undefined;
    const hit = typeof m === "number" && m >= MATCH;
    const miss = typeof m === "number" && m < MATCH;
    for (const { li } of it.badges)
      if (li) {
        li.classList.toggle("kvm-dim", offTopic || miss);
        li.classList.toggle("kvm-hit", hit);
      }
  }
  const applyFilters = () => state.items.forEach(filterRow);

  function applyThreshold() {
    for (const it of state.items) {
      const r = state.results.get(it.id);
      if (!r || r.error) continue;
      for (const { li } of it.badges) if (li) li.classList.toggle("kvm-over", r.score >= state.ui.threshold);
    }
  }

  // Az oldalon egyszerre csak az egyik nézet hat: a válogatás (kiemelés, halványítás, témák)
  // vagy a kattintásvadász-pontszámok (szám, színezés, küszöb). A Sebesség fül az előzőt hagyja.
  function applyMode() {
    const cl = document.body.classList;
    cl.toggle("kvm-view-pick", state.ui.view === "pick");
    cl.toggle("kvm-view-bait", state.ui.view === "bait");
    cl.toggle("kvm-mode-heat", state.ui.mode === "heat");
    cl.toggle("kvm-mode-filter", state.ui.mode === "filter");
    cl.toggle("kvm-hide", state.ui.mode === "filter" && state.ui.hide);
  }

  // szkennervonal futás közben (10)
  const scanLine = document.createElement("div");
  scanLine.className = "kvm-scan";
  scanLine.setAttribute("aria-hidden", "true");

  // ------------------------------------------------------------ panel (shadow DOM)

  const host = document.createElement("div");
  host.id = "kvm-panel-host";
  // teljes magasságú oldalsáv a jobb szélen; a szélessége a content.css html.kvm-docked margójával egyezik (360px)
  host.style.cssText = "position:fixed;top:0;right:0;bottom:0;z-index:2147483647;"; // a legfelső réteg (süti-ablakok is ezt használják)
  const root = host.attachShadow({ mode: "open" });

  const SRC_ROWS = 6;
  const SRC_H = 22;

  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .p {
      width: 360px; height: 100%; display: flex; flex-direction: column;
      background: #fff; color: #16181d;
      border-left: 1px solid #e3e6eb;
      box-shadow: -12px 0 32px -16px rgba(16,24,40,.22);
      font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      overflow: hidden;
    }
    .p[hidden] { display:none; }
    .open { all:unset; cursor:pointer; position:absolute; top:0; right:0; display:flex; gap:6px; align-items:center;
            padding:8px 12px 8px 10px; background:#16181d; color:#fff; font: 600 12.5px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
            border-radius: 10px 0 0 10px; box-shadow: 0 6px 18px -6px rgba(16,24,40,.35); }
    .open[hidden] { display:none; }
    .open:hover { background:#2a2f38; }
    .open:focus-visible { outline:2px solid #2f6fdb; outline-offset:2px; }
    .hd { display:flex; align-items:center; gap:8px; padding: 14px 14px 10px; }
    .ttl { font-weight: 650; font-size: 13.5px; letter-spacing: -.005em; flex:1; }
    .ib { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px; display:grid; place-items:center; color:#5b6270; }
    .ib:hover { background:#f2f4f7; }
    .status { padding: 0 14px 10px; font-size: 12px; color: #4b5260; font-variant-numeric: tabular-nums; }
    .status b { color:#16181d; }
    .tabs { display:grid; grid-template-columns: repeat(3, auto); justify-content:start; gap:14px; padding: 0 14px; border-bottom:1px solid #eef0f3; }
    .tabs button { all:unset; cursor:pointer; font-size:12.5px; color:#6b7280; padding: 10px 0 8px; border-bottom:2px solid transparent; margin-bottom:-1px; }
    .tabs button:hover { color:#16181d; }
    .tabs button[aria-selected="true"] { color:#16181d; font-weight:600; border-bottom-color:#16181d; }
    .tabs button:focus-visible { outline:2px solid #2f6fdb; outline-offset:2px; border-radius:3px; }
    .pane[hidden] { display:none; }
    .lead { margin:0 0 10px; font-size:12px; line-height:1.45; color:#4b5260; }
    .acts { display:flex; gap:8px; flex-wrap:wrap; }
    .stats { display:grid; grid-template-columns: repeat(3, 1fr); border-bottom:1px solid #eef0f3; }
    .st { padding: 10px 14px; }
    .st + .st { border-left: 1px solid #eef0f3; }
    .n { font-size: 20px; font-weight: 650; letter-spacing:-.02em; font-variant-numeric: tabular-nums; }
    .l { font-size: 11px; color:#6b7280; }
    .bar { height: 3px; background:#eef0f3; }
    .bar > i { display:block; height:100%; width:0; background:#16181d; transition: width .2s ease; }
    .sec { padding: 12px 14px; }
    .sec + .sec { border-top: 1px solid #eef0f3; }
    .h { font-size: 11px; font-weight: 600; color:#6b7280; text-transform: uppercase; letter-spacing:.05em; margin-bottom: 8px; display:flex; justify-content:space-between; }
    .h b { color:#16181d; font-weight:650; text-transform:none; letter-spacing:0; }
    .dist { display:grid; grid-template-columns: repeat(5,1fr); gap:6px; align-items:end; height: 54px; }
    .col { display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; gap:3px; }
    .col i { display:block; width:100%; border-radius:3px 3px 1px 1px; min-height:2px; transition: height .25s ease; }
    .col span { font-size: 10px; color:#6b7280; font-variant-numeric: tabular-nums; }
    .axis { display:flex; justify-content:space-between; font-size:10px; color:#9aa1ad; margin-top:4px; font-variant-numeric: tabular-nums; }
    .top { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .top a { display:flex; gap:8px; align-items:flex-start; color:inherit; text-decoration:none; }
    .top a:hover .tt { text-decoration: underline; }
    .top a:focus-visible { outline:2px solid #2f6fdb; outline-offset:2px; border-radius:4px; }
    .pill { flex:none; min-width:28px; text-align:center; color:#fff; font-size:10.5px; font-weight:650; border-radius:8px; padding:1px 5px; font-variant-numeric: tabular-nums; }
    .tt { font-size: 12px; line-height:1.35; color:#2a2f38; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .srcs { position:relative; height:${SRC_ROWS * SRC_H}px; }
    .sr { position:absolute; left:0; right:0; top:0; height:${SRC_H}px; display:grid; grid-template-columns: 92px 1fr 26px 30px; gap:8px; align-items:center; font-size:12px;
          transition: transform .45s cubic-bezier(.2,.8,.2,1), opacity .3s ease; }
    .sr .sn { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#2a2f38; }
    .sr .sb { height:8px; background:#f2f4f7; border-radius:4px; overflow:hidden; }
    .sr .sb i { display:block; height:100%; border-radius:4px; transition: width .45s ease, background-color .45s ease; }
    .sr b { text-align:right; font-variant-numeric: tabular-nums; }
    .sr small { color:#9aa1ad; font-size:10.5px; font-variant-numeric: tabular-nums; }
    .empty { font-size:11.5px; color:#9aa1ad; }
    .ask { position:relative; border:1px solid #d5d9e0; border-radius:12px; background:#fff; transition: border-color .15s, box-shadow .15s; }
    .ask:focus-within { border-color:#2f6fdb; box-shadow: 0 0 0 3px rgba(47,111,219,.15); }
    .ask textarea { display:block; width:100%; min-height:84px; max-height:200px; resize:vertical; border:0; outline:0; background:transparent;
                    font: inherit; font-size:13px; line-height:1.45; color:#16181d; padding:10px 12px 40px; border-radius:12px; }
    .ask textarea::placeholder { color:#8a919d; }
    .ask .send { all:unset; position:absolute; right:8px; bottom:8px; cursor:pointer; font-size:12px; font-weight:600;
                 padding:6px 12px; border-radius:8px; background:#16181d; color:#fff; }
    .ask .send:hover { background:#2a2f38; }
    .ask .send:focus-visible { outline:2px solid #2f6fdb; outline-offset:2px; }
    .ask .kbd { position:absolute; left:12px; bottom:12px; font-size:10.5px; color:#9aa1ad; }
    .hitsum { font-size:11.5px; color:#4b5260; margin:8px 0 0; display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .hitsum:empty { display:none; }
    .hitsum b { color:#16181d; font-variant-numeric: tabular-nums; }
    .lnk { all:unset; cursor:pointer; color:#2f6fdb; font-size:11.5px; }
    .lnk:hover { text-decoration:underline; }
    .lnk:focus-visible { outline:2px solid #2f6fdb; outline-offset:1px; }
    #hits:not(:empty) { margin-top:8px; }
    .pill.m { background:#2f6fdb; }
    .chips { display:flex; flex-wrap:wrap; gap:5px; }
    .chip { all:unset; cursor:pointer; font-size:11.5px; padding:3px 8px; border-radius:999px; border:1px solid #e3e6eb; color:#2a2f38; }
    .chip small { color:#9aa1ad; font-variant-numeric: tabular-nums; margin-left:3px; }
    .chip[aria-pressed="true"] { background:#16181d; border-color:#16181d; color:#fff; }
    .chip[aria-pressed="true"] small { color:#c5cad3; }
    .chip:focus-visible { outline:2px solid #2f6fdb; outline-offset:1px; }
    .tl { position:relative; background:#f7f8fa; border-radius:6px; overflow:hidden; }
    .tl i { position:absolute; height:5px; border-radius:3px; background:#16181d; }
    .tl i.run { background:#b9bfc9; }
    .tl i.bad { background:#c0392b; }
    .tlm { font-size:11px; color:#4b5260; margin-top:6px; line-height:1.45; }
    .calls { list-style:none; margin:0; padding:0; max-height:220px; overflow-y:auto; font-size:11.5px; font-variant-numeric: tabular-nums; }
    .calls li { display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center; padding:4px 0; border-bottom:1px solid #f2f4f7; color:#4b5260; }
    .calls li .m { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .calls li .c { text-align:right; line-height:1.25; }
    .calls li .c b { color:#16181d; font-weight:600; }
    .calls li .c small { display:block; color:#9aa1ad; font-size:10.5px; }
    .u { color:#9aa1ad; }
    .calls li.bad { color:#8a1c1c; }
    .tlm b { color:#16181d; font-variant-numeric: tabular-nums; }
    .seg { display:grid; grid-template-columns: repeat(3,1fr); background:#f2f4f7; border-radius:8px; padding:3px; gap:3px; }
    .seg button { all:unset; cursor:pointer; text-align:center; font-size:12px; padding:5px 0; border-radius:6px; color:#4b5260; }
    .seg button[aria-pressed="true"] { background:#fff; color:#16181d; font-weight:600; box-shadow: 0 1px 2px rgba(16,24,40,.08); }
    .thr { margin-top:10px; display:none; }
    .thr.on { display:block; }
    .row { display:flex; align-items:center; justify-content:space-between; font-size:12px; color:#4b5260; }
    input[type=range] { width:100%; margin: 6px 0 4px; accent-color:#16181d; }
    label.cb { display:flex; gap:6px; align-items:center; font-size:12px; color:#4b5260; cursor:pointer; }
    .btn { all:unset; cursor:pointer; font-size:12px; font-weight:550; padding:6px 10px; border-radius:7px; border:1px solid #e3e6eb; color:#16181d; }
    .btn:hover { background:#f7f8fa; }
    .btn:focus-visible, .seg button:focus-visible, .ib:focus-visible { outline: 2px solid #16181d; outline-offset: 1px; }
    .note { margin: 10px 14px 0; padding: 8px 10px; border-radius:8px; font-size:11.5px; line-height:1.4; background:#f7f8fa; color:#4b5260; display:none; }
    .note.on { display:block; }
    .note.err { background:#fdecec; color:#8a1c1c; }
    .body { flex: 1; min-height: 0; overflow-y: auto; }
    .tip { position:fixed; z-index:1; width:280px; pointer-events:none; background:#fff; color:#16181d; border:1px solid #e3e6eb; border-radius:10px; padding:10px 12px;
           box-shadow: 0 12px 32px -8px rgba(16,24,40,.25); font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    .tip[hidden] { display:none; }
    .tip .q { color:#4b5260; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:8px; }
    .tip .big { display:flex; gap:8px; align-items:center; font-size:13px; }
    .tip .bars { display:grid; grid-template-columns:repeat(5,1fr); gap:5px; align-items:end; height:50px; margin:8px 0 4px; }
    .tip .bars div { display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; gap:2px; }
    .tip .bars i { display:block; width:100%; border-radius:3px 3px 1px 1px; }
    .tip .bars span { font-size:10px; color:#6b7280; font-variant-numeric:tabular-nums; }
    .tip dl { display:grid; grid-template-columns:auto 1fr; gap:1px 10px; margin:6px 0 0; }
    .tip dt { color:#6b7280; } .tip dd { margin:0; font-weight:550; }
    .tip .err { color:#8a1c1c; }
    @media (prefers-reduced-motion: reduce) { .sr, .sr .sb i, .col i, .bar > i { transition:none; } }
  </style>
  <div class="p">
    <div class="hd">
      <div class="ttl">Zajszűrő</div>
      <button class="ib" id="opts" title="Beállítások" aria-label="Beállítások">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="ib" id="col" title="Panel elrejtése" aria-label="Panel elrejtése">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17l5-5-5-5M13 17l5-5-5-5"/></svg>
      </button>
    </div>
    <div class="status" id="status" role="status">Előkészítés…</div>
    <div class="bar"><i id="prog"></i></div>
    <div class="body" id="body">
      <div class="note" id="note" role="alert"></div>
      <div class="tabs" role="tablist" aria-label="Nézet">
        <button role="tab" id="t-pick" data-tab="pick" aria-controls="p-pick">Válogatás</button>
        <button role="tab" id="t-bait" data-tab="bait" aria-controls="p-bait">Kattintásvadászat</button>
        <button role="tab" id="t-speed" data-tab="speed" aria-controls="p-speed">Sebesség</button>
      </div>

      <div class="pane" id="p-pick" role="tabpanel" aria-labelledby="t-pick">
        <div class="sec">
          <div class="h"><span>Milyen hírek érdekelnek?</span></div>
          <form class="ask" id="srch">
            <textarea id="q" rows="3" maxlength="500" aria-label="Milyen hírek érdekelnek? Írd le a saját szavaiddal."></textarea>
            <span class="kbd" aria-hidden="true">Enter: mehet · Shift+Enter: új sor</span>
            <button class="send" type="submit">Válogass</button>
          </form>
          <div class="hitsum" id="hitsum"></div>
          <ul class="top" id="hits"></ul>
        </div>
        <div class="sec">
          <div class="h"><span>Témák</span><b id="topicN"></b></div>
          <div class="chips" id="chips"></div>
        </div>
      </div>

      <div class="pane" id="p-bait" role="tabpanel" aria-labelledby="t-bait">
        <div class="sec">
          <p class="lead">A címek előtti szám: <b>0</b> = tényszerű, <b>100</b> = erősen kattintásvadász. Vidd az egeret a számra a részletekért.</p>
          <div class="seg" role="group" aria-label="Megjelenítés">
            <button data-mode="badge">Szám</button>
            <button data-mode="heat">Színezés</button>
            <button data-mode="filter">Elhalványítás</button>
          </div>
          <div class="thr" id="thr">
            <div class="row"><span>Elhalványít, ha legalább</span><b id="thrV">60</b></div>
            <input type="range" id="thrR" min="0" max="100" step="5" value="60" aria-label="Küszöb">
            <label class="cb"><input type="checkbox" id="hide"> Teljes elrejtés</label>
          </div>
        </div>
        <div class="sec">
          <div class="h"><span>Eloszlás</span><b id="avg"></b></div>
          <div class="dist" id="dist"></div>
          <div class="axis"><span>tényszerű</span><span>kattintásvadász</span></div>
        </div>
        <div class="sec">
          <div class="h"><span>Leginkább kattintásvadász</span></div>
          <ul class="top" id="top"></ul>
        </div>
        <div class="sec" id="srcSec">
          <div class="h"><span>Források átlaga</span><b id="srcN"></b></div>
          <div class="srcs" id="srcs"></div>
        </div>
      </div>

      <div class="pane" id="p-speed" role="tabpanel" aria-labelledby="t-speed">
        <div class="stats">
          <div class="st"><div class="n" id="nTotal">–</div><div class="l">cím</div></div>
          <div class="st"><div class="n" id="nTime">–</div><div class="l" id="lTime">idő</div></div>
          <div class="st"><div class="n" id="rate">–</div><div class="l">cím/s</div></div>
        </div>
        <div class="sec">
          <div class="h"><span id="tlTitle">Jev-hívások</span></div>
          <div class="tl" id="tl"></div>
          <div class="axis"><span>0 s</span><span id="tlEnd"></span></div>
          <div class="tlm" id="tlm"></div>
        </div>
        <div class="sec">
          <div class="h"><span>Költség hívásonként</span><b id="costSum"></b></div>
          <ol class="calls" id="calls"></ol>
          <div class="tlm" id="cost"></div>
        </div>
        <div class="sec acts">
          <button class="btn" id="rerun">Újramérés gyorsítótár nélkül</button>
          <button class="btn" id="big" hidden>Nagy teszt: ~950 cím</button>
        </div>
      </div>
    </div>
  </div>
  <button class="open" id="open" hidden aria-label="Zajszűrő panel megnyitása">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 17l-5-5 5-5M11 17l-5-5 5-5"/></svg>Zajszűrő
  </button>
  <div class="tip" id="tip" hidden></div>`;

  const $ = (id) => root.getElementById(id);
  const fmtSec = (ms) => (ms / 1000).toFixed(1).replace(".", ",") + " s";
  const fmtNum = (x, d = 2) => x.toFixed(d).replace(".", ",");

  const distEl = $("dist");
  const COLS = [0, 25, 50, 75, 100];
  distEl.innerHTML = COLS.map((s) => `<div class="col"><span>0</span><i style="background:${badgeColor(s)};height:2px"></i></div>`).join("");

  // ------------------------------------------------------------ források (9)

  const srcRows = new Map();
  function renderSources(ok) {
    const agg = new Map();
    for (const it of state.items) {
      const r = state.results.get(it.id);
      if (!r || r.error || !it.src) continue;
      const a = agg.get(it.src) || { sum: 0, n: 0 };
      a.sum += r.score;
      a.n++;
      agg.set(it.src, a);
    }
    const ranked = [...agg.entries()]
      .filter(([, a]) => a.n >= 3)
      .map(([src, a]) => ({ src, avg: Math.round(a.sum / a.n), n: a.n }))
      .sort((x, y) => y.avg - x.avg || y.n - x.n);
    const top = ranked.slice(0, SRC_ROWS);
    $("srcN").textContent = ranked.length ? `${ranked.length} forrás` : "";
    const box = $("srcs");
    if (!top.length) {
      if (!box.querySelector(".empty")) box.innerHTML = `<div class="empty">${ok ? "Legalább 3 cím kell forrásonként…" : "Várakozás a pontszámokra…"}</div>`;
      srcRows.clear();
      return;
    }
    box.querySelector(".empty")?.remove();
    const shown = new Set(top.map((t) => t.src));
    top.forEach((t, i) => {
      let el = srcRows.get(t.src);
      if (!el) {
        el = document.createElement("div");
        el.className = "sr";
        el.innerHTML = `<span class="sn"></span><span class="sb"><i></i></span><b></b><small></small>`;
        el.querySelector(".sn").textContent = t.src;
        el.querySelector(".sn").title = t.src;
        el.style.transform = `translateY(${SRC_ROWS * SRC_H}px)`;
        el.style.opacity = "0";
        box.appendChild(el);
        srcRows.set(t.src, el);
        el.getBoundingClientRect(); // hogy az első pozíció is animálódjon
      }
      el.style.transform = `translateY(${i * SRC_H}px)`;
      el.style.opacity = "1";
      el.querySelector("i").style.width = `${Math.max(2, t.avg)}%`;
      el.querySelector("i").style.backgroundColor = badgeColor(t.avg);
      el.querySelector("b").textContent = String(t.avg);
      el.querySelector("small").textContent = `·${t.n}`;
    });
    for (const [src, el] of srcRows)
      if (!shown.has(src)) {
        el.style.transform = `translateY(${SRC_ROWS * SRC_H}px)`;
        el.style.opacity = "0";
      }
  }

  // ------------------------------------------------------------ idővonal (4)

  function renderTimeline() {
    const reqs = [...state.reqs.values()];
    const now = Date.now();
    const tl = $("tl");
    const lanes = Math.max(1, state.lanes);
    tl.style.height = `${lanes * 7 + 3}px`;
    if (!reqs.length) {
      tl.innerHTML = "";
      $("tlEnd").textContent = "";
      $("tlm").textContent = state.done && state.mainDone ? "Minden cím a gyorsítótárból jött, nem kellett hívás." : "";
      $("rate").textContent = "–";
      renderCosts([]);
      return;
    }
    const end = Math.max(...reqs.map((q) => q.e || now));
    const span = Math.max(1000, end - state.base);
    tl.innerHTML = reqs
      .map((q) => {
        const left = ((q.s - state.base) / span) * 100;
        const w = Math.max(0.6, (((q.e || now) - q.s) / span) * 100);
        const cls = !q.e ? "run" : q.ok ? "" : "bad";
        const cost = q.tokens != null ? ` · ${fmtTok(q.tokens)} token · ${fmtCost(q.tokens)}` : "";
        return `<i class="${cls}" style="left:${left}%;width:max(1px, calc(${w}% - 2px));top:${2 + (q.slot % lanes) * 7}px" title="${q.n} cím · ${q.e ? q.e - q.s + " ms" : "folyamatban"}${cost}"></i>`;
      })
      .join("");
    $("tlEnd").textContent = fmtSec(span);
    const doneReqs = reqs.filter((q) => q.e && q.ok);
    const lat = doneReqs.map((q) => q.e - q.s).sort((a, b) => a - b);
    const med = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
    const qpc = state.qpc;
    $("tlm").innerHTML =
      `<b>${reqs.length}</b> hívás · <b>${state.lanes}</b> párhuzamos · medián <b>${med} ms</b><br>` +
      `<b>${state.batchSize}</b> cím és <b>${state.batchSize * qpc}</b> kérdés hívásonként (${qpc} kérdés/cím)`;
    const scored = doneReqs.reduce((a, q) => a + q.n, 0);
    const secs = (end - state.base) / 1000;
    $("rate").textContent = scored && secs > 0 ? String(Math.round(scored / secs)) : "–";
    renderCosts(reqs);
  }

  // ------------------------------------------------------------ költség

  const fmtTok = (t) => t.toLocaleString("hu-HU");
  const usdOf = (t) => (t * state.usdPerMtok) / 1e6;
  const fmtFt = (t) => {
    const ft = usdOf(t) * state.usdHuf;
    return `${ft >= 1 ? ft.toLocaleString("hu-HU", { maximumFractionDigits: 1 }) : ft.toLocaleString("hu-HU", { maximumSignificantDigits: 2 })} Ft`;
  };
  const fmtUsd = (t) => `${usdOf(t).toLocaleString("hu-HU", { maximumSignificantDigits: 3 })} USD`;
  const fmtCost = (t) => `${fmtFt(t)} (${fmtUsd(t)})`;

  // hívásonkénti lista (legújabb felül) és összesítés a Sebesség fülön
  function renderCosts(reqs) {
    setHtml(
      "calls",
      reqs
        .map((q, i) => {
          const meta = `<span class="u">#${i + 1}</span> · ${q.n} cím · ${q.e ? q.e - q.s + " ms" : "…"}${q.tokens != null ? ` · ${fmtTok(q.tokens)} token` : ""}`;
          const cost = !q.e
            ? `<span class="u">folyamatban</span>`
            : !q.ok
              ? "hiba"
              : q.tokens == null
                ? `<span class="u">nincs adat</span>`
                : `<b>${fmtFt(q.tokens)}</b><small>${fmtUsd(q.tokens)}</small>`;
          return `<li class="${q.e && !q.ok ? "bad" : ""}"><span class="m">${meta}</span><span class="c">${cost}</span></li>`;
        })
        .reverse()
        .join("")
    );
    const tok = reqs.reduce((a, q) => a + (q.tokens || 0), 0);
    $("costSum").textContent = reqs.length ? fmtFt(tok) : "";
    $("cost").innerHTML = reqs.length
      ? `Ez a futás (${esc(state.job || "")}): <b>${fmtTok(tok)} token · ${fmtCost(tok)}</b><br>` +
        `Ezen az oldalon összesen: <b>${fmtCost(state.pageTokens)}</b><br>` +
        `<span class="u">Ár: ${state.usdPerMtok.toLocaleString("hu-HU")} USD / millió bemeneti token (TypeSafe Jev), 1 USD = ${state.usdHuf.toLocaleString("hu-HU")} Ft</span>`
      : "";
  }

  // ------------------------------------------------------------ buborék a jelvényen (12)

  const tip = $("tip");
  function tipHtml(it, r) {
    if (r.error) return `<div class="q">${esc(it.title)}</div><div class="err">Hiba: ${esc(r.error)}</div>`;
    const L = state.labels;
    const probs = [0, 1, 2, 3, 4].map((i) => (r.probs && r.probs[String(i)]) || 0);
    const rows = [
      r.emotion != null && ["Érzelmi töltet", `${r.emotion}/100`],
      r.tone && ["Hangvétel", L.tones[r.tone] || r.tone],
      r.topic && ["Téma", L.topics[r.topic] || r.topic],
      r.confidence != null && ["Biztosság", fmtNum(r.confidence)],
      it.src && ["Forrás", it.src],
      r.cached && ["", "gyorsítótárból"],
    ].filter(Boolean);
    return (
      `<div class="q">${esc(it.title)}</div>` +
      `<div class="big"><span class="pill" style="background:${badgeColor(r.score)}">${r.score}</span><b>${esc(L.levels[r.level] || "")}</b></div>` +
      (r.probs ? `<div class="bars">${probs.map((v, i) => `<div><i style="height:${Math.max(2, v * 34)}px;background:${badgeColor(i * 25)}"></i><span>${Math.round(v * 100)}%</span></div>`).join("")}</div>` : "") +
      `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
    );
  }
  document.addEventListener("mouseover", (e) => {
    const b = e.target.closest && e.target.closest(".kvm-badge");
    const it = b && badgeItem.get(b);
    const r = it && state.results.get(it.id);
    if (!r) return;
    tip.innerHTML = tipHtml(it, r);
    tip.hidden = false;
    const rect = b.getBoundingClientRect();
    const th = tip.offsetHeight;
    tip.style.left = `${Math.min(window.innerWidth - 292, Math.max(8, rect.left))}px`;
    tip.style.top = `${rect.bottom + 8 + th > window.innerHeight ? rect.top - th - 8 : rect.bottom + 8}px`;
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(".kvm-badge")) tip.hidden = true;
  });

  // ------------------------------------------------------------ kereső és témák

  // A listák csak változáskor épülnek újra, hogy futás közben is el lehessen kapni a kattintást.
  const lastHtml = {};
  function setHtml(id, html) {
    if (lastHtml[id] === html) return;
    lastHtml[id] = html;
    $(id).innerHTML = html;
  }

  function renderInterest() {
    const I = state.interest;
    if (!I) {
      setHtml("hitsum", "");
      setHtml("hits", "");
      return;
    }
    const hits = [...I.hits.entries()].filter(([, m]) => m >= MATCH).sort((a, b) => b[1] - a[1]);
    const clear = `<button class="lnk" type="button" id="qClear">Törlés</button>`;
    setHtml(
      "hitsum",
      I.done
        ? `<span><b>${hits.length}</b> találat · ${I.hits.size} címből · <b>${fmtSec(I.ms)}</b> · ${fmtCost(I.tokens)}</span>${clear}`
        : `<span>Jev válogat… <b>${I.hits.size}</b>/${state.items.length} · ${hits.length} találat</span>${clear}`
    );
    setHtml(
      "hits",
      hits
        .slice(0, 6)
        .map(([id, m]) => {
          const it = state.byId.get(id);
          return it ? `<li>${itemLink(it, `<span class="pill m">${Math.round(m * 100)}%</span>`)}</li>` : "";
        })
        .join("")
    );
  }

  function renderTopics() {
    const counts = new Map();
    for (const r of state.results.values()) if (r.topic) counts.set(r.topic, (counts.get(r.topic) || 0) + 1);
    const sel = state.ui.topics;
    $("topicN").textContent = sel.length ? `${sel.length} kiválasztva` : "";
    const keys = [...new Set([...counts.keys(), ...sel])].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    setHtml(
      "chips",
      keys.length
        ? keys.map((k) => `<button class="chip" type="button" data-topic="${esc(k)}" aria-pressed="${sel.includes(k)}">${esc(state.labels.topics[k] || k)}<small>${counts.get(k) || 0}</small></button>`).join("")
        : `<div class="empty">Várakozás a pontszámokra…</div>`
    );
  }

  // A panel listáiban a cím valódi link a cikkre (Ctrl/középső gomb: új lap). Sima kattintásra oda
  // navigál, ahová az oldal linkje mutat, és ugyanott nyílik meg (új lapon, ha az oldal linkje is úgy nyitná).
  const itemLink = (it, pill) => `<a href="${esc(it.anchors[0].href)}" data-id="${esc(it.id)}">${pill}<span class="tt">${esc(it.title)}</span></a>`;

  // halvány, véletlen példa a szövegdobozban
  const EXAMPLES = [
    "kisvállalkozásokat érintő hírek",
    "ami a lakásárakat vagy a hiteleket befolyásolja",
    "jó hírek, amik feldobják a napomat",
    "mesterséges intelligencia a hétköznapokban",
    "ami a nyugdíjasokat érinti",
    "új szabályok az autósoknak",
    "iskola, oktatás, gyerekek",
    "egészséges életmód, sport, mozgás",
    "helyi hírek Budapestről",
    "megújuló energia és klímavédelem",
    "ami a benzin- és az energiaárakra hat",
    "tudományos felfedezések",
  ];
  const newPlaceholder = () => ($("q").placeholder = `pl. ${EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]}`);
  newPlaceholder();

  // ------------------------------------------------------------ panel frissítése

  let rafPending = false;
  function renderPanel() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const total = state.items.length;
      const scored = [...state.results.values()];
      const ok = scored.filter((r) => !r.error);
      $("nTotal").textContent = String(total);
      $("prog").style.width = total ? `${(scored.length / total) * 100}%` : "0";
      if (state.t0) {
        const elapsed = (state.mainDone ? state.t1 : performance.now()) - state.t0;
        const allCached = state.mainDone && state.cachedCount === total && total > 0;
        $("nTime").textContent = allCached ? "0,0 s" : fmtSec(elapsed);
        $("lTime").textContent = allCached ? "gyorsítótárból" : state.mainDone ? "teljes idő" : "eltelt";
        $("status").innerHTML = !state.mainDone
          ? `Jev pontoz… <b>${scored.length}</b>/${total} cím`
          : allCached
            ? `<b>${total}</b> cím · gyorsítótárból · 0 Ft`
            : `<b>${total}</b> cím pontozva · <b>${fmtSec(elapsed)}</b> alatt · ${fmtCost(state.mainTokens)}`;
      }
      for (const b of root.querySelectorAll(".tabs button")) {
        const on = b.dataset.tab === state.ui.tab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        $(`p-${b.dataset.tab}`).hidden = !on;
      }
      scanLine.classList.toggle("on", !state.done);

      const counts = [0, 0, 0, 0, 0];
      for (const r of ok) counts[Math.max(0, Math.min(4, Math.round(r.score / 25)))]++;
      const max = Math.max(1, ...counts);
      distEl.querySelectorAll(".col").forEach((c, i) => {
        c.querySelector("span").textContent = String(counts[i]);
        c.querySelector("i").style.height = `${Math.max(2, (counts[i] / max) * 38)}px`;
      });
      $("avg").textContent = ok.length ? `átlag ${Math.round(ok.reduce((a, r) => a + r.score, 0) / ok.length)}/100` : "";

      renderTimeline();
      renderSources(ok.length);
      renderInterest();
      renderTopics();
      $("tlTitle").textContent = state.job ? `Jev-hívások · ${state.job}` : "Jev-hívások";

      const top = state.items
        .filter((it) => state.results.get(it.id) && !state.results.get(it.id).error)
        .sort((a, b) => state.results.get(b.id).score - state.results.get(a.id).score)
        .slice(0, 10);
      setHtml(
        "top",
        top
          .map((it) => {
            const s = state.results.get(it.id).score;
            return `<li>${itemLink(it, `<span class="pill" style="background:${badgeColor(s)}">${s}</span>`)}</li>`;
          })
          .join("")
      );

      const note = $("note");
      const msg = state.lastError ? `Hiba: ${state.lastError}` : state.notice;
      note.textContent = msg || "";
      note.classList.toggle("on", !!msg);
      note.classList.toggle("err", !!state.lastError);

      root.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.ui.mode)));
      $("thr").classList.toggle("on", state.ui.mode === "filter");
      $("thrV").textContent = String(state.ui.threshold);
      $("thrR").value = String(state.ui.threshold);
      $("hide").checked = state.ui.hide;
      $("big").hidden = !BIG_PAGE;
      applyDock();

      if (!state.done) renderPanel();
    });
  }

  function saveUi() {
    try {
      chrome.storage.local.set({ ui: state.ui });
    } catch {}
  }

  // Egyes oldalak (pl. a telex) a window-on, capture fázisban megállítják a kattintásokat, így azok
  // el sem jutnának a panel gombjaihoz. Ezért a panel kattintásait és billentyűit egyetlen, window-ra tett
  // capture-figyelő osztja szét: ez akkor is lefut, ha az oldal a sajátjában megállítja az eseményt.
  // Az elemeken ezért nincs saját click-figyelő (különben kétszer futna le).
  const clickRoutes = [];
  const onClick = (sel, fn) => clickRoutes.push([sel, fn]);
  window.addEventListener(
    "click",
    (e) => {
      const path = e.composedPath();
      if (!path.includes(host)) return;
      for (const el of path) {
        if (el === host) return;
        if (!(el instanceof Element)) continue;
        const route = clickRoutes.find(([sel]) => el.matches(sel));
        if (route) return route[1](el, e);
      }
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      const el = e.composedPath()[0];
      if (!e.composedPath().includes(host)) return;
      // mint egy chatablakban: Enter elküldi, Shift+Enter új sor
      if (el === $("q") && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $("srch").requestSubmit();
      }
      // nyilakkal is lehessen fület váltani
      if (el.matches && el.matches(".tabs button") && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const tabs = [...root.querySelectorAll(".tabs button")];
        const i = tabs.findIndex((b) => b.dataset.tab === state.ui.tab);
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        setTab(next.dataset.tab);
        next.focus();
      }
    },
    true
  );

  onClick(".seg button", (b) => {
    state.ui.mode = b.dataset.mode;
    applyMode();
    saveUi();
    renderPanel();
  });
  $("thrR").addEventListener("input", (e) => {
    state.ui.threshold = Number(e.target.value);
    applyThreshold();
    saveUi();
    renderPanel();
  });
  $("hide").addEventListener("change", (e) => {
    state.ui.hide = e.target.checked;
    applyMode();
    saveUi();
  });
  function setTab(tab) {
    state.ui.tab = tab;
    if (tab !== "speed") state.ui.view = tab;
    applyMode();
    saveUi();
    renderPanel();
  }
  onClick(".tabs button", (b) => setTab(b.dataset.tab));
  // összecsukva csak egy kis fül marad, és az oldal visszakapja a teljes szélességet
  function applyDock() {
    const c = state.ui.collapsed;
    root.querySelector(".p").hidden = c;
    $("open").hidden = !c;
    // a fül a jobb szél közepe felé kerül, hogy ne takarja az oldal fejlécét
    host.style.top = c ? "40%" : "0";
    host.style.bottom = c ? "auto" : "0";
    document.documentElement.classList.toggle("kvm-docked", !c);
  }
  const toggleDock = () => {
    state.ui.collapsed = !state.ui.collapsed;
    saveUi();
    applyDock();
    (state.ui.collapsed ? $("open") : $("col")).focus();
    renderPanel();
  };
  onClick("#col, #open", toggleDock);
  onClick("#opts", () => chrome.runtime.sendMessage({ type: "open-options" }).catch(() => {}));
  onClick("#rerun", () => start(true));
  onClick("#big", () => {
    if (BIG_PAGE) location.href = BIG_PAGE;
  });

  // a gépelés ne jusson el az oldal buborékoló gyorsbillentyű-figyelőihez
  for (const t of ["keydown", "keyup", "keypress"]) $("q").addEventListener(t, (e) => e.stopPropagation());
  $("srch").addEventListener("submit", (e) => {
    e.preventDefault();
    const query = $("q").value.trim();
    if (!query) return;
    cancelInterest();
    state.interest = { query, hits: new Map(), t0: performance.now(), ms: 0, done: false, tokens: 0 };
    state.interest.run = send(visibleFirst(), false, "interest", query);
    if (!state.interest.run) state.interest = null;
    applyFilters();
    renderPanel();
  });
  onClick("#qClear", () => {
    cancelInterest();
    state.interest = null;
    $("q").value = "";
    newPlaceholder();
    applyFilters();
    renderPanel();
  });
  onClick("#hits a[data-id], #top a[data-id]", (a, e) => {
    const it = state.byId.get(a.dataset.id);
    if (!it || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // Egy saját, az oldalhoz nem kötött linkkel nyitja meg: az oldal szkriptjei így nem nyelhetik el
    // (a hirstart elnyeli a programból indított kattintást, a hirkereso korlátozza a window.open-t).
    const link = it.anchors[0];
    const go = document.createElement("a");
    go.href = link.href;
    go.target = link.target || "_self";
    go.rel = "noopener";
    go.click();
  });
  onClick("#chips .chip", (chip) => {
    const k = chip.dataset.topic;
    const sel = state.ui.topics;
    state.ui.topics = sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k];
    saveUi();
    applyFilters();
    renderPanel();
  });

  function cancelInterest() {
    const run = state.interest && state.interest.run;
    if (!run || !state.runs.has(run)) return;
    try {
      port.postMessage({ type: "cancel", run });
    } catch {}
    state.runs.delete(run);
    state.done = state.runs.size === 0;
  }

  // ------------------------------------------------------------ futtatás

  let port = null;
  let runSeq = 0;

  function onMessage(msg) {
    const run = state.runs.get(msg.run);
    if (!run) return;
    if (msg.type === "start") {
      state.labels = msg.labels || state.labels;
      state.lanes = msg.concurrency;
      state.batchSize = msg.batchSize;
      if (msg.usdPerMtok) state.usdPerMtok = msg.usdPerMtok;
      if (msg.usdHuf) state.usdHuf = msg.usdHuf;
      // a kereső saját idővonalat kap, hogy a saját ideje látszódjon
      if (run.kind === "interest") {
        state.reqs.clear();
        state.base = msg.at;
        state.job = "keresés";
        state.qpc = msg.qpc;
      } else if (run.kind === "main") {
        state.base = state.base || msg.at;
        state.job = "pontozás";
        state.qpc = msg.qpc;
      }
    } else if (msg.type === "req") {
      state.reqs.set(msg.req.id, msg.req);
      const t = msg.req.e && msg.req.tokens;
      if (t) {
        state.pageTokens += t;
        if (run.kind === "main") state.mainTokens += t;
        if (run.kind === "interest" && state.interest && state.interest.run === msg.run) state.interest.tokens += t;
      }
    } else if (msg.type === "results" && run.kind === "interest") {
      for (const r of msg.results) {
        const it = state.byId.get(r.id);
        if (!it) continue;
        if (r.error) state.lastError = r.error;
        else state.interest.hits.set(r.id, r.match);
        filterRow(it);
      }
    } else if (msg.type === "results") {
      for (const r of msg.results) {
        const it = state.byId.get(r.id);
        if (!it) continue;
        state.results.set(r.id, r);
        if (r.cached) state.cachedCount++;
        if (r.error) state.lastError = r.error;
        paint(it, r, !r.cached);
      }
    } else if (msg.type === "done" || msg.type === "fatal") {
      state.runs.delete(msg.run);
      if (msg.type === "fatal") state.lastError = msg.message;
      else if (msg.lastError) state.lastError = msg.lastError;
      if (run.kind === "interest") {
        state.interest.done = true;
        state.interest.ms = performance.now() - state.interest.t0;
      } else if (run.kind === "main") {
        state.mainDone = true;
        state.t1 = performance.now();
      } else if (msg.type === "done") {
        // új címek menet közben (8)
        const ms = Math.round(performance.now() - run.t);
        state.notice = `+${run.n} új cím az oldalon · ${msg.scored ? `${ms} ms alatt pontozva` : "gyorsítótárból"}`;
      }
      state.done = state.runs.size === 0;
    }
    renderPanel();
  }

  // A Chrome kb. 30 s tétlenség után leállítja a háttérszkriptet, ilyenkor a port megszakad.
  // Minden küldés ezen megy át, és szükség esetén új portot nyit.
  const LOST = "Megszakadt a kapcsolat a háttérszkripttel. Próbáld újra.";
  function connect() {
    port = chrome.runtime.connect({ name: "kv-score" });
    if (state.lastError === LOST) state.lastError = null;
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      if (!state.runs.size) return;
      // futás közben szakadt meg: a folyamatban lévő kérések elvesztek
      state.runs.clear();
      state.done = true;
      if (state.interest && !state.interest.done) state.interest = null;
      state.lastError = LOST;
      renderPanel();
    });
  }

  // kind: "main" (az oldal pontozása), "more" (később érkezett címek), "interest" (kereső)
  // Visszaadja a futás azonosítóját, vagy null-t, ha nem sikerült elküldeni.
  function send(items, force, kind, query) {
    try {
      if (!port) connect();
    } catch {
      // a bővítményt frissítették, de az oldal a régi tartalomszkriptet futtatja
      state.lastError = "A bővítmény frissült. Töltsd újra az oldalt.";
      renderPanel();
      return null;
    }
    const run = ++runSeq;
    state.runs.set(run, { kind, query, n: items.length, t: performance.now() });
    state.done = false;
    const slim = items.map(({ id, title, hint }) => ({ id, title, hint }));
    port.postMessage(kind === "interest" ? { type: "interest", run, query, items: slim } : { type: "score", run, force, items: slim });
    return run;
  }

  // a látható címek mennek előre, hogy azonnal legyen mit nézni
  function visibleFirst() {
    const vh = window.innerHeight;
    return [...state.items].sort((a, b) => {
      const ya = a.anchors[0].getBoundingClientRect().top;
      const yb = b.anchors[0].getBoundingClientRect().top;
      const va = ya > -50 && ya < vh * 1.2 ? 0 : 1;
      const vb = yb > -50 && yb < vh * 1.2 ? 0 : 1;
      return va - vb || ya - yb;
    });
  }

  function start(force) {
    if (port) {
      try {
        port.disconnect();
      } catch {}
      port = null;
    }
    state.results.clear();
    state.runs.clear();
    state.reqs.clear();
    state.base = 0;
    state.mainDone = false;
    state.mainTokens = 0;
    state.lastError = null;
    state.notice = null;
    state.cachedCount = 0;
    // a megszakadt keresés eredménye hiányos lenne; a befejezett megmarad
    if (state.interest && !state.interest.done) state.interest = null;
    for (const it of state.items)
      for (const { b, li } of it.badges) {
        b.className = "kvm-badge kvm-pending";
        b.textContent = "00";
        b.style.backgroundColor = "";
        b.style.animationDelay = "";
        if (li) li.classList.remove("kvm-over");
      }
    applyFilters();

    state.t0 = performance.now();
    send(visibleFirst(), force, "main");
    renderPanel();
  }

  // Az oldal később betöltött címei is pontszámot kapnak (8). A saját jelvényeink beszúrása nem számít.
  let scanTimer = 0;
  const foreign = (m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !n.classList.contains("kvm-badge") && n !== host && n !== scanLine);
  const observer = new MutationObserver((muts) => {
    if (!muts.some(foreign)) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const fresh = scan();
      if (fresh.length) send(fresh, false, "more");
      renderPanel();
    }, 300);
  });

  function mount() {
    applyMode();
    document.documentElement.appendChild(scanLine);
    document.documentElement.appendChild(host);
    applyDock();
    // egy oldalon belül minden cím ugyanonnan jön, ott a forrásrangsor értelmetlen
    $("srcSec").hidden = GENERIC;
  }

  // ikonkattintás a már futó példányon: ha nincs kint a panel, kiteszi, különben nyitja/csukja
  window.__kvmToggle = () => {
    if (!host.isConnected) return init(true);
    toggleDock();
  };

  async function init(byIcon = GENERIC) {
    scan();
    try {
      const { ui } = await chrome.storage.local.get("ui");
      if (ui) Object.assign(state.ui, ui);
    } catch {}
    // ikonra kattintva mindig nyitva jelenjen meg
    if (byIcon) state.ui.collapsed = false;
    if (!state.items.length) {
      // a két hírportál aloldalain (pl. cikk) csendben marad; ikonra kattintva szól
      if (!byIcon) return;
      mount();
      state.lastError = null;
      state.notice = "Ezen az oldalon nem találtam hírcímeket. A Zajszűrő hírportálok címlapjain és rovatoldalain működik a legjobban.";
      $("status").textContent = "0 cím";
      renderPanel();
      return;
    }
    mount();
    observer.observe(document.body, { childList: true, subtree: true });
    start(false);
  }

  init();
})();
