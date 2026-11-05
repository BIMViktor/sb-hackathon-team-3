const GROUP = "Team3_PDF_Markup";
const SERVER_PROPS = ['Global Id', '@Building Storey', '@Group Layer', '@Document Id', '@Building Id', 'Timestamp', 'groups', 'BaseType', 'uri'];
const SERVER_GROUPS = ['Location', 'Geometry', 'Custom'];
export function createStreambimMarkupStore(api, projectId, buildingId, documentId) {
    const base = `/project-${encodeURIComponent(projectId)}/api/v1/v2/ifc-objects`;
    const url = (id) => `${base}/${encodeURIComponent(id)}?building=${encodeURIComponent(buildingId)}&_=${Date.now()}`;
    const records = new Map();
    const pending = new Map();
    const fingerprints = new Map();
    const fingerprint = (item) => JSON.stringify([item.id, item.page, item.tool, item.color, item.width, item.opacity, item.points, Boolean(item.deleted)]);
    const get = async (id) => JSON.parse(await api.makeApiRequest({ url: url(id), method: "GET" })).data;
    const parse = (record) => {
        const raw = record.attributes.groups?.find(g => g.label === GROUP)?.content.properties.find(p => p.key === "Payload")?.value;
        if (typeof raw !== "string")
            return null;
        try {
            const payload = JSON.parse(raw);
            if (payload.version !== 1 || String(payload.documentId) !== documentId || !Array.isArray(payload.markup?.points) || typeof payload.markup?.id !== "string")
                return null;
            const m = payload.markup;
            if (!Number.isInteger(m.page) || m.page < 1 || !["highlight", "pen", "cloud", "rectangle", "square"].includes(m.tool) || !["red", "yellow", "green", "blue", "black"].includes(m.color) || !Number.isFinite(m.width) || !Number.isFinite(m.opacity) || !m.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
                return null;
            return payload.markup;
        }
        catch {
            return null;
        }
    };
    return {
        async load() {
            let ids;
            try {
                ids = await api.findObjects({ key: "@kind", value: "Annotation", limit: 10000 });
            }
            catch (e) {
                const unknown = e instanceof Error ? /unknown/i.test(e.message) : typeof e === "object" && e !== null && "code" in e && e.code === "unknown";
                if (!unknown)
                    throw e;
                ids = await api.findObjects({ key: "@kind", value: "Annotation", limit: 10000 });
            }
            if (ids.length >= 10000)
                throw new Error("För många annoteringsobjekt · hela listan kunde inte läsas");
            ids = [...new Set([...ids, ...records.values()])];
            const result = [];
            for (let start = 0; start < ids.length; start += 8) {
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
            const operation = (pending.get(item.id) ?? Promise.resolve()).catch(() => { }).then(async () => {
                let id = records.get(item.id);
                if (!id) {
                    const camera = await api.getCameraState();
                    id = await api.createObject({ center: camera.position, name: `PDF ${documentId} · ${item.tool} · ${item.id}` });
                    records.set(item.id, id);
                }
                const current = await get(id), a = current.attributes;
                if (a.layer)
                    throw new Error("Kan inte ändra modellobjekt");
                const previous = parse(current), expected = fingerprints.get(item.id);
                if (previous && expected && fingerprint(previous) !== expected && fingerprint(previous) !== fingerprint(snapshot))
                    throw new Error("Annoteringen har ändrats av en annan användare. Din ändring är inte sparad");
                const groups = (a.groups ?? []).filter(g => !SERVER_GROUPS.includes(g.label) && g.label !== GROUP).map(g => ({ label: g.label, content: { properties: g.content.properties.map(p => ({ ...p, value: p.valueType === "bool" ? p.value === "true" : p.valueType === "float8" || p.valueType === "int64" ? Number(p.value) : p.value })) } }));
                const payload = JSON.stringify({ version: 1, documentId, markup: snapshot });
                groups.push({ label: GROUP, content: { properties: [{ key: "Payload", value: payload, valueType: "str", measure: "", unit: "", valueItem: "" }] } });
                const body = { data: { id, type: "ifc-objects", attributes: { layer: null, properties: Object.fromEntries(Object.entries(a.properties).filter(([key]) => !SERVER_PROPS.includes(key))), groups, center: a.center, bbox: a.bbox, boundary: a.boundary }, relationships: { building: current.relationships["building"], floors: current.relationships["floors"] } } };
                let writeError;
                try {
                    await api.makeApiRequest({ url: url(id), method: "PATCH", body });
                }
                catch (e) {
                    writeError = e;
                }
                const stored = parse(await get(id));
                if (!stored || fingerprint(stored) !== fingerprint(snapshot))
                    throw writeError ?? new Error("Annoteringen kunde inte verifieras i StreamBIM");
                fingerprints.set(item.id, fingerprint(stored));
            });
            pending.set(item.id, operation);
            const cleanup = () => { if (pending.get(item.id) === operation)
                pending.delete(item.id); };
            void operation.then(cleanup, cleanup);
            return operation;
        },
    };
}
