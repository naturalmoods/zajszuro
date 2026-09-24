// A régi (v1) és az új (v2, tömörített) Jev-kérdések összevetése valódi hívásokkal, 30 rögzített címen:
// valódi tokenszám és költség, és mennyire egyeznek az eredmények.
//   TYPESAFE_API_KEY=ts_... node test/compare.mjs
import { askJev, parseTypeSafe, parseInterest, scoreWithTypeSafe, matchInterest, USD_PER_MTOK, PROMPT_VERSION } from "../src/scorers.js";

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("Add meg: TYPESAFE_API_KEY=ts_... node test/compare.mjs");
const cfg = { apiKey, model: process.env.TYPESAFE_MODEL || "jev-latest", extras: true };
const USD_HUF = 320;
const QUERY = "kisvállalkozásokat érintő hírek";

// valódi címek (telex, index, 24.hu, blikk, origo, hvg, 444; az utolsó három levágott hirkereso-cím URL-részlettel)
const HEADLINES = [
  {"title": "Ezentúl tilos fotózni a British Museum legnagyobb attrakcióját", "hint": ""},
  {"title": "A Médiatanács új elnöke szerint nem fognak olyanokat utólag büntetni, akik régen propagandát közvetítettek", "hint": ""},
  {"title": "Már 300 évvel ezelőtt megdönthettük volna a tévhiteket a mohácsi...", "hint": ""},
  {"title": "Nyerj élményvezetést vagy benzinkártyát!", "hint": ""},
  {"title": "Javier Milei az ENSZ-ben is bejelentette Argentína igényét a Falkland-szigetekre", "hint": ""},
  {"title": "Megszülte a kislányát, felöltözött, és lelépett a kórházból", "hint": ""},
  {"title": "Megvan az új kormány első nagyköveti kinevezése, nem ismeretlen ember kapta a posztot", "hint": ""},
  {"title": "Ez okozta a 36 éves Hayden Panettiere halálát: megrázó, miért halt meg ilyen fiatalon", "hint": ""},
  {"title": "Váratlan fordulat Stohl András és Kiss Kriszta szakítása után: „Én próbálkoztam”", "hint": ""},
  {"title": "Az új rendelettel 1140 magyar munkahelye szűnhet meg", "hint": ""},
  {"title": "Vizsgálatot indít a kulturális tárca az Operettszínház ügyében", "hint": ""},
  {"title": "„Kezdd el a mozgást, a motiváció majd utolér” – az Európai Sporthét 40 országban pörgetné fel az embereket", "hint": ""},
  {"title": "Gerendai az államtól kérne segítséget a Sziget fenntartásához", "hint": ""},
  {"title": "Baltával kergette az élettársát egy férfi Abonyban, lábon lőtték a rendőrök", "hint": ""},
  {"title": "Az apuka után meghalt a mendei balesetben megsérült édesanya és hároméves kisfia is", "hint": ""},
  {"title": "A kormány kérdez, a MOHU válaszol – zajlik a koncessziós rendszer felülvizsgálata", "hint": ""},
  {"title": "Sokan féleértették, Ádám Szofi még tartogat meglepetéseket a Sztárban Sztár műsorban", "hint": ""},
  {"title": "Pumped Gabo és Kiss Laci elárulták, min lepődtek meg legjobban a Most Wanted alatt.", "hint": ""},
  {"title": "A személyzet közül senki sem élte túl, és az utasok fele is odaveszett: a reptér előtt zuhant le a Budapestre tartó gép, rejtély, hová tűnt az egyik utas", "hint": ""},
  {"title": "Bőröndbe rejtett női holttest úszkált a folyóban, brutális gyilkosság áldozata lett", "hint": ""},
  {"title": "Fizet az Apple: kártérítést kaphatnak egyes iPhone-vásárlók", "hint": ""},
  {"title": "Drámai videó: így csapódott a földbe a légierő gépe", "hint": ""},
  {"title": "Nyilvánvaló kamu szövetkezet kínál befektetésgyanús ajánlatokat, mégsem nyomoz a rendőrség", "hint": ""},
  {"title": "15 év börtönre ítélték Harvey Weinsteint egy alkalmazottja szexuális zaklatásáért", "hint": ""},
  {"title": "Magyar utakon az 1660 kilométeres rekord hatótávú eddigi legerősebb Jaecoo", "hint": ""},
  {"title": "16 évig volt kénytelen nyögni a Fidesz igáját, de most felszabadult a KDNP, és saját győzelmeként ünnepli, hogy december 24-e munkaszüneti nap lehet", "hint": ""},
  {"title": "Fordulatok a Trafó igazgatói pályázata körül: Gulyás Gábort kizárták a versenyből, és a Partizán fóruma is elmarad", "hint": ""},
  {"title": "Lecsökkentették a fizetését a színházban, Szacsvay László elárulta, mi...", "hint": "szacsvay laszlo havi jovedelem nyugdij jaradek"},
  {"title": "Nem sokkal a zuhanás előtt katapultáltak a pilóták a brit légierő lezu...", "hint": "brit legiero hawk trening repulo balesete katapult"},
  {"title": "Mások is segítettek eldugni a gyilkos fegyvert – rács mögött marad a k...", "hint": "masok is segitettek eldugni a gyilkos fegyvert racs mogott marad a ket erzsebetvarosi gyilkos"}
].map((h, i) => ({ id: `x${i}`, ...h }));

// ------------------------------------------------ a régi, v1-es kérdések szó szerint (1.1.0 és korábban)
const V1_LEVELS = [
  "Informative: the headline states the concrete news fact plainly (who / what happened). No hook.",
  "Mostly informative: the fact is clear, with some emotional or attention-grabbing wording.",
  "Mixed: the topic is clear, but a key detail is deliberately held back or exaggerated.",
  "Clickbait: relies on a curiosity gap or sensational framing; the reader must click to learn what actually happened.",
  "Extreme clickbait: a vague teaser with little or no factual content (shock, 'you won't believe', 'this is why', 'here is what happened').",
];
const V1_INSTRUCTION = (ref) =>
  `How clickbait is the Hungarian news headline ${ref}? ` +
  "Judge only the wording of `title`. `url_hint` is the article's URL slug; use it only to complete a title that was cut off with '...'. " +
  "Clickbait means: withholding the key information to create a curiosity gap, sensational or emotional exaggeration, " +
  "vague forward references (e.g. 'kiderült', 'mutatjuk', 'eláruljuk', 'ezt', 'így', 'ez az oka'), or addressing the reader directly to provoke a click. " +
  "A headline that plainly reports a fact is not clickbait, even if the topic is dramatic.";
const V1_EXTRA = (ref) => ({
  e: { type: "score", instructions: `How emotionally charged is the wording of the Hungarian news headline ${ref}? Judge the words, not the topic.`,
    criteria: ["Neutral, matter-of-fact wording.", "Mild emotion: some evaluative or colorful words.", "Strong emotion: dramatic, outraged, fearful or ecstatic wording.", "Extreme: the headline is built around shock, outrage or fear."] },
  t: { type: "choice", instructions: `Is the news reported in the Hungarian headline ${ref} good, bad or neutral news?`,
    criteria: { negative: "Bad news: conflict, crime, disaster, loss, criticism, decline.", neutral: "Neither clearly good nor bad.", positive: "Good news: success, help, improvement, celebration." } },
  c: { type: "choice", instructions: `What is the main topic of the Hungarian news headline ${ref}?`,
    criteria: { politics: "Hungarian or international politics, government, elections, war and diplomacy.", economy: "Economy, business, prices, taxes, finance, jobs.", crime: "Crime, police, courts, accidents, disasters.", sport: "Sport.", celebrity: "Celebrities, TV, gossip, royals.", lifestyle: "Health, food, home, travel, relationships, horoscope.", science: "Technology, science, cars, gadgets, nature.", other: "None of the above." } },
});
async function scoreV1(items) {
  const state = { headlines: items.map((it) => ({ title: it.title, url_hint: it.hint || "" })) };
  const questions = {};
  items.forEach((it, i) => {
    const ref = `\`headlines[${i}]\``;
    questions[`h${i}`] = { type: "score", instructions: V1_INSTRUCTION(ref), criteria: V1_LEVELS };
    for (const [k, q] of Object.entries(V1_EXTRA(ref))) questions[`${k}${i}`] = q;
  });
  const data = await askJev(state, questions, cfg);
  return { results: parseTypeSafe(items, data), tokens: data.usage?.input_tokens ?? null };
}
async function interestV1(items, interest) {
  const state = { headlines: items.map((it) => ({ title: it.title, url_hint: it.hint || "" })) };
  const questions = {};
  items.forEach((it, i) => {
    questions[`m${i}`] = { type: "noul",
      instructions: { reader_interest: interest, question: `A reader described their interest in \`reader_interest\` (possibly in Hungarian). Is the Hungarian news article behind \`headlines[${i}]\` about something this reader would want to read? \`url_hint\` is the article's URL slug and may help when the title is vague or cut off.` },
      criteria: { true: "The article is clearly about the reader's interest or closely related to it.", false: "The article is about something else." } };
  });
  const data = await askJev(state, questions, cfg);
  return { results: parseInterest(items, data), tokens: data.usage?.input_tokens ?? null };
}

// ------------------------------------------------ futtatás 10-es csomagokban, ahogy a bővítmény is
async function run(fn) {
  const chunks = [];
  for (let i = 0; i < HEADLINES.length; i += 10) chunks.push(HEADLINES.slice(i, i + 10));
  const outs = await Promise.all(chunks.map(fn));
  return { results: outs.flatMap((o) => o.results), tokens: outs.reduce((a, o) => a + (o.tokens || 0), 0) };
}
const money = (t) => { const usd = (t * USD_PER_MTOK) / 1e6; return `${t.toLocaleString("hu-HU")} token · ${(usd * USD_HUF).toLocaleString("hu-HU", { maximumSignificantDigits: 2 })} Ft (${usd.toLocaleString("hu-HU", { maximumSignificantDigits: 3 })} USD)`; };
const pct = (x) => `${Math.round(x * 100)}%`;

// a v1 kétszer fut: a két v1-futás egyezése a zajszint (a Jev sem ad mindig pontosan ugyanazt)
const [s1, s1b, s2, m1, m2] = await Promise.all([run(scoreV1), run(scoreV1), run((c) => scoreWithTypeSafe(c, cfg)), run((c) => interestV1(c, QUERY)), run((c) => matchInterest(c, QUERY, cfg))]);
const agree = (A, B) => {
  const ok = A.results.map((a, i) => [a, B.results[i]]).filter(([a, b]) => !a.error && !b.error);
  const n = ok.length;
  return {
    ok,
    diff: Math.round(ok.reduce((x, [a, b]) => x + Math.abs(a.score - b.score), 0) / n),
    same: ok.filter(([a, b]) => a.level === b.level).length / n,
    near: ok.filter(([a, b]) => Math.abs(a.level - b.level) <= 1).length / n,
    topic: ok.filter(([a, b]) => a.topic === b.topic).length / n,
    tone: ok.filter(([a, b]) => a.tone === b.tone).length / n,
  };
};

console.log(`\nPontozás (${HEADLINES.length} cím, 4 kérdés/cím)`);
console.log(`  v1:            ${money(s1.tokens)}`);
console.log(`  ${PROMPT_VERSION} (új):      ${money(s2.tokens)}  → ${s1.tokens ? `${pct(1 - s2.tokens / s1.tokens)} kevesebb` : "?"}`);
const line = (label, g) => console.log(`  ${label} átlagos eltérés ${String(g.diff).padStart(2)} pont · azonos szint ${pct(g.same).padStart(4)} · ±1 szint ${pct(g.near).padStart(4)} · téma ${pct(g.topic).padStart(4)} · hangvétel ${pct(g.tone).padStart(4)}`);
const base = agree(s1, s1b), cmp = agree(s1, s2);
line("v1 ↔ v1 (zajszint):", base);
line(`v1 ↔ ${PROMPT_VERSION} (új):   `, cmp);
const ok = cmp.ok;
console.log("  legnagyobb eltérések:");
for (const [a, b] of ok.sort(([a, b], [c, d]) => Math.abs(d.score - c.score) - Math.abs(b.score - a.score)).slice(0, 5))
  console.log(`    v1 ${String(a.score).padStart(3)} · új ${String(b.score).padStart(3)}  ${HEADLINES.find((h) => h.id === a.id).title.slice(0, 90)}`);

console.log(`\nVálogatás („${QUERY}”)`);
console.log(`  v1:            ${money(m1.tokens)}`);
console.log(`  ${PROMPT_VERSION} (új):      ${money(m2.tokens)}  → ${m1.tokens ? `${pct(1 - m2.tokens / m1.tokens)} kevesebb` : "?"}`);
const mm = m1.results.map((a, i) => [a, m2.results[i]]).filter(([a, b]) => !a.error && !b.error);
console.log(`  találat-döntés (50% felett) egyezik: ${pct(mm.filter(([a, b]) => (a.match >= 0.5) === (b.match >= 0.5)).length / mm.length)}; ` +
  `találatok: v1 ${mm.filter(([a]) => a.match >= 0.5).length}, új ${mm.filter(([, b]) => b.match >= 0.5).length}`);
for (const [a, b] of mm.filter(([a, b]) => (a.match >= 0.5) !== (b.match >= 0.5)))
  console.log(`    eltér: v1 ${pct(a.match)} · új ${pct(b.match)}  ${HEADLINES.find((h) => h.id === a.id).title.slice(0, 90)}`);
