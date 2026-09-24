import { DEFAULTS } from "./src/settings.js";

const $ = (id) => document.getElementById(id);

function msg(text, cls = "") {
  $("msg").textContent = text;
  $("msg").className = cls;
}

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("batchSize").value = s.batchSize;
  $("concurrency").value = s.concurrency;
}

$("save").addEventListener("click", async () => {
  const apiKey = $("apiKey").value.trim();
  await chrome.storage.local.set({
    apiKey,
    model: $("model").value.trim() || DEFAULTS.model,
    batchSize: Math.max(1, Math.min(50, Number($("batchSize").value) || DEFAULTS.batchSize)),
    concurrency: Math.max(1, Math.min(16, Number($("concurrency").value) || DEFAULTS.concurrency)),
  });
  if (!apiKey) msg("Mentve, de API-kulcs nélkül nem fog pontozni.", "err");
  else msg("Mentve. Töltsd újra a Hírkereső oldalt.", "ok");
});

$("clear").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("c:"));
  await chrome.storage.local.remove(keys);
  msg(`${keys.length} tárolt pontszám törölve.`, "ok");
});

load();
