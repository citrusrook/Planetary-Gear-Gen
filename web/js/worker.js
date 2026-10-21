import { resolve, build } from "./engine.js";

self.onmessage = (ev) => {
  const { id, type, p, lock, notes } = ev.data;
  try {
    if (type === "solve") {
      self.postMessage({ id, ok: true, result: resolve(p, lock) });
    } else if (type === "build") {
      const r = build(p, notes);
      const transfer = [];
      if (!r.fatal) for (const pt of r.parts) transfer.push(pt.body.pos.buffer, pt.body.idx.buffer);
      self.postMessage({ id, ok: true, result: r }, transfer);
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
};
