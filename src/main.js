/**
 * PDF-läsare för StreamBIM.
 * Listar projektets PDF:er från dokumentbiblioteket och visar dem med pdf.js.
 * Kopplingen finns i src/streambim.js — vi använder bara client.
 * pdf.js laddas från CDN (inga nya npm-paket).
 */

import { connectWidget } from "./streambim.js";
import "./style.css";
import { createPdfGestures } from "./pdf-gestures.js";
import { createMarkupLayer } from "./pdf-markup.js";
import { createStreambimMarkupStore } from "./streambim-markup.js";

const PDFJS_VERSION = "4.10.38";
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
const listView = $("#list-view");
const viewerView = $("#viewer-view");
const frameEl = document.querySelector(".frame");
const listEl = $("#doc-list");
const searchEl = $("#search");
const folderEl = $("#folder");
const msgEl = $("#message");
const localEl = $("#local");
const fileInput = $("#file-input");
const titleEl = $("#doc-title");
const pageEl = $("#page-info");
const stageEl = $("#stage");
const canvas = $("#canvas");
const surface = document.createElement("div");
surface.className = "pdf-surface";
canvas.before(surface);
surface.append(canvas);
let markupLayer = null;
let markupTool = "pan";
const markupBar = document.createElement("div");
markupBar.className = "markup-toolbar";
markupBar.hidden = true;
markupBar.innerHTML = `<div class="markup-tools">${[['pan','✋','Flytta PDF'],['select','↖','Välj annotering'],['highlight','▰','Överstrykningspenna'],['pen','✎','Frihand'],['cloud','☁','Moln'],['rectangle','▭','Rektangel'],['square','□','Ruta']].map(([id,icon,name])=>`<button data-tool="${id}" aria-label="${name}" title="${name}">${icon}</button>`).join('')}<select aria-label="Färg" data-style="color"><option value="red">Röd</option><option value="yellow">Gul</option><option value="green">Grön</option><option value="blue">Blå</option><option value="black">Svart</option></select><select aria-label="Linjetjocklek" data-style="width">${[1,2,3,5,8].map(n=>`<option value="${n}" ${n===3?'selected':''}>${n} pt</option>`).join('')}</select><select aria-label="Opacitet" data-style="opacity">${[1,.75,.5,.25].map(n=>`<option value="${n}">${n*100}%</option>`).join('')}</select><button data-action="delete" aria-label="Ta bort annotering" title="Ta bort annotering" disabled>⌫</button><button data-action="reload" aria-label="Uppdatera annoteringar" title="Uppdatera annoteringar">↻</button><button data-action="retry" aria-label="Försök spara igen" title="Försök spara igen">⇧</button></div><span class="markup-status" role="status"></span>`;
stageEl.before(markupBar);
const markupStatus = markupBar.querySelector('.markup-status');
const layerBar = document.createElement("div");
layerBar.className = "layer-bar";
layerBar.hidden = true;
layerBar.innerHTML = `<label>Redigerar i <select aria-label="Aktivt lager" data-layer-active></select></label><button data-layer-add aria-label="Nytt lager" title="Nytt lager">＋ Lager</button><ul class="layer-list"></ul>`;
markupBar.after(layerBar);
const layerActive = layerBar.querySelector("[data-layer-active]");
const layerList = layerBar.querySelector(".layer-list");
function renderLayers(state) {
  layerActive.innerHTML = state.layers.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join("");
  layerActive.value = state.active;
  layerList.innerHTML = state.layers.map(l => `<li class="${l.id===state.active?"active":""}"><button data-layer-toggle="${escapeHtml(l.id)}" aria-label="${l.visible?"Dölj":"Visa"} ${escapeHtml(l.name)}" title="${l.visible?"Dölj":"Visa"}">${l.visible?"👁":"◌"}</button><button class="layer-name" data-layer-choose="${escapeHtml(l.id)}">${escapeHtml(l.name)} <small>${l.count}</small></button><button data-layer-remove="${escapeHtml(l.id)}" aria-label="Ta bort ${escapeHtml(l.name)}" title="Ta bort lager" ${state.layers.length<2?"disabled":""}>🗑</button></li>`).join("");
}
layerActive.onchange = () => markupLayer?.setActiveLayer(layerActive.value);
layerBar.onclick = e => {
  const b = e.target.closest("button"); if (!b || !markupLayer) return;
  if (b.hasAttribute("data-layer-add")) markupLayer.addLayer();
  if (b.dataset.layerToggle) markupLayer.toggleLayer(b.dataset.layerToggle);
  if (b.dataset.layerChoose) markupLayer.setActiveLayer(b.dataset.layerChoose);
  if (b.dataset.layerRemove && confirm("Ta bort lagret och dess annoteringar för alla i projektet?")) markupLayer.removeLayer(b.dataset.layerRemove);
};
const revSelect = document.createElement("select");
revSelect.setAttribute("aria-label", "Välj revision");
revSelect.className = "rev-select";
revSelect.hidden = true;
let openDoc = null;
revSelect.onchange = () => {
  if (!openDoc) return;
  if (!window.dispatchEvent(new Event("pdf-markup-before-close", { cancelable: true }))) { revSelect.value = String(openDoc.revision); return; }
  void openDocument(openDoc.id, openDoc.name, Number(revSelect.value), openDoc.revisions);
};
markupBar.onclick = e => {
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.tool) {
    markupTool=button.dataset.tool;
    markupLayer?.setTool(markupTool);
    gestures?.setEnabled(markupTool==='pan');
    for(const b of markupBar.querySelectorAll('[data-tool]'))b.setAttribute('aria-pressed',String(b.dataset.tool===markupTool));
  }
  if(button.dataset.action==='delete')markupLayer?.removeSelected();
  if(button.dataset.action==='reload')void markupLayer?.reload();
  if(button.dataset.action==='retry')markupLayer?.retry();
};
markupBar.onchange = e => { const key=e.target.dataset.style;if(key)markupLayer?.setStyle({[key]:key==='color'?e.target.value:Number(e.target.value)}); };
titleEl.after(revSelect);
const frame = $("#frame");
const openTab = $("#open-tab");
const zoomSelect = document.createElement("select");
zoomSelect.setAttribute("aria-label", "Zoomnivå");
zoomSelect.innerHTML = [50,100,150,200,300,400,800].map(n => `<option value="${n/100}">${n}%</option>`).join("");
$("#fit").before(zoomSelect);
zoomSelect.onchange = () => gestures?.zoomTo(Number(zoomSelect.value));
const fitPageButton = document.createElement("button");
fitPageButton.textContent = "▣";
fitPageButton.setAttribute("aria-label", "Visa hela sidan");
fitPageButton.title = "Visa hela sidan";
$("#fit").after(fitPageButton);
fitPageButton.onclick = () => gestures?.fitPage();
const scopeEl = document.createElement("select");
scopeEl.innerHTML = `<option value="calibrated">Kalibrerade i byggnaden</option><option value="all">Alla PDF:er i projektet</option>`;
$("#controls").prepend(scopeEl);
const directEl = document.createElement("form");
directEl.className = "direct";
directEl.hidden = true;
directEl.innerHTML = `<label>Öppna dokument-ID</label><input name="id" value="1000" inputmode="numeric" /><button type="submit">Öppna</button>`;
$("#controls").after(directEl);

let client;
let projectId = null;
let buildingId = null;
let docs = [];
let folders = new Map();
let pdfDoc = null;
let pageNum = 1;
let gestures = null;
let renderVersion = 0;
let renderTask = null;

function log(...args) {
  console.log("[pdf-widget]", ...args);
}

function showMessage(text, isError = false) {
  msgEl.textContent = text || "";
  msgEl.hidden = !text;
  msgEl.classList.toggle("error", isError);
}

function size(b) {
  return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`;
}

/* ---------- StreamBIM REST via client.api.makeApiRequest ---------- */

async function sbGet(path, accept) {
  const opts = { url: path, method: "GET" };
  if (accept) opts.accept = accept;
  let text;
  try {
    text = await client.api.makeApiRequest(opts);
  } catch (err) {
    if (/could not be cloned/.test(err?.message ?? "")) throw new Error(`GET ${path} misslyckades (HTTP-fel)`);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchAllDocuments() {
  const limit = 200;
  const all = [];
  for (let skip = 0; skip < 20000; skip += limit) {
    const res = await sbGet(`/project-${projectId}/api/v1/v2/documents?page[limit]=${limit}&page[skip]=${skip}`);
    const page = res?.data || [];
    all.push(...page);
    const total = Number(res?.meta?.total);
    if (page.length < limit || (total && all.length >= total)) break;
  }
  return { data: all };
}

async function loadDocuments() {
  showMessage("Hämtar dokument…");
  const [folderRes, docRes] = await Promise.all([
    sbGet(`/project-${projectId}/api/v1/v2/folders`).catch((e) => (log("folders", e), { data: [] })),
    // Filter (fileExtensions, buildingId) ger HTTP-fel från widgeten, så vi hämtar
    // dokumenten sidvis utan filter och väljer PDF:er och kalibrering här.
    fetchAllDocuments(),
  ]);
  folders = new Map((folderRes.data || []).map((f) => [f.id, f.attributes?.name || `Mapp ${f.id}`]));
  docs = (docRes.data || [])
    .filter((d) => !d.attributes?.["is-deleted"])
    .filter((d) => String(d.attributes?.filename || "").toLowerCase().endsWith(".pdf"))
    .map((d) => ({
      id: d.id,
      filename: d.attributes.filename,
      description: d.attributes.description || "",
      filesize: Number(d.attributes.filesize || 0),
      revision: d.attributes.revision ?? 1,
      folderId: d.relationships?.parent?.data?.id ?? null,
      calibrated: (d.relationships?.["document-alignments"]?.data || []).some((a) => String(a.id).endsWith(`-${buildingId}`)),
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename, "sv"));
  const nCal = docs.filter((d) => d.calibrated).length;
  if (!nCal) scopeEl.value = "all";
  statusEl.textContent = `${nCal} kalibrerade · ${docs.length} PDF:er`;
  fillFolders();
  renderList();
  showMessage(docs.length ? "" : "Inga PDF:er i projektet.");
}

async function getDownloadUrl(id) {
  const res = await sbGet(`/project-${projectId}/api/v1/documents/${id}/downloadlink`, "application/json");
  const rel = typeof res === "string" ? res : res.data;
  if (/^https?:\/\//.test(rel)) return rel;
  const origin = location.ancestorOrigins?.[0] || "https://app.streambim.com";
  return `${origin}/project-${projectId}/api/v1${rel}`;
}

async function listRevisions(id) {
  const res = await sbGet(`/project-${projectId}/api/v1/v2/document-revisions?filter[document]=${encodeURIComponent(id)}`);
  return (res?.data || []).map(r => ({ revision: Number(r.attributes?.revision ?? String(r.id).split("-").pop()), active: Boolean(r.attributes?.["is-active-revision"]), uploaded: String(r.attributes?.["uploaded-date"] || "") }))
    .filter(r => Number.isInteger(r.revision) && r.revision > 0).sort((a, b) => b.revision - a.revision);
}

// Aktuell revision via dokumenterad länk; äldre revisioner med revisionsargument (ej dokumenterat av StreamBIM).
async function getRevisionUrl(id, revision, current) {
  if (revision === current) return getDownloadUrl(id);
  const res = await sbGet(`/project-${projectId}/api/v1/documents/${id}/downloadlink?revision=${revision}`, "application/json");
  const rel = typeof res === "string" ? res : res.data;
  if (/^https?:\/\//.test(rel)) return rel;
  const origin = location.ancestorOrigins?.[0] || "https://app.streambim.com";
  return `${origin}/project-${projectId}/api/v1${rel}`;
}

async function openDocument(id, name, wanted, known, fallbackRevision) {
  const revisions = known || await listRevisions(id).catch(err => { log("revisioner", err); return []; });
  const current = revisions.find(r => r.active)?.revision ?? Number(fallbackRevision ?? revisions[0]?.revision ?? 1);
  const revision = wanted ?? current;
  const url = await getRevisionUrl(id, revision, current);
  openDoc = { id, name, revision, revisions };
  revSelect.innerHTML = revisions.map(r => `<option value="${r.revision}">Rev ${r.revision}${r.active ? " (aktuell)" : ""}${r.uploaded ? " · " + r.uploaded.slice(0, 10) : ""}</option>`).join("");
  revSelect.hidden = revisions.length === 0;
  revSelect.value = String(revision);
  revSelect.title = "Annoteringar sparas per revision";
  renderList();
  await openPdf({ url, name, documentId: id, revision: { current: revision, legacy: current } });
}

/* ---------- List ---------- */

function fillFolders() {
  const used = [...new Set(docs.map((d) => d.folderId).filter(Boolean))];
  folderEl.hidden = used.length < 2;
  folderEl.innerHTML = `<option value="all">Alla mappar</option>` +
    used.map((id) => `<option value="${id}">${escapeHtml(folders.get(id) || `Mapp ${id}`)}</option>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderList() {
  const q = searchEl.value.trim().toLowerCase();
  const f = folderEl.value || "all";
  const shown = docs.filter(
    (d) => (scopeEl.value === "all" || d.calibrated) && (f === "all" || d.folderId === f) && (d.filename + " " + d.description).toLowerCase().includes(q),
  );
  listEl.innerHTML = shown
    .map(
      (d) => `<li><button class="doc${openDoc?.id === d.id ? " active" : ""}" data-id="${d.id}" ${openDoc?.id === d.id ? 'aria-current="true"' : ""}>
        <span class="icon">PDF</span>${d.calibrated ? `<span class="cal" title="Kalibrerad">✓</span>` : ""}
        <span class="meta"><b>${escapeHtml(d.filename)}</b>
        <small>${d.folderId && folders.get(d.folderId) ? escapeHtml(folders.get(d.folderId)) + " · " : ""}rev ${d.revision} · ${size(d.filesize)}</small></span>
      </button></li>`,
    )
    .join("");
  if (docs.length && !shown.length) listEl.innerHTML = `<li class="empty">${scopeEl.value === "calibrated" ? "Inga kalibrerade PDF:er. Välj Alla PDF:er." : "Inga träffar."}</li>`;
}

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button.doc");
  if (!btn) return;
  const doc = docs.find((d) => d.id === btn.dataset.id);
  if (openDoc?.id === doc.id) return;
  if (markupLayer && !window.dispatchEvent(new Event("pdf-markup-before-close", { cancelable: true }))) return;
  btn.classList.add("busy");
  try {
    await openDocument(doc.id, doc.filename, undefined, undefined, doc.revision);
  } catch (err) {
    log("open", err);
    showMessage(err.message, true);
  } finally {
    btn.classList.remove("busy");
  }
});
directEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = String(new FormData(directEl).get("id") || "").trim();
  if (!id) return;
  showMessage(`Öppnar dokument ${id}…`);
  try {
    let name = `Dokument ${id}`;
    try {
      const res = await sbGet(`/project-${projectId}/api/v1/v2/documents/${id}`);
      if (res?.data?.attributes?.filename) name = res.data.attributes.filename;
      log("dokument", id, res?.data);
    } catch (err) {
      log("kunde inte läsa dokumentinfo", err);
    }
    await openDocument(id, name);
    showMessage("");
  } catch (err) {
    log("direct", err);
    showMessage(err.message, true);
  }
});
searchEl.addEventListener("input", renderList);
folderEl.addEventListener("change", renderList);
scopeEl.addEventListener("change", renderList);

/* ---------- Viewer ---------- */

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ||= import(/* @vite-ignore */ PDFJS_URL).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  });
  return pdfjsPromise;
}

async function openPdf({ url, data, name, documentId, revision }) {
  if (!documentId) { openDoc = null; revSelect.hidden = true; }
  layerBar.hidden = true;
  if (!window.dispatchEvent(new Event("pdf-markup-before-close", { cancelable: true }))) return;
  markupLayer?.destroy();
  markupLayer=null;
  markupBar.hidden=true;
  surface.hidden=false;
  viewerView.hidden = false;
  layout();
  titleEl.textContent = name;
  titleEl.title = name;
  openTab.hidden = !url;
  if (url) openTab.href = url;
  frame.hidden = true;
  frame.removeAttribute("src");
  canvas.hidden = true;
  pageEl.textContent = "Laddar…";
  gestures?.destroy();
  gestures = null;
  renderVersion++;
  renderTask?.cancel();
  pdfDoc?.destroy?.();
  pdfDoc = null;
  pageNum = 1;


  try {
    if (!data) {
      const r = await fetch(url, { credentials: "omit" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.arrayBuffer();
    }
    const pdfjs = await loadPdfjs();
    pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
    canvas.hidden = false;
    const store = documentId && client?.api ? createStreambimMarkupStore(client.api,String(projectId),String(buildingId),String(documentId),revision) : undefined;
    markupLayer = createMarkupLayer(surface,store,text=>{markupStatus.textContent=text;},selected=>{markupBar.querySelector('[data-action="delete"]').disabled=!selected;},renderLayers);
    layerBar.hidden=false;
    markupStatus.textContent = store ? 'Laddar annoteringar…' : 'Ej sparat · fristående läge';
    markupBar.hidden=false;
    markupTool='pan';
    markupLayer.setTool('pan');
    markupBar.querySelector('[data-tool="pan"]').setAttribute('aria-pressed','true');
    await renderPage();
    const { default: Panzoom } = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.6.0/dist/panzoom.es.js");
    gestures = createPdfGestures(surface, stageEl, Panzoom, (scale) => renderPage(false, scale), (scale) => {
      const custom = zoomSelect.querySelector('[data-current]');
      custom?.remove();
      if (![0.5,1,1.5,2,3,4,8].includes(scale)) {
        const option = new Option(`${Math.round(scale*100)}%`, String(scale));
        option.dataset.current = "true";
        zoomSelect.prepend(option);
      }
      zoomSelect.value = String(scale);
    });
  } catch (err) {
    // Hämtningen stoppas troligen av CORS. Visa i webbläsarens egen läsare istället.
    log("pdf.js kunde inte läsa, visar i ram", err);
    if (url) {
      surface.hidden=true;
      markupBar.hidden=true;
      frame.src = url;
      frame.hidden = false;
      pageEl.textContent = "Inbyggd läsare";
    } else {
      pageEl.textContent = "Kunde inte läsa filen";
    }
  }
}

async function renderPage(reset = true, resolution = 1) {
  if (!pdfDoc) return;
  const version = ++renderVersion;
  renderTask?.cancel();
  if (reset) gestures?.reset();
  try {
    const page = await pdfDoc.getPage(pageNum);
    if (version !== renderVersion) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(1, stageEl.clientWidth - 24) / base.width;
    const width = base.width * scale;
    const height = base.height * scale;
    const pixels = Math.min((window.devicePixelRatio || 1) * resolution, 4, 8192 / Math.max(width, height), Math.sqrt(16000000 / (width * height)));
    const viewport = page.getViewport({ scale: scale * pixels });
    const buffer = document.createElement("canvas");
    buffer.width = Math.ceil(viewport.width);
    buffer.height = Math.ceil(viewport.height);
    renderTask = page.render({ canvasContext: buffer.getContext("2d"), viewport });
    await renderTask.promise;
    if (version !== renderVersion) return;
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext("2d").drawImage(buffer, 0, 0);
    markupLayer?.setPage(pageNum,width,height);
    pageEl.textContent = `${pageNum} / ${pdfDoc.numPages}`;
    $("#prev").disabled = pageNum <= 1;
    $("#next").disabled = pageNum >= pdfDoc.numPages;
  } catch (err) {
    if (version === renderVersion && err.name !== "RenderingCancelledException") log("render", err);
  }
}

$("#prev").onclick = () => pdfDoc && pageNum > 1 && (pageNum--, renderPage());
$("#next").onclick = () => pdfDoc && pageNum < pdfDoc.numPages && (pageNum++, renderPage());
$("#zoom-in").onclick = () => gestures?.zoomBy(1.25);
$("#zoom-out").onclick = () => gestures?.zoomBy(1 / 1.25);
$("#fit").onclick = () => gestures?.reset();
$("#back").onclick = () => {
  if (!window.dispatchEvent(new Event("pdf-markup-before-close", { cancelable: true }))) return;
  markupLayer?.destroy();
  markupLayer = null;
  gestures?.destroy();
  gestures = null;
  renderVersion++;
  renderTask?.cancel();
  viewerView.hidden = true;
  openDoc = null;
  layout();
  renderList();
  frame.removeAttribute("src");
};
// Bred skärm: dokumentlista och lager till vänster, PDF till höger.
function layout() {
  const wide = window.innerWidth >= 720 && !viewerView.hidden;
  frameEl.classList.toggle("split", wide);
  listView.hidden = !viewerView.hidden && !wide;
  $("#back").hidden = wide;
  $("#back").parentElement.hidden = wide && openTab.hidden;
  if (wide) { if (layerBar.parentElement !== listView) listView.append(layerBar); }
  else if (markupBar.nextElementSibling !== layerBar) markupBar.after(layerBar);
}
window.addEventListener("resize", () => { layout(); if (!viewerView.hidden) renderPage(); });

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (file) await openPdf({ data: await file.arrayBuffer(), name: file.name });
  fileInput.value = "";
});

/* ---------- Start ---------- */

async function start() {
  client = await connectWidget({});
  if (client.mode === "live") {
    try {
      projectId = await client.getProjectId();
      buildingId = await client.api.getBuildingId();
      if (!buildingId) throw new Error("Ingen byggnad är öppen i vyn.");
      $("#controls").hidden = false;
      directEl.hidden = false;
      await loadDocuments();
    } catch (err) {
      log("load", err);
      statusEl.textContent = "Live";
      showMessage(err.message, true);
    }
    return;
  }
  statusEl.textContent = client.mode === "mock" ? "Lokalt" : "Ingen kontakt";
  showMessage(client.mode === "mock" ? "Mock-läge: inget dokumentbibliotek. Testa läsaren med en egen PDF." : client.reason, client.mode !== "mock");
  localEl.hidden = false;
}

start();
