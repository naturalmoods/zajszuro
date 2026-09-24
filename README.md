# Zajszűrő

Chrome-bővítmény hírportálokhoz. A TypeSafe **Jev** modelljével kiválogatja a hírek közül, ami érdekel, témák szerint szűr, és 0-tól (tényszerű) 100-ig (erősen kattintásvadász) pontozza a címeket. A hirkereso.hu-n és a hirstart.hu-n magától indul, **bármely más oldalon a bővítmény ikonjára kattintva** nyílik meg.
Saját szerver nélkül: minden a böngészőben fut, a hívások közvetlenül a TypeSafe API-hoz mennek, a saját kulcsoddal.

## Telepítés

1. Töltsd le a tárolót (**Code → Download ZIP**, majd csomagold ki), vagy: `git clone <a tároló címe>`.
2. Chrome → `chrome://extensions` → jobb felül **Fejlesztői mód** be.
3. **Kicsomagolt bővítmény betöltése** → válaszd ki ezt a mappát.
4. Nyisd meg a https://www.hirkereso.hu/ vagy a https://www.hirstart.hu/ oldalt, vagy bármely hírportálon kattints a bővítmény ikonjára (újabb kattintás: elrejti / megnyitja).

A bővítmény a TypeSafe **Jev** modelljével pontoz, ehhez saját API-kulcs kell (https://typesafe.ai). A kulcsot a panel fogaskerék gombjával adhatod meg (vagy a `chrome://extensions` oldalon a bővítmény Részletek → Bővítménybeállítások pontjában).

**Hangolás:**
- *Címek hívásonként* (alapból 10): egy hívásban ennyi cím megy, mindegyik saját kérdéssel. Az `1` minden címet külön hívásban küld: a dokumentáció szerint ez pontosabb lehet, cserébe ~450 kérés megy ki.
- *Párhuzamos hívások* (alapból 6): 429-es hibánál csökkentsd.

**Próba valódi oldalakon, kulcs nélkül:** `node test/sites.mjs https://telex.hu/ https://24.hu/` – headless Chromiumban, szimulált Jev-válaszokkal végigpróbálja a címfelismerést, a gépelést, a válogatást és a nézetváltást; a képernyőképek a `test/out/` mappába kerülnek.

**Gyors próba böngésző nélkül:** `TYPESAFE_API_KEY=ts_... node test/jev.mjs` – három mintacímet pontoz 1 és 4 kérdéssel is, kiírja a két időt, és ellenőrzi, hogy a tényszerű cím kapja a legkevesebb pontot.

## Működés

- A tartalomszkript összegyűjti a címlinkeket, azonosító szerint egyesítve:
  - Hírkereső: `rd.hirkereso.hu/rd/<id>` linkek (~450 egyedi cím, ~610 link).
  - Hírstart: `rel="hs_<id>_…"` jelölésű cikklinkek (~320 egyedi cím). Itt a jelvény a linken belülre kerül, mert a címlink blokkszintű.
  - Bármely más oldal: hírcím az a látható link, amely nincs menüben, fejlécben, láblécben vagy oldalsávban, és a szövege (vagy a benne lévő címsor szövege) 20–220 karakteres, legalább 3 szavas, főleg betűkből álló mondat. A „Tovább a …”, feliratkozós és webshopos linkek kimaradnak. Legfeljebb 600 cím oldalanként.
- A Hírkereső a hosszú címeket levágja („…”). Ezért a cikk URL-jéből kinyert részlet (`url_hint`) is kimegy, azzal az utasítással, hogy csak a levágott cím kiegészítésére használja.
- Először a képernyőn látható címek mennek, az eredmények folyamatosan jelennek meg.
- A pontszámok 48 órán át a böngészőben tárolódnak (címazonosító + modell + promptverzió szerint), így újratöltéskor azonnal megvannak. **Újramérés gyorsítótár nélkül** (Sebesség fül) = a tárolt eredmények figyelmen kívül hagyása.
- Minden cím 4 kérdéssel megy ki egy hívásban: kattintásvadászat, érzelmi töltet, hangvétel és téma.

## A panel

A panel a jobb szélen egy teljes magasságú oldalsáv, a lap tartalma balra húzódik mellőle (900 px-nél keskenyebb ablakban, és a fix szélességű oldalakon, pl. index.hu, a tartalom fölé kerül). A » gombbal elrejthető; ilyenkor egy kis „Zajszűrő” fül marad a jobb szélen. A tetején mindig látszik az állapot (pl. „322 cím pontozva · 4,4 s alatt”). Alatta három fül. **A két fő nézet nem keveredik:** a Válogatás fülön az oldalon csak a válogatás hat (kiemelés, halványítás, témák, a pontszámok rejtve), a Kattintásvadászat fülön csak a pontszámok (szám, színezés, küszöb). A Sebesség fül az előző nézetet hagyja az oldalon.

**Válogatás** (alapnézet)
- **„Milyen hírek érdekelnek?”**: chatszerű szövegdoboz. Írd le a saját szavaiddal, mi érdekel, például „kisvállalkozásokat érintő hírek”; a dobozban halványan egy véletlen példa látszik. Az Enter elküldi, a Shift+Enter új sort kezd. A Jev minden címre egy igen/nem kérdéssel eldönti, hogy érdekelne-e. A találatok kék jelölést kapnak, a többi sor elhalványul, a panel kiírja a találatok számát és az időt, és felsorolja a legjobb találatokat. A panel listáiban egy címre kattintva egyből a cikk nyílik meg (ahogy az oldal linkje nyitná; Ctrl/középső gomb: új lap). A találati küszöb a `src/content.js` `MATCH` állandója (alapból 0,5).
- **Témák**: a kiválasztott témájú címek maradnak élesek, a többi elhalványul. Több téma is választható.

**Kattintásvadászat**
- Megjelenítés: **Szám** / **Színezés** (a teljes sor színezése) / **Elhalványítás** (a küszöb fölötti címek elhalványítása vagy elrejtése).
- Eloszlás, a tíz legkattintásvadászabb cím, és a hirkereso/hirstart oldalon a források élő rangsora (legalább 3 cím forrásonként).

**Sebesség**
- A címek száma, a teljes idő és a cím/s.
- **Jev-hívások idővonala**: minden API-hívás egy csík a párhuzamos sávokban, alatta a hívásszám, a medián válaszidő és a hívásonkénti kérdésszám. Keresés után a keresés hívásait mutatja.
- **Újramérés gyorsítótár nélkül**, és a Hírstarton **Nagy teszt**: átvisz az „Összes mai hír” oldalra (~950 cím).

**Az oldalon**
- **Szám a címek előtt**: a kattintásvadász-pontszám. Ha fölé viszed az egeret, egy buborékban látszik az 5 szint valószínűsége, a biztosság, az érzelmi töltet, a hangvétel, a téma és a forrás.
- **Szkennervonal és söprés**: pontozás közben egy vonal pásztázza a képernyőt, a számok fentről lefelé hullámban jelennek meg.
- **Új címek**: ha az oldal később új címeket tölt be, azok maguktól pontszámot kapnak, és a panel kiírja, mennyi idő alatt.
- **Bármely oldalon**: jelölj ki egy szöveget, jobb klikk → „Zajszűrő: mennyire kattintásvadász?”. A kijelölés mellett megjelenik a pontszám, a valószínűségek és a válaszidő.

## Fájlok

- `src/content.js`, `src/content.css` – címek gyűjtése, jelvények, panel (shadow DOM)
- `src/background.js` – sorkezelés, párhuzamosság, gyorsítótár, hívásidők mérése, jobb klikkes menü
- `src/scorers.js` – Jev-kérdések: a kattintásvadász-prompt és az 5 szint (`PROMPT_VERSION`), a 3 extra kérdés és az érdeklődés szerinti válogatás
- `options.html`, `options.js` – beállítások

## Korlátok és kockázatok

- **Bármely oldalon:** hírportálok címlapján és rovatoldalán működik jól. A mért 11 oldalon (telex, index, 24.hu, hvg, 444, portfolio, origo, blikk, népszava, BBC, Guardian) a felismert elemek nagyjából 95%-a valódi hírcím; nem hírportálon (pl. Wikipédia) kevés és vegyes a találat. Egyes oldalak fix szélességűek (pl. index.hu), ott a panel a tartalom egy részét takarja – a » gombbal elrejthető.
- **Magyar pontosság:** a TypeSafe nem ír magyar támogatásról. Demó előtt nézz át kézzel 30–50 pontszámot.
- **API-kulcs:** mindenki a sajátját használja; titkosítatlanul, a böngésző `chrome.storage.local` tárolójában marad, és csak a TypeSafe API-hoz megy. Saját gépre ez rendben van; ha a bővítményt a Chrome Web Store-ba tennéd, és közös kulccsal működne, a kulcsnak egy saját szerver mögé kell kerülnie.
- **Szubjektív mérés:** a kattintásvadászat nem egzakt. A skála szövege a `src/scorers.js` `LEVELS` tömbjében van; ha átírod, emeld a `PROMPT_VERSION`-t, hogy a régi tárolt eredmények ne keveredjenek az újakkal.
- **Az oldal szerkezetétől függ:** ha a Hírkereső vagy a Hírstart megváltoztatja a linkformátumot, a `linkInfo()` / `scan()` függvényt, a sorok változásakor a `ROW` választót kell igazítani (általános oldalakon: `titleOf()` / `isTitle()` / `rowOf()`).

## Licenc

[MIT-licenc](LICENSE) – szabadon használható, módosítható és terjeszthető, akár üzleti célra is. Az egyetlen feltétel, hogy a szerzői jogi megjegyzés (© Cziczlavicz Péter) maradjon meg a kódban vagy a leírásban. Ha felhasználod, örülünk, ha szólsz, vagy megemlíted a Zajszűrőt a projektedben.
