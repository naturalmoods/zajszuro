// Jev-hívás kipróbálása böngésző nélkül: TYPESAFE_API_KEY=ts_... node test/jev.mjs
// Ugyanazt a három címet 1 és 4 kérdéssel is pontozza, és kiírja a két időt.
import { scoreWithTypeSafe, TONES, TOPICS, USD_PER_MTOK } from "../src/scorers.js";

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("Add meg: TYPESAFE_API_KEY=ts_... node test/jev.mjs");
const model = process.env.TYPESAFE_MODEL || "jev-latest";

const items = [
  { id: "a", title: "Az MNB 25 bázisponttal csökkentette az alapkamatot", hint: "mnb kamatdontes alapkamat" },
  { id: "b", title: "Ezt senki nem gondolta volna: kiderült, mi történt a Balatonnál", hint: "balaton vihar" },
  { id: "c", title: "Meglepő dolgot árult el a színésznő – mutatjuk!", hint: "" },
];

// a hibás választ kiírja és továbbmegy
function check(ok, msg) {
  if (ok) return;
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
}

for (const extras of [false, true]) {
  const t0 = performance.now();
  const { results: res, tokens } = await scoreWithTypeSafe(items, { apiKey, model, extras });
  const ms = Math.round(performance.now() - t0);
  const usd = tokens == null ? null : (tokens * USD_PER_MTOK) / 1e6;
  console.log(`\n${extras ? 4 : 1} kérdés/cím · ${ms} ms · ${tokens ?? "?"} token · ${usd == null ? "?" : `${usd.toPrecision(3)} USD ≈ ${(usd * 320).toPrecision(2)} Ft`}`);
  for (const r of res) {
    const x = extras ? ` · érzelem ${r.emotion}/100 · ${TONES[r.tone]} · ${TOPICS[r.topic]}` : "";
    console.log(" ", r.id, r.error ?? `${r.score}/100 (szint ${r.level}, konf. ${r.confidence})${x}`, "–", items.find((i) => i.id === r.id).title);
  }
  check(res.length === items.length && res.every((r) => !r.error), "hibás válasz");
  check(typeof tokens === "number" && tokens > 0, "a válaszban nincs tokenszám (usage.input_tokens)");
  check(res[0].score < res[1].score && res[0].score < res[2].score, "a tényszerű cím nem a legkevesebb pontot kapta");
  if (extras) check(res.every((r) => typeof r.emotion === "number" && r.tone in TONES && r.topic in TOPICS), "hiányzó extra válasz");
}
console.log(process.exitCode ? "\nELTÉRÉS" : "\nOK");
