// src/lib/streambim-markup.ts
var GROUP = "Team3_PDF_Markup";
var SERVER_PROPS = ["Global Id", "@Building Storey", "@Group Layer", "@Document Id", "@Building Id", "Timestamp", "groups", "BaseType", "uri"];
var SERVER_GROUPS = ["Location", "Geometry", "Custom"];
function createStreambimMarkupStore(api, projectId, buildingId, documentId, revision) {
  const sameRevision = (stored) => !revision || (stored === undefined ? revision.legacy : Number(stored)) === revision.current;
  const base = `/project-${encodeURIComponent(projectId)}/api/v1/v2/ifc-objects`;
  const url = (id) => `${base}/${encodeURIComponent(id)}?building=${encodeURIComponent(buildingId)}&_=${Date.now()}`;
  const records = new Map;
  const pending = new Map;
  const fingerprints = new Map;
  const fingerprint = (item) => JSON.stringify([item.id, item.page, item.tool, item.color, item.width, item.opacity, item.points, Boolean(item.deleted), item.layerId ?? "layer-1", item.name ?? ""]);
  const get = async (id) => JSON.parse(await api.makeApiRequest({ url: url(id), method: "GET" })).data;
  const parse = (record) => {
    const raw = record.attributes.groups?.find((g) => g.label === GROUP)?.content.properties.find((p) => p.key === "Payload")?.value;
    if (typeof raw !== "string")
      return null;
    try {
      const payload = JSON.parse(raw);
      if (payload.version !== 1 || String(payload.documentId) !== documentId || !sameRevision(payload.revision) || !Array.isArray(payload.markup?.points) || typeof payload.markup?.id !== "string")
        return null;
      const m = payload.markup;
      if (!Number.isInteger(m.page) || m.page < 1 || !["highlight", "pen", "cloud", "rectangle", "square", "layer"].includes(m.tool) || !["red", "yellow", "green", "blue", "black"].includes(m.color) || !Number.isFinite(m.width) || !Number.isFinite(m.opacity) || !m.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
        return null;
      if (m.tool === "layer" && typeof m.name !== "string")
        return null;
      return payload.markup;
    } catch {
      return null;
    }
  };
  return {
    async load() {
      let ids;
      try {
        ids = await api.findObjects({ key: "@kind", value: "Annotation", limit: 1e4 });
      } catch (e) {
        const unknown = e instanceof Error ? /unknown/i.test(e.message) : typeof e === "object" && e !== null && ("code" in e) && e.code === "unknown";
        if (!unknown)
          throw e;
        ids = await api.findObjects({ key: "@kind", value: "Annotation", limit: 1e4 });
      }
      if (ids.length >= 1e4)
        throw new Error("För många annoteringsobjekt · hela listan kunde inte läsas");
      ids = [...new Set([...ids, ...records.values()])];
      const result = [];
      for (let start = 0;start < ids.length; start += 8) {
        const batch = await Promise.all(ids.slice(start, start + 8).map(get));
        for (const record of batch) {
          const item = parse(record);
          if (item) {
            records.set(item.id, record.id);
            if (!pending.has(item.id))
              fingerprints.set(item.id, fingerprint(item));
            result.push(item);
          }
        }
      }
      return result;
    },
    save(item) {
      const snapshot = JSON.parse(JSON.stringify(item));
      const operation = (pending.get(item.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
        let id = records.get(item.id);
        if (!id) {
          const camera = await api.getCameraState();
          id = await api.createObject({ center: camera.position, name: `PDF ${documentId}${revision ? ` rev ${revision.current}` : ""} · ${item.tool} · ${item.id}` });
          records.set(item.id, id);
        }
        const current = await get(id), a = current.attributes;
        if (a.layer)
          throw new Error("Kan inte ändra modellobjekt");
        const previous = parse(current), expected = fingerprints.get(item.id);
        if (previous && expected && fingerprint(previous) !== expected && fingerprint(previous) !== fingerprint(snapshot))
          throw new Error("Annoteringen har ändrats av en annan användare. Din ändring är inte sparad");
        const groups = (a.groups ?? []).filter((g) => !SERVER_GROUPS.includes(g.label) && g.label !== GROUP).map((g) => ({ label: g.label, content: { properties: g.content.properties.map((p) => ({ ...p, value: p.valueType === "bool" ? p.value === "true" : p.valueType === "float8" || p.valueType === "int64" ? Number(p.value) : p.value })) } }));
        const payload = JSON.stringify({ version: 1, documentId, ...revision ? { revision: revision.current } : {}, markup: snapshot });
        groups.push({ label: GROUP, content: { properties: [{ key: "Payload", value: payload, valueType: "str", measure: "", unit: "", valueItem: "" }] } });
        const body = { data: { id, type: "ifc-objects", attributes: { layer: null, properties: Object.fromEntries(Object.entries(a.properties).filter(([key]) => !SERVER_PROPS.includes(key))), groups, center: a.center, bbox: a.bbox, boundary: a.boundary }, relationships: { building: current.relationships["building"], floors: current.relationships["floors"] } } };
        let writeError;
        try {
          await api.makeApiRequest({ url: url(id), method: "PATCH", body });
        } catch (e) {
          writeError = e;
        }
        const readBack = await get(id);
        const stored = parse(readBack);
        if (!stored || fingerprint(stored) !== fingerprint(snapshot)) {
          if (writeError)
            throw writeError;
          const group = readBack.attributes.groups?.find((g) => g.label === GROUP);
          const property = group?.content.properties.find((p) => p.key === "Payload");
          let reason;
          if (!group)
            reason = "StreamBIM läste tillbaka objektet utan annoteringsgruppen";
          else if (typeof property?.value !== "string")
            reason = "StreamBIM läste tillbaka objektet utan annoteringsdata";
          else {
            try {
              const payload = JSON.parse(property.value);
              if (payload.version !== 1)
                reason = "StreamBIM returnerade ett annat annoteringsformat";
              else if (String(payload.documentId) !== documentId || !sameRevision(payload.revision))
                reason = "StreamBIM returnerade data för en annan PDF eller revision";
              else if (!stored)
                reason = "StreamBIM returnerade ogiltiga annoteringsdata";
              else
                reason = "StreamBIM läste tillbaka andra värden än de som skickades";
            } catch {
              reason = "StreamBIM returnerade oläsbara annoteringsdata";
            }
          }
          console.warn("[pdf-markup] Verification failed", { objectId: id, reason, hasGroup: Boolean(group), payloadLength: typeof property?.value === "string" ? property.value.length : 0 });
          throw new Error(`Annoteringen kunde inte verifieras i StreamBIM: ${reason} (objekt ${id}). Noteringen är kvar här men inte bekräftat sparad`);
        }
        fingerprints.set(item.id, fingerprint(stored));
      });
      pending.set(item.id, operation);
      const cleanup = () => {
        if (pending.get(item.id) === operation)
          pending.delete(item.id);
      };
      operation.then(cleanup, cleanup);
      return operation;
    }
  };
}
export {
  createStreambimMarkupStore
};
