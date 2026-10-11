import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.127.0";

const MATIERES = {
  "Mathématiques": "#2f6fdb",
  "Physique-Chimie": "#7a3fd1",
  "SVT": "#2c9a63",
  "Enseignement scientifique": "#0d8b9c",
  "Français": "#d23c3c",
  "Histoire-Géographie": "#b5651d",
  "HGGSP": "#8c5a2b",
  "SES": "#e0a400",
  "Anglais": "#c2185b",
  "Espagnol": "#ef6c00",
  "Allemand": "#5d6d7e",
  "HLP": "#6d4c41",
  "NSI": "#00897b",
  "EMC": "#546e7a",
  "Autre": "#e85d3f",
};

const MAX_PHOTOS = 20;
const MAX_SIDE = 1568;
const STORE_KEY = "romy.fiches.v1";
const KEY_KEY = "romy.apikey";
const WS_KEY = "romy.workspace";

const SYSTEM_PROMPT = `Tu es un excellent professeur de lycée en France. Tu fabriques des fiches de révision pour une élève de Première (programme officiel du lycée général, réforme du bac).

On te donne des photos de son cours (manuscrit ou imprimé), la matière et le titre du chapitre. Ta mission : produire UNE fiche de révision claire, fidèle au cours, qui tient idéalement sur 1 à 2 pages A4.

Règles de fond :
- Reste fidèle au contenu des photos : mêmes notions, mêmes notations, mêmes définitions que le prof. Ne rajoute pas de notions hors programme.
- Tu peux reformuler pour rendre plus clair, corriger une erreur évidente de recopie, et ajouter une courte explication ou un exemple si ça aide vraiment à comprendre.
- Hiérarchise : ce qui tombe au contrôle d'abord. Sois concis : phrases courtes, listes, mots-clés en **gras**.
- Si une partie des photos est illisible ou coupée, signale-le dans un encadré ATTENTION plutôt que d'inventer.

Format de sortie : uniquement du Markdown (pas de bloc de code autour, pas de phrase d'introduction ni de conclusion adressée à l'élève).
- Commence par "# " suivi du titre du chapitre.
- Puis "## L'essentiel" : 3 à 5 puces qui résument le chapitre.
- Puis les parties du cours en "## " (et "### " si besoin).
- Termine par "## Je me teste" avec 5 à 8 questions de difficulté progressive.
- Maths et sciences : écris les formules en LaTeX, $...$ en ligne et $$...$$ en bloc. Pour la chimie, utilise \\mathrm{} (ex. $\\mathrm{H_2O}$), pas \\ce.
- Pour les dates, frises et comparaisons, utilise des tableaux Markdown quand c'est plus lisible.

Encadrés : utilise ces blocs (citation Markdown, le type entre crochets sur la première ligne, suivi d'un titre court optionnel) :
> [!DEF] Nom de la notion
> La définition.

Types disponibles : [!DEF] définition, [!FORMULE] formule ou propriété/théorème, [!METHODE] méthode pas à pas, [!EXEMPLE] exemple ou exercice corrigé, [!RETENIR] à retenir absolument, [!ATTENTION] piège ou erreur fréquente.

Pour chaque question de "Je me teste", utilise un bloc QUIZ : la question sur la première ligne, la réponse (courte, corrigée) sur les lignes suivantes :
> [!QUIZ] La question ?
> La réponse.`;

const CALLOUTS = {
  DEF: ["def", "📘 Définition"],
  FORMULE: ["formule", "🧮 Formule"],
  METHODE: ["methode", "🛠️ Méthode"],
  EXEMPLE: ["exemple", "✏️ Exemple"],
  RETENIR: ["retenir", "⭐ À retenir"],
  ATTENTION: ["attention", "⚠️ Attention"],
  QUIZ: ["quiz", "❓"],
};

// ---------- état ----------
const $ = (s) => document.querySelector(s);
let photos = []; // { blob, url }
let current = null; // fiche affichée
let generating = false;

function loadFiches() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveFiches(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; }
  catch { alert("Impossible d'enregistrer (stockage du navigateur plein ou bloqué)."); return false; }
}
function upsertFiche(f) {
  const list = loadFiches().filter((x) => x.id !== f.id);
  list.unshift(f);
  saveFiches(list);
}
function getKey() { try { return localStorage.getItem(KEY_KEY) || ""; } catch { return ""; } }
function getWorkspace() { try { return localStorage.getItem(WS_KEY) || ""; } catch { return ""; } }

// ---------- navigation ----------
function show(view) {
  if (generating && view !== "fiche") {
    if (!confirm("La fiche est en cours de création. Quitter quand même ?")) return;
  }
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== `view-${view}`;
  if (view === "home") renderLibrary();
  if (view === "settings") { $("#apikey").value = getKey(); $("#workspace").value = getWorkspace(); showKeyInfo(); }
  if (view === "new" && !getKey()) {
    showError("Ajoute d'abord la clé API dans les réglages (⚙︎).");
  }
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-nav]");
  if (!t) return;
  e.preventDefault();
  show(t.dataset.nav);
});

// ---------- bibliothèque ----------
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
function renderLibrary() {
  const q = $("#search").value.trim().toLowerCase();
  const m = $("#filter-matiere").value;
  const all = loadFiches();
  const list = all.filter((f) => (!m || f.matiere === m) && (!q || (f.chapitre + " " + f.matiere).toLowerCase().includes(q)));
  const lib = $("#library");
  lib.replaceChildren();
  for (const f of list) {
    const b = document.createElement("button");
    b.className = "tile";
    b.style.setProperty("--subject", colorOf(f.matiere));
    b.innerHTML = `<div class="m"></div><div class="c"></div><div class="d"></div>`;
    b.querySelector(".m").textContent = f.matiere;
    b.querySelector(".c").textContent = f.chapitre;
    b.querySelector(".d").textContent = `${fmtDate(f.createdAt)} · ${f.nbPhotos} photo${f.nbPhotos > 1 ? "s" : ""}`;
    b.addEventListener("click", () => openFiche(f.id));
    lib.append(b);
  }
  $("#empty").hidden = all.length > 0;
  $("#empty").textContent = all.length ? "" : "Aucune fiche pour l'instant. Crée ta première ! ✨";
  if (all.length && !list.length) { $("#empty").hidden = false; $("#empty").textContent = "Aucune fiche ne correspond."; }
}
function colorOf(m) { return MATIERES[m] || MATIERES.Autre; }

function fillSelects() {
  const sel = $("#matiere");
  for (const m of Object.keys(MATIERES)) sel.add(new Option(m, m));
  const used = [...new Set(loadFiches().map((f) => f.matiere))].sort();
  const fsel = $("#filter-matiere");
  for (const m of used) fsel.add(new Option(m, m));
}
$("#search").addEventListener("input", renderLibrary);
$("#filter-matiere").addEventListener("change", renderLibrary);
$("#matiere").addEventListener("change", () => { $("#autre-wrap").hidden = $("#matiere").value !== "Autre"; });

// ---------- photos ----------
async function addFiles(files) {
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) { showError(`${MAX_PHOTOS} photos maximum par fiche.`); break; }
    if (!file.type.startsWith("image/")) continue;
    try {
      const blob = await resizeImage(file);
      photos.push({ blob, url: URL.createObjectURL(blob) });
    } catch {
      showError(`Impossible de lire « ${file.name} ». Essaie en JPEG ou PNG.`);
    }
  }
  renderThumbs();
}
async function resizeImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.85));
}
function renderThumbs() {
  const box = $("#thumbs");
  box.replaceChildren();
  photos.forEach((p, i) => {
    const d = document.createElement("div");
    d.className = "thumb";
    d.innerHTML = `<img alt="" /><span class="num">${i + 1}</span><button type="button" class="rm" aria-label="Retirer">✕</button>`;
    d.querySelector("img").src = p.url;
    d.querySelector(".rm").addEventListener("click", () => {
      URL.revokeObjectURL(p.url);
      photos.splice(i, 1);
      renderThumbs();
    });
    box.append(d);
  });
}
for (const id of ["#cam", "#gallery"]) {
  $(id).addEventListener("change", async (e) => { await addFiles([...e.target.files]); e.target.value = ""; });
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function showError(msg) {
  const e = $("#form-error");
  e.textContent = msg; e.hidden = !msg;
}

// ---------- génération ----------
$("#form-new").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const apiKey = getKey();
  let matiere = $("#matiere").value;
  if (matiere === "Autre") matiere = $("#matiere-autre").value.trim() || "Autre";
  const chapitre = $("#chapitre").value.trim();
  const consignes = $("#consignes").value.trim();
  if (!apiKey) return showError("Ajoute d'abord la clé API dans les réglages (⚙︎).");
  if (!chapitre) return showError("Indique le nom du chapitre.");
  if (!photos.length) return showError("Ajoute au moins une photo du cours.");

  const fiche = { id: crypto.randomUUID(), matiere, chapitre, markdown: "", createdAt: Date.now(), nbPhotos: photos.length };
  const content = [];
  for (const [i, p] of photos.entries()) {
    content.push({ type: "text", text: `Page ${i + 1} :` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(p.blob) } });
  }
  content.push({
    type: "text",
    text: `Matière : ${matiere}\nChapitre : ${chapitre}\nNiveau : Première générale` +
      (consignes ? `\nConsignes de l'élève : ${consignes}` : "") +
      `\n\nFais la fiche de révision de ce chapitre à partir des ${photos.length} photo(s) ci-dessus.`,
  });

  $("#btn-generate").disabled = true;
  generating = true;
  current = fiche;
  show("fiche");
  setStatus("Claude lit tes photos…", "Ça prend en général 1 à 2 minutes. Garde la page ouverte.");
  renderFiche(fiche);

  try {
    const workspace = getWorkspace();
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
    });
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });
    let pending = false;
    stream.on("text", (delta) => {
      fiche.markdown += delta;
      if (!pending) {
        pending = true;
        requestAnimationFrame(() => { pending = false; renderFiche(fiche); });
      }
      setStatus("Claude écrit ta fiche…", "Encore quelques instants.");
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Claude n'a pas pu traiter ce cours. Réessaie avec d'autres photos.");
    if (!fiche.markdown.trim()) throw new Error("La réponse est vide. Réessaie.");
    renderFiche(fiche);
    upsertFiche(fiche);
    setStatus(null);
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    photos = [];
    renderThumbs();
    $("#form-new").reset();
    $("#autre-wrap").hidden = true;
    refreshFilter();
  } catch (err) {
    console.error(err);
    setStatus(null);
    current = null;
    $("#fiche").replaceChildren();
    generating = false;
    show("new");
    showError(explainError(err));
  } finally {
    generating = false;
    $("#btn-generate").disabled = false;
  }
});

function explainError(err) {
  const s = err?.status;
  const m = String(err?.message || err);
  if (/workspace/i.test(m)) return "Cette clé doit être liée à un workspace : ajoute l'ID du workspace dans les réglages (⚙︎), ou crée une clé API classique (sk-ant-api03-…) sur console.anthropic.com.";
  if (s === 401) return "Clé API refusée. Vérifie-la dans les réglages (⚙︎).";
  if (s === 403) return "Cette clé n'a pas accès à ce modèle.";
  if (s === 429) return "Trop de demandes d'un coup. Attends une minute et réessaie.";
  if (s === 529 || s >= 500) return "Les serveurs de Claude sont surchargés. Réessaie dans un moment.";
  if (/credit balance/i.test(m)) return "Plus de crédit sur le compte Anthropic. Il faut recharger.";
  if (s === 413 || /too large/i.test(m)) return "Les photos sont trop lourdes. Enlève-en quelques-unes.";
  if (/fetch|network/i.test(m)) return "Problème de connexion internet. Réessaie.";
  return "Erreur : " + m;
}

function setStatus(title, sub) {
  $("#status").hidden = !title;
  if (title) { $("#status-title").textContent = title; $("#status-sub").textContent = sub || ""; }
  for (const id of ["#btn-edit", "#btn-download", "#btn-delete", "#btn-print"]) $(id).disabled = !!title;
}

// ---------- rendu Markdown + maths + encadrés ----------
marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown(md) {
  const maths = [];
  const stash = (tex, display) => { maths.push({ tex, display }); return `@@MATH${maths.length - 1}@@`; };
  md = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => stash(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => stash(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => stash(t, false))
    .replace(/(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s\\$])?)\$(?!\d)/g, (_, pre, t) => pre + stash(t, false));
  let html = DOMPurify.sanitize(marked.parse(md));
  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => {
    const { tex, display } = maths[+i];
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" }); }
    catch { return tex; }
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const bq of tpl.content.querySelectorAll("blockquote")) transformCallout(bq);
  return tpl.content;
}

function transformCallout(bq) {
  const first = bq.firstElementChild;
  if (!first || first.tagName !== "P") return;
  const m = first.innerHTML.match(/^\s*\[!(\w+)\]\s*/);
  if (!m) return;
  const type = CALLOUTS[m[1].toUpperCase()];
  if (!type) return;
  const rest = first.innerHTML.slice(m[0].length);
  const brIdx = rest.search(/<br\s*\/?>/i);
  const titleHtml = (brIdx === -1 ? rest : rest.slice(0, brIdx)).trim();
  const afterHtml = brIdx === -1 ? "" : rest.slice(brIdx).replace(/^<br\s*\/?>\s*/i, "");

  const box = document.createElement("div");
  box.className = `callout c-${type[0]}`;
  const bodyNodes = document.createElement("div");
  if (afterHtml.trim()) { const p = document.createElement("p"); p.innerHTML = afterHtml; bodyNodes.append(p); }
  [...bq.children].slice(1).forEach((n) => bodyNodes.append(n));

  if (type[0] === "quiz") {
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.innerHTML = `${titleHtml} <span class="reveal">voir la réponse</span>`;
    const ans = document.createElement("div");
    ans.className = "answer";
    ans.append(...bodyNodes.childNodes);
    det.append(sum, ans);
    box.append(det);
  } else {
    const t = document.createElement("div");
    t.className = "ct";
    t.innerHTML = `<span>${type[1]}</span>` + (titleHtml ? `<span class="tt">${titleHtml}</span>` : "");
    box.append(t, ...bodyNodes.childNodes);
  }
  bq.replaceWith(box);
}

function renderFiche(f) {
  const art = $("#fiche");
  art.style.setProperty("--subject", colorOf(f.matiere));
  document.documentElement.style.setProperty("--subject", colorOf(f.matiere));
  const kicker = document.createElement("div");
  kicker.className = "kicker";
  kicker.textContent = `${f.matiere} · Première`;
  const body = renderMarkdown(f.markdown);
  const nodes = [kicker, body];
  if (f.markdown && !generating) {
    const foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = `Fiche du ${fmtDate(f.createdAt)}`;
    nodes.push(foot);
  }
  art.replaceChildren(...nodes);
  document.title = f.chapitre ? `${f.chapitre} — Fiches de Romy` : "Fiches de Romy";
}

// ---------- actions sur une fiche ----------
function openFiche(id) {
  const f = loadFiches().find((x) => x.id === id);
  if (!f) return;
  current = f;
  $("#edit-wrap").hidden = true;
  setStatus(null);
  show("fiche");
  renderFiche(f);
}
$("#btn-print").addEventListener("click", () => window.print());
window.addEventListener("beforeprint", () => {
  for (const d of document.querySelectorAll(".fiche details:not([open])")) { d.open = true; d.dataset.reclose = "1"; }
});
window.addEventListener("afterprint", () => {
  for (const d of document.querySelectorAll(".fiche details[data-reclose]")) { d.open = false; delete d.dataset.reclose; }
});
$("#btn-delete").addEventListener("click", () => {
  if (!current || !confirm(`Supprimer la fiche « ${current.chapitre} » ?`)) return;
  saveFiches(loadFiches().filter((x) => x.id !== current.id));
  current = null;
  show("home");
});
$("#btn-download").addEventListener("click", () => {
  if (!current) return;
  const blob = new Blob([current.markdown], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${current.matiere} - ${current.chapitre}.md`.replace(/[\\/:*?"<>|]/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#btn-edit").addEventListener("click", () => {
  if (!current) return;
  $("#editor").value = current.markdown;
  $("#edit-wrap").hidden = false;
  $("#editor").focus();
});
$("#editor").addEventListener("input", () => renderFiche({ ...current, markdown: $("#editor").value }));
$("#btn-save-edit").addEventListener("click", () => {
  current.markdown = $("#editor").value;
  upsertFiche(current);
  $("#edit-wrap").hidden = true;
  renderFiche(current);
});
$("#btn-cancel-edit").addEventListener("click", () => { $("#edit-wrap").hidden = true; renderFiche(current); });

// ---------- réglages ----------
$("#form-settings").addEventListener("submit", (e) => {
  e.preventDefault();
  const k = $("#apikey").value.trim();
  const w = $("#workspace").value.trim();
  try {
    k ? localStorage.setItem(KEY_KEY, k) : localStorage.removeItem(KEY_KEY);
    w ? localStorage.setItem(WS_KEY, w) : localStorage.removeItem(WS_KEY);
  } catch {}
  flash(k ? "Clé enregistrée ✓" : "Clé supprimée.");
  showKeyInfo();
  showError("");
});
$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(loadFiches(), null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fiches-romy-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$("#import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw 0;
    const byId = new Map(loadFiches().map((f) => [f.id, f]));
    for (const f of data) if (f && f.id && typeof f.markdown === "string") byId.set(f.id, f);
    saveFiches([...byId.values()].sort((a, b) => b.createdAt - a.createdAt));
    refreshFilter();
    flash(`${data.length} fiche(s) restaurée(s) ✓`);
  } catch { flash("Fichier non reconnu.", true); }
});
function showKeyInfo() {
  const k = getKey();
  const p = $("#key-info");
  p.hidden = !k;
  if (!k) return;
  const type = k.startsWith("sk-ant-api") ? "clé classique ✓" : k.startsWith("sk-ant-usr") ? "clé liée à un compte : il faut l'ID du workspace, ou une clé classique" : "format inhabituel";
  p.textContent = `Clé enregistrée : ${k.slice(0, 14)}…${k.slice(-4)} (${type})`;
}
function flash(msg, bad) {
  const p = $("#settings-msg");
  p.textContent = msg; p.className = bad ? "error" : "ok"; p.hidden = false;
  setTimeout(() => (p.hidden = true), 3000);
}
function refreshFilter() {
  const fsel = $("#filter-matiere");
  while (fsel.options.length > 1) fsel.remove(1);
  for (const m of [...new Set(loadFiches().map((f) => f.matiere))].sort()) fsel.add(new Option(m, m));
}

window.addEventListener("beforeunload", (e) => { if (generating) e.preventDefault(); });

fillSelects();
show(getKey() ? "home" : "settings");
