export function createPdfGestures(canvas, stage, factory, onZoomSettled = () => {}, onZoomChange = () => {}) {
  const panzoom = factory(canvas, {
    canvas: true,
    minScale: 0.5,
    maxScale: 8,
    pinchAndPan: true,
    cursor: "grab",
    animate: false
  });
  let timer;
  const settle = () => {
    onZoomChange(panzoom.getScale());
    clearTimeout(timer);
    timer = setTimeout(() => onZoomSettled(panzoom.getScale()), 180);
  };
  const wheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
    panzoom.zoomToPoint(panzoom.getScale() * Math.exp(-delta * 0.0015), event, { animate: false });
  };
  const doubleClick = (event) => {
    event.preventDefault();
    if (panzoom.getScale() > 1.05)
      panzoom.reset();
    else
      panzoom.zoomToPoint(2, event);
  };
  const start = () => {
    stage.style.cursor = "grabbing";
  };
  const end = () => {
    stage.style.cursor = "grab";
    settle();
  };
  canvas.addEventListener("panzoomzoom", settle);
  canvas.addEventListener("panzoomstart", start);
  canvas.addEventListener("panzoomend", end);
  stage.addEventListener("wheel", wheel, { passive: false });
  stage.addEventListener("dblclick", doubleClick);
  return {
    setEnabled(enabled) {
      panzoom.setOptions({ disablePan: !enabled, disableZoom: !enabled, cursor: enabled ? "grab" : "default" });
    },
    zoomBy(factor) {
      const rect = stage.getBoundingClientRect();
      panzoom.zoomToPoint(panzoom.getScale() * factor, {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      });
    },
    zoomTo(scale) {
      const rect = stage.getBoundingClientRect();
      panzoom.zoomToPoint(scale, { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
    },
    fitPage() {
      panzoom.reset({ animate: false });
      const scale = Math.min(1, (stage.clientHeight - 24) / canvas.offsetHeight);
      requestAnimationFrame(() => panzoom.zoom(scale, { animate: false, force: true }));
    },
    reset() {
      panzoom.reset({ animate: false });
    },
    getScale: panzoom.getScale,
    destroy() {
      clearTimeout(timer);
      canvas.removeEventListener("panzoomzoom", settle);
      canvas.removeEventListener("panzoomstart", start);
      canvas.removeEventListener("panzoomend", end);
      stage.removeEventListener("wheel", wheel);
      stage.removeEventListener("dblclick", doubleClick);
      panzoom.destroy();
      panzoom.resetStyle();
      stage.style.cursor = "";
      stage.style.touchAction = "";
    }
  };
}
