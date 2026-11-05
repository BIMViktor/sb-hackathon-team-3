const GROUP = "Team3_PDF_Markup";
const SERVER_PROPS = ["Global Id", "@Building Storey", "@Group Layer", "@Document Id", "@Building Id", "Timestamp", "groups", "BaseType", "uri"];
const SERVER_GROUPS = ["Location", "Geometry", "Custom"];
export function createStreambimMarkupStore(api, projectId, buildingId, documentId) {
  const base = `/project-${encodeURIComponent(projectId)}/api/v1/v2/ifc-objects`;
  const url = (id) => `${base}/${encodeURIComponent(id)}?building=${encodeURIComponent(buildingId)}&_=${Date.now()}`;
  const records = new Map;
  const pending = new Map;
  const get = async (id) => JSON.parse(await api.makeApiRequest({ url: url(id), method: "GET" })).data;
  const parse = (record) => {
    const raw = record.attributes.groups?.find((g) => g.label === GROUP)?.content.properties.find((p) => p.key === "Payload")?.value;
    if (typeof raw !== "string")
      return null;
    try {
      const payload = JSON.parse(raw);
      if (payload.version !== 1 || String(payload.documentId) !== documentId || !Array.isArray(payload.markup?.points) || typeof payload.markup?.id !== "string")
        return null;
      return payload.markup;
    } catch {
      return null;
    }
  };
  return {
    async load() {
      const ids = await api.findObjects({ key: "@kind", value: "Annotation", limit: 1000 });
      if (ids.length === 1000)
        throw new Error("För många objekt för fullständig inläsning");
      const result = [];
      for (let start = 0;start < ids.length; start += 8) {
        const batch = await Promise.all(ids.slice(start, start + 8).map(get));
        for (const record of batch) {
          const item = parse(record);
          if (item) {
            records.set(item.id, record.id);
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
          id = await api.createObject({ center: camera.position, name: `PDF ${documentId} · ${item.tool} · ${item.id}` });
          records.set(item.id, id);
        }
        const current = await get(id), a = current.attributes;
        if (a.layer)
          throw new Error("Kan inte ändra modellobjekt");
        const groups = (a.groups ?? []).filter((g) => !SERVER_GROUPS.includes(g.label) && g.label !== GROUP).map((g) => ({ label: g.label, content: { properties: g.content.properties.map((p) => ({ ...p, value: p.valueType === "bool" ? p.value === "true" : p.valueType === "float8" || p.valueType === "int64" ? Number(p.value) : p.value })) } }));
        const payload = JSON.stringify({ version: 1, documentId, markup: snapshot });
        groups.push({ label: GROUP, content: { properties: [{ key: "Payload", value: payload, valueType: "str", measure: "", unit: "", valueItem: "" }] } });
        const body = { data: { id, type: "ifc-objects", attributes: { layer: null, properties: Object.fromEntries(Object.entries(a.properties).filter(([key]) => !SERVER_PROPS.includes(key))), groups, center: a.center, bbox: a.bbox, boundary: a.boundary }, relationships: { building: current.relationships["building"], floors: current.relationships["floors"] } } };
        let writeError;
        try {
          await api.makeApiRequest({ url: url(id), method: "PATCH", body });
        } catch (e) {
          writeError = e;
        }
        const stored = parse(await get(id));
        if (JSON.stringify(stored) !== JSON.stringify(snapshot))
          throw writeError ?? new Error("Annoteringen kunde inte verifieras");
      });
      pending.set(item.id, operation);
      return operation;
    }
  };
}
