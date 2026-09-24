// Pontozó: TypeSafe (Jev).
// Visszaad: { results: [{ id, score (0–100), level (0–4), confidence, probs, [emotion, tone, topic] }] (hibánál { id, error }),
//             tokens: a hívás bemeneti tokenjei (ebből számolható a költség) }
//
// Költség: a Jev a bemeneti tokenekért számláz; a `state` egyszer számít, minden kérdés külön.
// A kattintásvadász-kérdés szándékosan a teljes, v1-es formájában marad (definíció a kérdésben, hosszú szintleírások):
// a tömörített változat a test/compare.mjs mérésén 73–80%-ban egyezett a régivel, a zajszint 97% volt.
// A témát, a hangvételt, az érzelmet és a válogatást tömörítettük: ott az egyezés 90–100%.
// A kérdések szövege szándékosan angol (a TypeSafe nem ír magyar támogatásról).

export const PROMPT_VERSION = "v2";

// a válogatás feladatleírása hivatkozik rá
const URL_HINT_NOTE = "`url_hint` (only present when a title was cut off with '...') is the article's URL slug; use it only to complete the title.";

// 5 fokú skála – a TypeSafe Score kérdés szintjei (a v1-es, mért változat; ne rövidítsd mérés nélkül)
export const LEVELS = [
  "Informative: the headline states the concrete news fact plainly (who / what happened). No hook.",
  "Mostly informative: the fact is clear, with some emotional or attention-grabbing wording.",
  "Mixed: the topic is clear, but a key detail is deliberately held back or exaggerated.",
  "Clickbait: relies on a curiosity gap or sensational framing; the reader must click to learn what actually happened.",
  "Extreme clickbait: a vague teaser with little or no factual content (shock, 'you won't believe', 'this is why', 'here is what happened').",
];

const INSTRUCTION = (ref) =>
  `How clickbait is the Hungarian news headline ${ref}? ` +
  "Judge only the wording of `title`. `url_hint` is the article's URL slug; use it only to complete a title that was cut off with '...'. " +
  "Clickbait means: withholding the key information to create a curiosity gap, sensational or emotional exaggeration, " +
  "vague forward references (e.g. 'kiderült', 'mutatjuk', 'eláruljuk', 'ezt', 'így', 'ez az oka'), or addressing the reader directly to provoke a click. " +
  "A headline that plainly reports a fact is not clickbait, even if the topic is dramatic.";

export const LEVEL_LABELS_HU = [
  "Tényszerű",
  "Többnyire tényszerű",
  "Vegyes",
  "Kattintásvadász",
  "Erősen kattintásvadász",
];

// Extra szempontok: ugyanabban a hívásban, címenként +3 kérdés. Párhuzamosan futnak, alig lassítanak.
export const TONES = { negative: "Negatív", neutral: "Semleges", positive: "Pozitív" };
export const TOPICS = {
  politics: "Politika",
  economy: "Gazdaság",
  crime: "Bűnügy, baleset",
  sport: "Sport",
  celebrity: "Bulvár, celeb",
  lifestyle: "Életmód, egészség",
  science: "Tech, tudomány",
  other: "Egyéb",
};

const QUESTIONS = (ref, extras) => ({
  h: { type: "score", instructions: INSTRUCTION(ref), criteria: LEVELS },
  ...(extras && {
    e: {
      type: "score",
      instructions: `How emotionally charged is the wording (not the topic) of ${ref}?`,
      criteria: ["Neutral", "Mild", "Strong", "Shock, outrage or fear"],
    },
    t: {
      type: "choice",
      instructions: `Is ${ref} good, bad or neutral news?`,
      criteria: { negative: "Bad news", neutral: "Neither", positive: "Good news" },
    },
    c: {
      type: "choice",
      instructions: `Main topic of ${ref}?`,
      // a magától értetődő kategóriák leírás nélkül (null), csak a határesetek kapnak pár szót
      criteria: { politics: null, economy: null, crime: "incl. accidents", sport: null, celebrity: "incl. TV, gossip", lifestyle: "health, food, travel", science: "tech, science, cars", other: null },
    },
  }),
});

// Jev ára a docs.typesafe.ai/models szerint (2026-09, jev-1.13): 0,042 USD millió bemeneti tokenenként,
// a kimenet ingyenes. Ha a TypeSafe árat változtat, ezt kell átírni.
export const USD_PER_MTOK = 0.042;

// a hívás által elhasznált bemeneti tokenek (a válasz usage mezőjéből), vagy null
const inputTokens = (data) => (data && data.usage && typeof data.usage.input_tokens === "number" ? data.usage.input_tokens : null);

const toScore100 = (s) => Math.round(Math.max(0, Math.min(4, s)) * 25);

// A cikk URL-jéből vett részlet csak a levágott („…”) címeknél kell, máshol csak a tokent viszi.
export const isCut = (title) => /(\.\.\.|…)\s*$/.test(title);
const headline = (it) => (it.hint && isCut(it.title) ? { title: it.title, url_hint: it.hint } : { title: it.title });

// ---------------------------------------------------------------- TypeSafe

// Egy hívás a Jev-hez. Visszaadja a nyers választ ({ answers, usage, … }).
export async function askJev(state, questions, cfg, signal) {
  const res = await fetchWithRetry(
    "https://api.typesafe.ai/v1/systemone",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ state, model: cfg.model || "jev-latest", questions }),
      signal,
    },
    [429, 529, 500, 502, 503]
  );
  return res.json();
}

export async function scoreWithTypeSafe(items, cfg, signal) {
  const state = { headlines: items.map(headline) };
  const questions = {};
  items.forEach((it, i) => {
    for (const [k, q] of Object.entries(QUESTIONS(`\`headlines[${i}]\``, cfg.extras))) questions[`${k}${i}`] = q;
  });
  const data = await askJev(state, questions, cfg, signal);
  return { results: parseTypeSafe(items, data), tokens: inputTokens(data) };
}

export function parseTypeSafe(items, data) {
  const answers = data && data.answers ? data.answers : {};
  return items.map((it, i) => {
    const a = answers[`h${i}`];
    if (!a || typeof a.score !== "number") return { id: it.id, error: "hiányzó válasz" };
    const r = {
      id: it.id,
      score: toScore100(a.score),
      level: Math.round(a.score),
      confidence: typeof a.confidence === "number" ? a.confidence : null,
      probs: a.probabilities || null,
    };
    const e = answers[`e${i}`], t = answers[`t${i}`], c = answers[`c${i}`];
    if (e && typeof e.score === "number") r.emotion = Math.round((Math.max(0, Math.min(3, e.score)) / 3) * 100);
    if (t && t.choice) r.tone = t.choice;
    if (c && c.choice) r.topic = c.choice;
    return r;
  });
}

// ---------------------------------------------------------------- érdeklődés szerinti kereső

// Címenként egy igen/nem kérdés: érdekelné-e az olvasót, akit a szabad szavas `interest` érdekel.
// Az érdeklődés és a feladat leírása egyszer megy a state-ben, a címenkénti kérdés csak hivatkozik rájuk.
// Visszaad: { results: [{ id, match (0–1) }] (hibánál { id, error }), tokens }.
export async function matchInterest(items, interest, cfg, signal) {
  const state = {
    reader_interest: interest,
    task:
      "A reader described their interest in `reader_interest` (possibly in Hungarian). For each Hungarian news headline, decide whether " +
      "the article is clearly about that interest or closely related to it. " + URL_HINT_NOTE,
    headlines: items.map(headline),
  };
  const questions = {};
  items.forEach((it, i) => {
    questions[`m${i}`] = { type: "noul", instructions: `Per \`task\`: does \`headlines[${i}]\` match \`reader_interest\`?` };
  });
  const data = await askJev(state, questions, cfg, signal);
  return { results: parseInterest(items, data), tokens: inputTokens(data) };
}

export function parseInterest(items, data) {
  const answers = (data && data.answers) || {};
  return items.map((it, i) => {
    const a = answers[`m${i}`];
    return a && typeof a.noul === "number" ? { id: it.id, match: a.noul } : { id: it.id, error: "hiányzó válasz" };
  });
}

// ---------------------------------------------------------------- közös

async function fetchWithRetry(url, init, retryOn, attempts = 4) {
  let delay = 600;
  for (let a = 1; ; a++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (init.signal && init.signal.aborted) throw e;
      if (a >= attempts) throw new Error(`Hálózati hiba: ${e.message}`);
      await sleep(delay);
      delay *= 2;
      continue;
    }
    if (res.ok) return res;
    if (retryOn.includes(res.status) && a < attempts) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(ra > 0 ? ra * 1000 : delay + Math.random() * 300);
      delay *= 2;
      continue;
    }
    let detail = "";
    try {
      const txt = await res.text();
      try {
        const j = JSON.parse(txt);
        detail = (j.detail && (j.detail.message || (typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail)))) || j.error || j.message || txt;
      } catch {
        detail = txt;
      }
      detail = String(detail).slice(0, 240);
    } catch {}
    const hint =
      res.status === 401 ? " – érvénytelen vagy hiányzó API-kulcs" :
      res.status === 403 ? " – hozzáférés megtagadva" :
      res.status === 422 ? " – hibás kérés" :
      res.status === 429 ? " – túl sok kérés, csökkentsd a párhuzamosságot" : "";
    const err = new Error(`HTTP ${res.status}${hint}${detail ? ` (${detail})` : ""}`);
    err.status = res.status;
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
