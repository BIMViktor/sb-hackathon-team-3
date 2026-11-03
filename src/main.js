/**
 * Hackathon UI. Change this file and src/style.css.
 * Connection lives in src/streambim.js — keep using `client`.
 */

import { objects } from "./mock-data.js";
import { connectWidget, sendToParent } from "./streambim.js";
import "./style.css";

const teamName = import.meta.env.VITE_TEAM_NAME || "Hackathon";
document.title = teamName;
document.querySelector("h1").textContent = teamName;

const statusEl = document.querySelector("#status");
const metaEl = document.querySelector("#meta");
const cameraEl = document.querySelector("#camera");
const floorsEl = document.querySelector("#floors");
const effectEl = document.querySelector("#effect");
const logEl = document.querySelector("#log");
const simulatorEl = document.querySelector("#simulator");
const chipsEl = document.querySelector("#object-chips");
const guidEl = document.querySelector("#guid");

const lines = [];
let client = null;
let simFloorIndex = 0;

const modeLabel = {
  mock: "Mock-läge",
  live: "Live i StreamBIM",
  error: "Anslutning misslyckades",
};

function log(line) {
  const time = new Date().toLocaleTimeString("sv-SE", { hour12: false });
  lines.unshift(`[${time}] ${line}`);
  logEl.textContent = lines.slice(0, 40).join("\n");
}

function explain(error) {
  if (!error) return "okänt fel";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error.code === "string") {
    return error.detail ? `${error.code}: ${JSON.stringify(error.detail)}` : error.code;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function format(value) {
  if (value == null) return "klart";
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return String(value);
  }
}

function currentGuid() {
  const guid = guidEl.value.trim();
  if (!guid) throw new Error("Fyll i ett GUID.");
  return guid;
}

function showEffect(text, color) {
  effectEl.textContent = text;
  effectEl.style.borderLeftColor = color ? `#${color.replace(/^#/, "")}` : "transparent";
}

async function run(label, action) {
  if (!client) {
    log("Inte ansluten ännu.");
    return;
  }
  if (client.mode === "error") {
    log(client.reason);
    return;
  }
  try {
    const result = await action();
    log(result === undefined ? label : `${label}: ${format(result)}`);
  } catch (error) {
    log(`${label} misslyckades: ${explain(error)}`);
  }
}

function onClick(selector, label, action) {
  document.querySelector(selector).addEventListener("click", () => {
    run(label, action);
  });
}

function renderChips() {
  chipsEl.replaceChildren();
  for (const object of objects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = object.name;
    button.addEventListener("click", () => {
      guidEl.value = object.guid;
      client?.simulate?.pick(object.guid);
    });
    chipsEl.append(button);
  }
}

onClick("#btn-floors", "Våningar", async () => {
  const floors = await client.getFloors();
  floorsEl.replaceChildren();
  for (const floor of floors) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "floor";
    button.textContent = `${floor.name} · ${floor.elevation} m`;
    button.addEventListener("click", () => {
      run(`Gå till ${floor.name}`, () => client.gotoFloor(floor.id));
    });
    item.append(button);
    floorsEl.append(item);
  }
  return `${floors.length} våningar`;
});

onClick("#btn-info", "Objektinfo", async () => client.getObjectInfo(currentGuid()));

onClick("#btn-highlight", "Markera", async () => {
  const guid = currentGuid();
  const result = await client.highlightObject(guid);
  showEffect(`Markerat ${guid}`);
  return result;
});

onClick("#btn-goto", "Gå till objekt", async () => {
  const guid = currentGuid();
  const result = await client.gotoObject(guid);
  showEffect(`Kamera mot ${guid}`);
  return result;
});

onClick("#btn-color", "Färglägg", async () => {
  const guid = currentGuid();
  const color = "0B6E4F";
  const result = await client.colorCodeObjects({ [guid]: color });
  showEffect(`Färglade ${guid}`, color);
  return result;
});

onClick("#btn-search", "Sök dörrar", async () => client.findObjects({ key: "type", value: "Door", limit: 20 }));

onClick("#btn-clear", "Rensa", async () => {
  const result = await client.deHighlightAllObjects();
  showEffect("Markering rensad");
  return result;
});

onClick("#btn-ping", "postMessage", async () => {
  const message = sendToParent("widget:hello", { text: "Hej från widgeten" });
  if (client.mode === "mock") {
    return "skickade widget:hello (ingen StreamBIM-förälder i mock-läge)";
  }
  return `skickade ${message.type} till föräldern`;
});

document.querySelector("#btn-sim-floor").addEventListener("click", async () => {
  if (!client?.simulate) return;
  try {
    const floors = await client.getFloors();
    const floor = floors[simFloorIndex % floors.length];
    simFloorIndex += 1;
    client.simulate.floor(floor.id);
  } catch (error) {
    log(explain(error));
  }
});

document.querySelector("#btn-sim-camera").addEventListener("click", () => {
  if (!client?.simulate) return;
  client.simulate.camera();
  log("Simulerade kameraflytt.");
});

renderChips();

const buttons = [...document.querySelectorAll("button")];
for (const button of buttons) button.disabled = true;

loadWidgetApi()
  .then(() =>
    connectWidget({
      onPickedObject(result) {
        const guid = result?.guid || "okänt";
        const name = result?.name ? ` (${result.name})` : "";
        if (result?.guid) guidEl.value = result.guid;
        log(`Klick i modellen: ${guid}${name}`);
      },
      onFloorChanged(floorId) {
        log(`Våning bytt: ${floorId || "okänd"}`);
      },
      onSpacesChanged(guids) {
        log(`Rum ändrades (${guids.length}).`);
      },
      onCameraChanged(state) {
        const position = Array.isArray(state?.position)
          ? state.position.map((value) => Number(value).toFixed(1)).join(", ")
          : "";
        cameraEl.textContent = position ? `Kamera: ${position}` : "Kamera uppdaterad";
      },
    })
  )
  .then(async (connected) => {
    client = connected;
    statusEl.dataset.mode = connected.mode;
    statusEl.textContent = modeLabel[connected.mode] ?? connected.mode;
    simulatorEl.hidden = connected.mode !== "mock";
    for (const button of buttons) button.disabled = connected.mode === "error";

    if (connected.mode === "error") {
      log(connected.reason);
      return;
    }

    log(connected.mode === "live" ? "Ansluten till StreamBIM." : "Öppnad utanför StreamBIM. Mock-data är aktiv.");

    try {
      const [projectId, email] = await Promise.all([connected.getProjectId(), connected.getUserEmail()]);
      metaEl.textContent = `${projectId} · ${email}`;
    } catch (error) {
      log(`Projektinfo misslyckades: ${explain(error)}`);
    }
  })
  .catch((error) => {
    statusEl.dataset.mode = "error";
    statusEl.textContent = modeLabel.error;
    simulatorEl.hidden = true;
    for (const button of buttons) button.disabled = true;
    log(explain(error));
  });

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
