/**
 * Hackathon UI. Change this file and src/style.css.
 * Connection lives in src/streambim.js — keep using the client it returns.
 */

import { objects } from "./mock-data.js";
import { connectWidget } from "./streambim.js";
import "./style.css";

const teamName = import.meta.env.VITE_TEAM_NAME || document.querySelector("h1").textContent;
document.title = teamName;
document.querySelector("h1").textContent = teamName;

const statusEl = document.querySelector("#status");
const emptyEl = document.querySelector("#empty");
const factsEl = document.querySelector("#facts");
const nameEl = document.querySelector("#name");
const typeEl = document.querySelector("#type");
const floorEl = document.querySelector("#floor");
const simulatorEl = document.querySelector("#simulator");
const chipsEl = document.querySelector("#object-chips");

const modeLabel = {
  mock: "Lokalt",
  live: "Live",
  error: "Ingen kontakt",
};

function dash(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "–";
}

function fromInfo(info) {
  const props = info && info.properties && typeof info.properties === "object" ? info.properties : {};
  const storey = props["@Building Storey"];
  const storeyName = storey && typeof storey === "object" ? storey.Name : storey;
  const floors = Array.isArray(info && info.floors) ? info.floors : [];
  const listed = floors
    .map((floor) => (floor && (floor.name || floor.Name)) || (typeof floor === "string" ? floor : ""))
    .find(Boolean);
  return {
    name: info && (info.name || props.Name || props["Long Name"]),
    type: info && (info.type || props["@kind"]),
    floor: info && (info.floor || storeyName || listed),
  };
}

async function mark(api, guid, shiftKey) {
  try {
    if (!shiftKey) await api.deHighlightAllObjects();
    await api.highlightObject(guid);
  } catch {
    /* The text still shows if the viewer rejects the id. */
  }
}

async function showPick(api, guid, shiftKey) {
  emptyEl.hidden = true;
  factsEl.hidden = false;
  nameEl.textContent = "…";
  typeEl.textContent = "…";
  floorEl.textContent = "…";
  const marked = mark(api, guid, shiftKey);
  try {
    const row = fromInfo(await api.getObjectInfo(guid));
    nameEl.textContent = dash(row.name);
    typeEl.textContent = dash(row.type);
    floorEl.textContent = dash(row.floor);
  } catch {
    nameEl.textContent = dash(guid);
    typeEl.textContent = "–";
    floorEl.textContent = "–";
  }
  await marked;
}

function renderChips(api) {
  chipsEl.replaceChildren();
  for (const object of objects) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = object.name;
    button.addEventListener("click", () => {
      for (const chip of chipsEl.querySelectorAll("button")) chip.classList.remove("on");
      button.classList.add("on");
      api.simulate?.pick(object.guid);
    });
    chipsEl.append(button);
  }
}

function loadWidgetApi() {
  if (window.StreamBIM?.connectToParent) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `${import.meta.env.BASE_URL}streambim-widget-api.min.js`;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.append(script);
  });
}

const ready = loadWidgetApi().then(() =>
  connectWidget({
    onPickedObject(result) {
      const guid = result && result.guid;
      if (!guid) return;
      ready.then((api) => showPick(api, guid, Boolean(result.shiftKey)));
    },
  }),
);

ready
  .then((api) => {
    statusEl.dataset.mode = api.mode;
    statusEl.textContent = modeLabel[api.mode] || api.mode;
    simulatorEl.hidden = api.mode !== "mock";
    if (api.mode === "mock") renderChips(api);
  })
  .catch(() => {
    statusEl.dataset.mode = "error";
    statusEl.textContent = modeLabel.error;
    simulatorEl.hidden = true;
  });
