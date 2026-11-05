// src/lib/pdf-markup.ts
var DEFAULT_LAYER = "layer-1";
function markupLayerId(item) {
  return item.layerId ?? DEFAULT_LAYER;
}
async function requestMarkupClose() {
  const waits = [];
  const allowed = window.dispatchEvent(new CustomEvent("pdf-markup-before-close", {
    cancelable: true,
    detail: { waitUntil: (promise) => waits.push(promise) }
  }));
  return allowed && (await Promise.all(waits)).every(Boolean);
}
function markupBounds(points, square = false) {
  const first = points[0] ?? [0, 0];
  const last = points[points.length - 1] ?? first;
  const x1 = first[0] ?? 0, y1 = first[1] ?? 0;
  let x2 = last[0] ?? x1, y2 = last[1] ?? y1;
  if (square) {
    const side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    x2 = x1 + Math.sign(x2 - x1 || 1) * side;
    y2 = y1 + Math.sign(y2 - y1 || 1) * side;
  }
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
function cloudPath(points) {
  const b = markupBounds(points);
  const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height], [b.x, b.y]];
  let path = `M ${b.x} ${b.y}`;
  for (let i = 0;i < 4; i++) {
    const a = corners[i], z = corners[i + 1];
    if (!a || !z)
      continue;
    const ax = a[0] ?? 0, ay = a[1] ?? 0, zx = z[0] ?? 0, zy = z[1] ?? 0;
    const length = Math.hypot(zx - ax, zy - ay), count = Math.max(1, Math.ceil(length / 25));
    for (let j = 1;j <= count; j++) {
      const px = ax + (zx - ax) * (j - 0.5) / count, py = ay + (zy - ay) * (j - 0.5) / count;
      const bump = Math.min(10, length / count * 0.5);
      path += ` Q ${px + (zy - ay) / Math.max(1, length) * bump} ${py - (zx - ax) / Math.max(1, length) * bump} ${ax + (zx - ax) * j / count} ${ay + (zy - ay) * j / count}`;
    }
  }
  return path + " Z";
}
function createMarkupLayer(surface, store, report, selectChanged = () => {}, layersChanged = () => {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("markup-layer");
  surface.append(svg);
  let page = 1, tool = "pan", color = "red", width = 3, opacity = 1;
  let items = [], draft, selected;
  let moving;
  let disposed = false, dimensions = { width: 1000, height: 1000 }, pointer;
  const dirty = new Set;
  const saving = new Set;
  let activeLayer = DEFAULT_LAYER;
  const hiddenLayers = new Set;
  const defaultLayer = { id: DEFAULT_LAYER, page: 1, tool: "layer", name: "Lager 1", color: "red", width: 3, opacity: 1, points: [] };
  const layerRecords = () => items.some((item) => item.id === DEFAULT_LAYER && item.tool === "layer") ? items.filter((item) => item.tool === "layer") : [defaultLayer, ...items.filter((item) => item.tool === "layer")];
  const layers = () => layerRecords().filter((item) => !item.deleted);
  const notifyLayers = () => {
    const available = layers();
    if (!available.some((item) => item.id === activeLayer)) {
      activeLayer = available[0]?.id ?? "";
      selected = undefined;
      selectChanged(false);
    }
    layersChanged({ active: activeLayer, layers: available.map((item) => ({ id: item.id, name: item.name ?? "Lager", visible: !hiddenLayers.has(item.id), count: items.filter((m) => m.tool !== "layer" && !m.deleted && markupLayerId(m) === item.id).length })) });
  };
  const versions = new Map;
  let loading = false;
  const errorText = (e) => e instanceof Error ? e.message : typeof e === "object" && e !== null && ("code" in e) ? String(e.code) : "Okänt fel";
  const point = (e) => {
    const rect = svg.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * dimensions.width, Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) * dimensions.height];
  };
  const normalized = (p) => [(p[0] ?? 0) / dimensions.width, (p[1] ?? 0) / dimensions.height];
  const draw = () => {
    notifyLayers();
    const visible = new Set(layers().filter((item) => !hiddenLayers.has(item.id)).map((item) => item.id));
    svg.replaceChildren();
    for (const item of [...items.filter((m) => m.tool !== "layer" && m.page === page && !m.deleted && visible.has(markupLayerId(m))), ...draft ? [draft] : []]) {
      const points = item.points.map((p) => [(p[0] ?? 0) * dimensions.width, (p[1] ?? 0) * dimensions.height]);
      const shape = document.createElementNS(ns, item.tool === "rectangle" || item.tool === "square" ? "rect" : "path");
      shape.dataset["id"] = item.id;
      shape.setAttribute("stroke", `var(--markup-${item.color})`);
      shape.setAttribute("stroke-width", String(item.width));
      shape.setAttribute("stroke-linecap", "round");
      shape.setAttribute("stroke-linejoin", "round");
      shape.setAttribute("opacity", String(item.opacity));
      shape.setAttribute("fill", "none");
      if (item.tool === "rectangle" || item.tool === "square") {
        const b = markupBounds(points, item.tool === "square");
        for (const [key, value] of Object.entries(b))
          shape.setAttribute(key, String(value));
      } else
        shape.setAttribute("d", item.tool === "cloud" ? cloudPath(points) : points.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" "));
      if (item.tool === "highlight")
        shape.classList.add("markup-highlight");
      if (item.id === selected)
        shape.classList.add("markup-selected");
      svg.append(shape);
    }
  };
  const persist = (item) => {
    const version = (versions.get(item.id) ?? 0) + 1;
    versions.set(item.id, version);
    dirty.add(item.id);
    if (!store) {
      report("Ej sparat · fristående läge");
      return Promise.resolve();
    }
    report("Sparar…");
    const operation = (async () => {
      try {
        await store.save(item);
        if (versions.get(item.id) === version)
          dirty.delete(item.id);
        if (!disposed)
          report(dirty.size ? "Osparade ändringar" : "Sparat i projektet");
      } catch (e) {
        if (!disposed)
          report(`Kunde inte spara: ${errorText(e)} · försök igen`);
      }
    })();
    saving.add(operation);
    operation.then(() => saving.delete(operation));
    return operation;
  };
  const reload = async (silent = false) => {
    if (!store || disposed || loading || draft || moving)
      return;
    if (dirty.size) {
      if (!silent)
        report("Osparade ändringar · spara först");
      return;
    }
    loading = true;
    const atStart = new Map(versions);
    if (!silent)
      report("Laddar annoteringar…");
    try {
      const loaded = await store.load();
      if (!disposed) {
        const changed = items.filter((item) => dirty.has(item.id) || (versions.get(item.id) ?? 0) !== (atStart.get(item.id) ?? 0));
        const keep = new Set(changed.map((item) => item.id));
        items = [...loaded.filter((item) => !keep.has(item.id)), ...changed];
        if (selected && !items.some((item) => item.id === selected && !item.deleted)) {
          selected = undefined;
          selectChanged(false);
        }
        draw();
        if (!dirty.size)
          report("Delat i projektet");
      }
    } catch (e) {
      if (!disposed)
        report(`Kunde inte läsa annoteringar: ${errorText(e)}`);
    } finally {
      loading = false;
    }
  };
  const down = (e) => {
    if (tool === "pan" || e.button !== 0 || !activeLayer || hiddenLayers.has(activeLayer))
      return;
    e.preventDefault();
    e.stopPropagation();
    pointer = e.pointerId;
    svg.setPointerCapture(e.pointerId);
    if (tool === "select") {
      const id = e.target.dataset["id"];
      selected = items.some((item) => item.id === id && markupLayerId(item) === activeLayer) ? id : undefined;
      const item = items.find((m) => m.id === selected);
      moving = item ? { start: normalized(point(e)), points: item.points.map((p) => [...p]) } : undefined;
      selectChanged(Boolean(item));
      draw();
      return;
    }
    selected = undefined;
    selectChanged(false);
    draft = { id: crypto.randomUUID(), page, tool, layerId: activeLayer, color, width: tool === "highlight" ? width * 5 : width, opacity: tool === "highlight" ? Math.min(opacity, 0.4) : opacity, points: [normalized(point(e)), normalized(point(e))] };
    draw();
  };
  const move = (e) => {
    if (pointer !== e.pointerId)
      return;
    e.preventDefault();
    e.stopPropagation();
    const p = normalized(point(e));
    if (moving && selected) {
      const item = items.find((m) => m.id === selected);
      if (item)
        item.points = moving.points.map((v) => [(v[0] ?? 0) + (p[0] ?? 0) - (moving?.start[0] ?? 0), (v[1] ?? 0) + (p[1] ?? 0) - (moving?.start[1] ?? 0)]);
    } else if (draft) {
      if (draft.tool === "pen" || draft.tool === "highlight")
        draft.points.push(p);
      else
        draft.points[1] = p;
    }
    draw();
  };
  const up = (e) => {
    if (pointer !== e.pointerId)
      return;
    e.stopPropagation();
    pointer = undefined;
    if (draft) {
      const item = draft;
      items.push(item);
      draft = undefined;
      persist(item);
    } else if (moving && selected) {
      const item = items.find((m) => m.id === selected);
      if (item)
        persist(item);
    }
    moving = undefined;
    draw();
  };
  const cancel = () => {
    draft = undefined;
    moving = undefined;
    pointer = undefined;
    draw();
  };
  svg.addEventListener("pointerdown", down);
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", cancel);
  reload();
  notifyLayers();
  const timer = store ? window.setInterval(() => {
    if (document.visibilityState !== "hidden")
      reload(true);
  }, 15000) : undefined;
  const onFocus = () => {
    reload(true);
  };
  const waitForSave = async () => {
    if (draft || moving) {
      report("Avsluta annoteringen innan du byter PDF");
      return false;
    }
    if (!saving.size)
      for (const item of items.filter((item) => dirty.has(item.id)))
        persist(item);
    let timer;
    const settled = await Promise.race([
      (async () => {
        while (saving.size)
          await Promise.all([...saving]);
        return true;
      })(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 1e4);
      })
    ]);
    if (timer !== undefined)
      clearTimeout(timer);
    if (!settled) {
      report("Sparningen tar tid · PDF:en är kvar tills ändringarna sparats");
      return false;
    }
    return !dirty.size;
  };
  const beforeClose = (e) => {
    if (!store || !dirty.size && !draft && !moving)
      return;
    const detail = e.detail;
    if (detail?.waitUntil)
      detail.waitUntil(waitForSave());
    else {
      e.preventDefault();
      report("Osparade ändringar · vänta eller försök spara igen");
    }
  };
  const beforeUnload = (e) => {
    if (store && dirty.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("pdf-markup-before-close", beforeClose);
  window.addEventListener("beforeunload", beforeUnload);
  return {
    setPage(n, w, h) {
      if (page !== n) {
        selected = undefined;
        selectChanged(false);
      }
      page = n;
      dimensions = { width: 1000, height: 1000 * h / w };
      svg.setAttribute("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`);
      draw();
    },
    setTool(next) {
      tool = next;
      svg.style.pointerEvents = next === "pan" ? "none" : "auto";
    },
    setStyle(next) {
      color = next.color ?? color;
      width = next.width ?? width;
      opacity = next.opacity ?? opacity;
      const item = items.find((m) => m.id === selected);
      if (item) {
        Object.assign(item, next);
        draw();
        persist(item);
      }
    },
    removeSelected() {
      const item = items.find((m) => m.id === selected);
      if (item) {
        item.deleted = true;
        persist(item);
        selected = undefined;
        selectChanged(false);
        draw();
      }
    },
    retry() {
      Promise.all(items.filter((item) => dirty.has(item.id)).map(persist));
    },
    setActiveLayer(id) {
      if (layers().some((item) => item.id === id)) {
        cancel();
        activeLayer = id;
        selected = undefined;
        selectChanged(false);
        hiddenLayers.delete(id);
        draw();
      }
    },
    addLayer(name) {
      const number = Math.max(1, ...layerRecords().map((item) => Number(item.name?.match(/^Lager (\d+)$/)?.[1] ?? 0))) + 1;
      const item = { ...defaultLayer, id: crypto.randomUUID(), name: name?.trim() || `Lager ${number}` };
      items.push(item);
      activeLayer = item.id;
      selected = undefined;
      selectChanged(false);
      draw();
      persist(item);
    },
    removeLayer(id) {
      const item = layers().find((item) => item.id === id);
      if (!item)
        return;
      cancel();
      const deleted = { ...item, deleted: true };
      items = items.filter((m) => m.id !== id);
      items.push(deleted);
      draw();
      persist(deleted);
    },
    toggleLayer(id) {
      if (hiddenLayers.has(id))
        hiddenLayers.delete(id);
      else
        hiddenLayers.add(id);
      selected = undefined;
      selectChanged(false);
      draw();
    },
    reload,
    destroy() {
      disposed = true;
      if (timer !== undefined)
        window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pdf-markup-before-close", beforeClose);
      window.removeEventListener("beforeunload", beforeUnload);
      svg.remove();
    }
  };
}
export {
  cloudPath,
  createMarkupLayer,
  markupBounds,
  markupLayerId,
  requestMarkupClose
};
