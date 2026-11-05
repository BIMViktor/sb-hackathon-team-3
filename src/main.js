/**
 * PDF-läsare för StreamBIM.
 * Listar projektets PDF:er från dokumentbiblioteket och visar dem med pdf.js.
 * Kopplingen finns i src/streambim.js — vi använder bara client.
 * pdf.js laddas från CDN (inga nya npm-paket).
 */

import { connectWidget } from "./streambim.js";
import "./style.css";
import { createPdfGestures } from "./pdf-gestures.js";

const PDFJS_VERSION = "4.10.38";
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
const listView = $("#list-view");
const viewerView = $("#viewer-view");
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
      (d) => `<li><button class="doc" data-id="${d.id}">
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
  btn.classList.add("busy");
  try {
    const url = await getDownloadUrl(doc.id);
    await openPdf({ url, name: doc.filename });
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
    const url = await getDownloadUrl(id);
    showMessage("");
    await openPdf({ url, name });
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

async function openPdf({ url, data, name }) {
  listView.hidden = true;
  viewerView.hidden = false;
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
    await renderPage();
    const { default: Panzoom } = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.6.0/dist/panzoom.es.js");
    gestures = createPdfGestures(canvas, stageEl, Panzoom, (scale) => renderPage(false, scale), (scale) => {
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
  gestures?.destroy();
  gestures = null;
  renderVersion++;
  renderTask?.cancel();
  viewerView.hidden = true;
  listView.hidden = false;
  frame.removeAttribute("src");
};
window.addEventListener("resize", () => !viewerView.hidden && renderPage());

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
