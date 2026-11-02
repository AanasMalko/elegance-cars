// Synchronise le stock du site avec la vitrine Moteur.ma d'Elegance Cars.
// - lit toutes les pages de la vitrine (voitures uniquement)
// - ajoute les nouvelles voitures (infos + photo) et retire celles qui ne sont plus en ligne (vendues)
// - écrit cars.json, que index.html charge au démarrage
// Usage : node scripts/sync-moteur.mjs   (Node 18+, aucune dépendance)

import { readFile, writeFile, mkdir, readdir, unlink, access } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SHOWROOM = "https://www.moteur.ma/fr/voiture/achat-voiture-occasion/stock-professionnel/463772/elegance-cars-casablanca.html";
const CARS_JSON = path.join(ROOT, "cars.json");
const PHOTO_DIR = path.join(ROOT, "assets", "cars");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const LOCAL = process.env.MOTEUR_LOCAL_DIR; // tests : lit des pages HTML enregistrées au lieu d'Internet
const DRY = process.argv.includes("--dry-run");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function getHtml(url) {
  if (LOCAL) {
    const page = (url.match(/[?&]page=(\d+)/) || [, "1"])[1];
    const id = (url.match(/detail-annonce\/(\d+)\//) || [])[1];
    const f = id ? `detail-${id}.html` : `page${page}.html`;
    return readFile(path.join(LOCAL, f), "utf8").catch(() => null);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      console.warn(`HTTP ${res.status} pour ${url}`);
    } catch (e) {
      console.warn(`Erreur réseau (${attempt}/3) pour ${url}: ${e.message}`);
    }
    await sleep(2000 * attempt);
  }
  throw new Error(`Impossible de charger ${url}`);
}

const decode = (s) =>
  s.replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
   .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s) => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// --- Page vitrine : une carte par annonce ---
function parseListPage(html) {
  const total = +((html.match(/sur\s+(\d+)\s+annonces/) || [])[1] || 0);
  const cards = html.split(/<div class="card mb-0 overflow-hidden h-100 ads-index-card">/).slice(1);
  const ads = [];
  for (const c of cards) {
    const url = (c.match(/href="(https:\/\/www\.moteur\.ma\/fr\/[^"]*detail-annonce\/(\d+)\/[^"]+\.html)"/) || []);
    if (!url[1]) continue;
    const img = c.match(/<img src="([^"]+)" alt="([^"]*)" class="cover-image/);
    const heading = clean((c.match(/ads-index-title">([\s\S]*?)<\/h5>/) || [])[1]);
    const footer = (c.match(/item-card9-footer[\s\S]*?<\/div>\s*<\/div>/) || [""])[0];
    const year = +((footer.match(/fa-calendar me-1"><\/i>\s*(\d{4})/) || [])[1] || 0);
    const km = +(((footer.match(/fa-road me-1"><\/i>\s*([\d,. ]+)\s*km/) || [])[1] || "0").replace(/[^\d]/g, ""));
    const price = clean((c.match(/<h4 class="text-primary[^"]*">([\s\S]*?)<\/h4>/) || [])[1]);
    ads.push({
      id: url[2], url: url[1], isCar: url[1].includes("/fr/voiture/"),
      heading, alt: img ? clean(img[2]) : "", listImg: img ? img[1] : null, year, km, price,
    });
  }
  return { total, ads };
}

// --- Page annonce : tableau "Informations Véhicule" + photos ---
function parseDetail(html) {
  const field = (label) => clean((html.match(new RegExp(label + ":</span></td>\\s*<td>([\\s\\S]*?)</td>")) || [])[1]);
  const imgs = [...new Set([...html.matchAll(/https:\/\/www\.moteur\.ma\/storage\/media\/images\/ads\/resized\/[\w-]+\.jpg/g)].map((m) => m[0]))];
  return {
    make: field("Marque"), model: field("Modèle"), fuel: field("Motorisation"), gearbox: field("Transmission"),
    body: field("Carrosserie"), year: +field("Année") || 0, images: imgs,
  };
}

const FUEL = { "diesel": "Diesel", "essence": "Essence", "hybride": "Hybride", "hybride rechargeable": "Hybride rechargeable", "electrique": "Électrique", "électrique": "Électrique" };
const normFuel = (f) => { const k = (f || "").toLowerCase().replace(/\s*\(.*\)/, "").trim(); return !k || k === "n/a" ? "" : FUEL[k] || f; };

function bodyOf(text, given) {
  if (given && given !== "N/A") return given;
  const t = " " + text + " ";
  if (/\b(Citan|Classe T|Caddy|Vito|Classe V|Transporter|Berlingo|Partner|Kangoo|Sprinter)\b/i.test(t)) return "Utilitaire";
  if (/\b(Q[2-8]|SQ[5-8]|RSQ[38]|X[1-7]|XM|GL[ABCES]|Classe G|G-Class|G ?63|Cayenne|Macan|Urus|Bentayga|Cullinan|Range Rover|Defender|Discovery|Evoque|Velar|Tiguan|Touareg|T-Roc|Taigo|[235]008|Kodiaq|Tucson|Sportage|Santa Fe|Haval|RAV ?4|Land Cruiser|Prado|Purosangue|DBX|Levante|Grecale|Stelvio|Outlander|Magnite|Frontera)\b/i.test(t)) return "SUV";
  if (/\b(coup[ée]|GTB|GTS|GT3|911|RS ?5|M4|M8|Roma|296|488|F8|812|Huracan|Revuelto|Continental GT|Vantage|Amalfi)\b/i.test(t)) return "Coupé";
  return "Berline";
}

const MAKES = ["Land Rover", "Mercedes-Benz", "Mercedes-AMG", "Aston Martin", "Rolls-Royce", "Alfa Romeo", "Range Rover"];
const makeFromHeading = (h) => MAKES.find((m) => h.toLowerCase().startsWith(m.toLowerCase())) || h.split(" ")[0];

function displayModel(make, alt, heading) {
  let m = alt || heading || "";
  const loose = (x) => x.toLowerCase().replace(/[-\s]+/g, " ");
  for (let i = 0; i < 2; i++) if (make && loose(m).startsWith(loose(make))) m = m.slice(make.length).trim();
  m = m.replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+full( options?)?\s*$/i, "");
  let prev;
  do { prev = m; m = m.replace(/(?:^|\s+)(Essence|Diesel|Hybride rechargeable|Hybride|Hybrid|Électrique|Electrique|Automatique|Manuelle|à Casablanca|de)\s*$/i, "").trim(); } while (m !== prev);
  m = m.replace(/\s+/g, " ").trim();
  if (!m || /^autre$/i.test(m)) m = heading.replace(new RegExp("^" + make + "\\s*", "i"), "").replace(/\bAutre\b/i, "").trim();
  return m || heading;
}

async function downloadPhoto(id, candidates) {
  const file = path.join(PHOTO_DIR, `${id}.jpg`);
  if (await exists(file)) return `assets/cars/${id}.jpg`;
  if (LOCAL || DRY) return null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.moteur.ma/" } });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("image/")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) continue;
      await writeFile(file, buf);
      return `assets/cars/${id}.jpg`;
    } catch { /* essaie la photo suivante */ }
  }
  return null;
}

async function main() {
  const previous = JSON.parse(await readFile(CARS_JSON, "utf8").catch(() => "[]"));
  const prevById = new Map(previous.map((c) => [c.id, c]));

  // 1) Toutes les annonces de la vitrine
  const seen = new Map();
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const html = await getHtml(page === 1 ? SHOWROOM : `${SHOWROOM}?page=${page}`);
    if (!html) break;
    const { total: t, ads } = parseListPage(html);
    if (t) total = t;
    const fresh = ads.filter((a) => !seen.has(a.id));
    fresh.forEach((a) => seen.set(a.id, a));
    if (!fresh.length || seen.size >= total) break;
    await sleep(1500);
  }
  const ads = [...seen.values()];
  console.log(`Annonces trouvées : ${ads.length}${total ? ` / ${total} annoncées` : ""}`);

  // Garde-fou : si Moteur.ma a renvoyé une page vide ou incomplète, on ne touche à rien
  if (!ads.length || (total && ads.length < total) || (previous.length && ads.length < previous.length * 0.5)) {
    throw new Error("Lecture de la vitrine incomplète, aucune modification (le site garde son stock actuel).");
  }

  // 2) Voitures : infos détaillées pour les nouvelles annonces seulement
  const cars = [];
  for (const a of ads.filter((x) => x.isCar)) {
    let c = prevById.get(a.id);
    if (!c) {
      const html = await getHtml(a.url);
      await sleep(1500);
      const d = html ? parseDetail(html) : { images: [] };
      const make = d.make || makeFromHeading(a.heading);
      if (/^autre$/i.test(make)) continue; // jet-ski, divers
      const model = displayModel(make, a.alt, a.heading);
      c = {
        id: a.id, make, model, year: a.year || d.year, km: a.km,
        fuel: normFuel(d.fuel), gearbox: d.gearbox && d.gearbox !== "N/A" ? d.gearbox : "",
        body: bodyOf(`${make} ${model} ${a.alt}`, d.body), url: a.url, photo: null,
        _imgs: [a.listImg, ...(d.images || [])].filter(Boolean),
      };
      console.log(`+ Nouvelle voiture : ${c.make} ${c.model} (${c.id})`);
    } else {
      c = { ...c, year: a.year || c.year, km: a.km, url: a.url };
    }
    if (!c.photo || !(await exists(path.join(ROOT, c.photo)))) {
      let imgs = c._imgs;
      if (!imgs) { const html = await getHtml(a.url); imgs = [a.listImg, ...(html ? parseDetail(html).images : [])].filter(Boolean); }
      c.photo = await downloadPhoto(c.id, imgs);
    }
    delete c._imgs;
    cars.push(c);
  }

  // 3) Voitures vendues : retirées de la liste et leurs photos supprimées
  const keep = new Set(cars.map((c) => `${c.id}.jpg`));
  for (const old of previous) if (!cars.find((c) => c.id === old.id)) console.log(`- Retirée (vendue) : ${old.make} ${old.model} (${old.id})`);
  if (!DRY && !LOCAL) {
    await mkdir(PHOTO_DIR, { recursive: true });
    for (const f of await readdir(PHOTO_DIR)) if (/^\d+\.jpg$/.test(f) && !keep.has(f)) await unlink(path.join(PHOTO_DIR, f));
  }

  const out = JSON.stringify(cars, null, 2) + "\n";
  if (DRY || LOCAL) { console.log(out); return; }
  await writeFile(CARS_JSON, out);
  console.log(`cars.json : ${cars.length} voitures.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
