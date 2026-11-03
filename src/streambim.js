/**
 * StreamBIM connection for the hackathon starter.
 *
 * Live (inside StreamBIM):
 *   streambim-widget-api.min.js talks to the parent viewer with Penpal,
 *   which is postMessage under the hood. After connectToParent(), call
 *   StreamBIM.API — do not invent a second command protocol.
 *
 * Mock (localhost, or any top-level window):
 *   The same client methods return fake BIM data. Simulator buttons post
 *   a local message so the listener path is the one you can extend.
 *
 * Safe methods on the returned client:
 *   getProjectId, getUserEmail, getFloors, getObjectInfo, findObjects,
 *   highlightObject, deHighlightAllObjects, gotoObject, gotoFloor,
 *   colorCodeObjects
 * Live only: client.api is the full StreamBIM.API. It is null in mock mode.
 * colorCodeObjects takes hex colors WITHOUT a leading #.
 * Do not log tokens, and do not call setAuthToken.
 */

import { floors, objects, project } from "./mock-data.js";

const INCOMING = "streambim-hackathon";
const OUTGOING = "streambim-widget";
const CONNECT_TIMEOUT_MS = 8000;

export function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Custom widget → parent message. StreamBIM ignores unknown types; viewer commands go through the client. */
export function sendToParent(type, payload) {
  const message = { source: OUTGOING, type, payload };
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
  return message;
}

/**
 * @param {object} handlers
 * @param {(result: { guid?: string, name?: string, point?: number[] }) => void} [handlers.onPickedObject]
 * @param {(floorId: string) => void} [handlers.onFloorChanged]
 * @param {(guids: string[]) => void} [handlers.onSpacesChanged]
 * @param {(state: object) => void} [handlers.onCameraChanged]
 */
export async function connectWidget(handlers = {}) {
  if (isEmbedded()) {
    if (!window.StreamBIM?.connectToParent) {
      return failedClient("Widget-API-skriptet laddade inte.");
    }
    const live = await connectLive(handlers);
    if (live) return live;
    return failedClient("Kunde inte ansluta till StreamBIM inom 8 sekunder.");
  }
  return connectMock(handlers);
}

function connectLive(handlers) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), CONNECT_TIMEOUT_MS);

    try {
      window.StreamBIM
        .connectToParent(window.parent, {
          pickedObject: (result) => handlers.onPickedObject?.(result ?? {}),
          floorChanged: (floorId) => handlers.onFloorChanged?.(String(floorId ?? "")),
          spacesChanged: (guids) => handlers.onSpacesChanged?.(Array.isArray(guids) ? guids : []),
          cameraChanged: (state) => handlers.onCameraChanged?.(state ?? {}),
        })
        .then(() => {
          const api = window.StreamBIM.API;
          finish(api ? wrapLive(api) : null);
        })
        .catch(() => finish(null));
    } catch {
      finish(null);
    }
  });
}

function wrapLive(api) {
  return {
    mode: "live",
    reason: "",
    api,
    simulate: null,
    getProjectId: () => api.getProjectId(),
    getUserEmail: () => api.getUserEmail(),
    getFloors: () => api.getFloors(),
    getObjectInfo: (guid) => api.getObjectInfo(guid),
    findObjects: (query) => api.findObjects(query),
    highlightObject: (guid) => api.highlightObject(guid),
    deHighlightAllObjects: () => api.deHighlightAllObjects(),
    gotoObject: (guid) => api.gotoObject(guid),
    gotoFloor: (floorId) => api.gotoFloor(floorId),
    colorCodeObjects: (map) => api.colorCodeObjects(map),
  };
}

function connectMock(handlers) {
  const onMessage = (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== INCOMING) return;
    if (data.type === "pickedObject") handlers.onPickedObject?.(data.payload ?? {});
    if (data.type === "floorChanged") handlers.onFloorChanged?.(String(data.payload ?? ""));
    if (data.type === "spacesChanged") {
      handlers.onSpacesChanged?.(Array.isArray(data.payload) ? data.payload : []);
    }
    if (data.type === "cameraChanged") handlers.onCameraChanged?.(data.payload ?? {});
  };
  window.addEventListener("message", onMessage);

  const emit = (type, payload) => {
    window.postMessage({ source: INCOMING, type, payload }, window.location.origin);
  };

  return {
    mode: "mock",
    reason: "",
    api: null,
    simulate: {
      pick(guid) {
        const object = objects.find((item) => item.guid === guid) ?? objects[0];
        emit("pickedObject", { guid: object.guid, name: object.name, point: object.point });
      },
      floor(floorId) {
        emit("floorChanged", floorId);
      },
      camera() {
        emit("cameraChanged", { position: [12.5, 8.2, 14], target: [4, 1.2, 0], up: [0, 1, 0] });
      },
    },
    async getProjectId() {
      return project.id;
    },
    async getUserEmail() {
      return project.userEmail;
    },
    async getFloors() {
      return floors.map((floor) => ({ ...floor }));
    },
    async getObjectInfo(guid) {
      const object = objects.find((item) => item.guid === guid);
      if (!object) throw new Error(`Hittade inte ${guid} i mock-modellen.`);
      const floor = floors.find((item) => item.id === object.floorId);
      return {
        guid: object.guid,
        name: object.name,
        type: object.type,
        floor: floor?.name ?? object.floorId,
        props: { ...object.props },
      };
    },
    async findObjects(query) {
      const key = String(query?.key ?? "").toLowerCase();
      const value = String(query?.value ?? "").toLowerCase();
      const limit = Number(query?.limit ?? 20);
      return objects
        .filter((object) => matchesQuery(object, key, value))
        .slice(0, limit)
        .map((object) => object.guid);
    },
    async highlightObject(guid) {
      requireObject(guid);
      return { highlighted: guid };
    },
    async deHighlightAllObjects() {
      return { cleared: true };
    },
    async gotoObject(guid) {
      const object = requireObject(guid);
      return { goto: object.guid, point: object.point };
    },
    async gotoFloor(floorId) {
      const floor = floors.find((item) => item.id === floorId);
      if (!floor) throw new Error(`Hittade inte våning ${floorId}.`);
      return { floorId: floor.id, name: floor.name };
    },
    async colorCodeObjects(map) {
      if (!map || typeof map !== "object") throw new Error("colorCodeObjects vill ha en map av guid → hex.");
      return { colored: { ...map } };
    },
  };
}

function failedClient(reason) {
  const fail = async () => {
    throw new Error(reason);
  };
  return {
    mode: "error",
    reason,
    api: null,
    simulate: null,
    getProjectId: fail,
    getUserEmail: fail,
    getFloors: fail,
    getObjectInfo: fail,
    findObjects: fail,
    highlightObject: fail,
    deHighlightAllObjects: fail,
    gotoObject: fail,
    gotoFloor: fail,
    colorCodeObjects: fail,
  };
}

function requireObject(guid) {
  const object = objects.find((item) => item.guid === guid);
  if (!object) throw new Error(`Hittade inte ${guid} i mock-modellen.`);
  return object;
}

function matchesQuery(object, key, value) {
  if (!value) return true;
  if (!key || key === "type" || key === "ifcclass") {
    return object.type.toLowerCase().includes(value);
  }
  if (key === "name") return object.name.toLowerCase().includes(value);
  return String(propValue(object, key) ?? "").toLowerCase().includes(value);
}

function propValue(object, key) {
  if (object.props[key] != null) return object.props[key];
  const match = Object.keys(object.props).find((name) => name.toLowerCase() === key);
  return match ? object.props[match] : undefined;
}
