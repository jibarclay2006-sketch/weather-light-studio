(() => {
  "use strict";

  const model = window.StudioModel;
  const preview = window.StudioPreview;
  const byId = id => document.getElementById(id);
  const on = (id, event, listener) => byId(id).addEventListener(event, listener);
  const grid = byId("pixel-grid");
  const timeline = byId("timeline");
  const duration = byId("duration");
  const title = byId("project-title");
  const canvas = byId("preview");
  const exportDialog = byId("export-dialog");
  const storageKey = "weather-light-studio.draft.v1";
  const swatches = [
    ["White", "#F4F4FF"], ["Sun", "#FFBE66"], ["Tangerine", "#F97D43"], ["Coral", "#FF566D"],
    ["Rose", "#F57BC3"], ["Orchid", "#BB82F8"], ["Indigo", "#716AF1"], ["Sky", "#5A9BFF"],
    ["Ice", "#54D5F2"], ["Teal", "#39C6B4"], ["Mint", "#78E5A1"], ["Lime", "#C4EC73"]
  ];
  const hints = {
    pencil: "Click or drag to draw.",
    eraser: "Click or drag to switch pixels off.",
    fill: "Fill touching cells of the same color.",
    picker: "Select a lit pixel to pick its color."
  };
  const history = [];
  const future = [];
  const cells = [];
  let project = loadDraft();
  let selected = 0;
  let focusCell = 0;
  let tool = "pencil";
  let color = swatches[1][1];
  let view = "device";
  let deviceReady = false;
  let stroke = null;
  let previewRequest = 0;
  let animationRequest = 0;
  let playing = false;
  let playbackIndex = 0;
  let playbackStart = 0;
  let frameEnds = [];
  let toastTimer = 0;
  let exporting = false;

  function loadDraft() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return model.parse(saved);
    } catch (error) {
      console.warn("Studio draft could not be read", error);
    }
    return model.examples[0].make();
  }

  function saveDraft() {
    const status = byId("save-state");
    try {
      localStorage.setItem(storageKey, model.serialize(project));
      status.textContent = "Saved on this browser";
      status.classList.remove("unsaved");
    } catch {
      status.textContent = "Export a copy to save";
      status.classList.add("unsaved");
    }
  }

  function notify(message, error = false) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.toggleAttribute("data-error", error);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 5500 : 3400);
  }

  function snapshot() {
    return { project: structuredClone(project), selected };
  }

  function remember(previous) {
    history.push(previous);
    if (history.length > 40) history.shift();
    future.length = 0;
  }

  function edit(change) {
    stop();
    remember(snapshot());
    change();
    render();
    saveDraft();
  }

  function restore(from, to) {
    if (from.length === 0) return;
    stop();
    to.push(snapshot());
    ({ project, selected } = from.pop());
    render(true);
    saveDraft();
  }

  function frame() {
    return project.frames[selected];
  }

  function selectFrame(index) {
    stop();
    selected = Math.max(0, Math.min(index, project.frames.length - 1));
    render(true);
  }

  function setTool(next) {
    tool = next;
    grid.dataset.tool = tool;
    byId("tool-hint").textContent = hints[tool];
    document.querySelectorAll("button[data-tool]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    });
  }

  function setColor(next) {
    color = model.normalizeColor(next);
    byId("custom-color").value = color;
    byId("current-color").textContent = color;
    document.querySelectorAll(".swatch").forEach(swatch => {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
    });
    if (tool === "eraser" || tool === "picker") setTool("pencil");
  }

  function buildGrid() {
    for (let row = 0; row < 8; row += 1) {
      const columnLabel = document.createElement("span");
      columnLabel.textContent = row + 1;
      byId("column-labels").append(columnLabel);
      byId("row-labels").append(columnLabel.cloneNode(true));
      const line = document.createElement("div");
      line.className = "pixel-row";
      line.setAttribute("role", "row");
      for (let column = 0; column < 8; column += 1) {
        const index = row * 8 + column;
        const pixel = document.createElement("button");
        pixel.className = "pixel";
        pixel.type = "button";
        pixel.dataset.index = index;
        pixel.setAttribute("role", "gridcell");
        pixel.tabIndex = index === focusCell ? 0 : -1;
        cells.push(pixel);
        line.append(pixel);
      }
      grid.append(line);
    }
  }

  function showPixels() {
    const ghost = byId("trace").checked ? project.frames[selected - 1]?.pixels : null;
    frame().pixels.forEach((value, index) => {
      const cell = cells[index];
      const trace = value === null ? ghost?.[index] : null;
      cell.toggleAttribute("data-lit", value !== null);
      cell.toggleAttribute("data-trace", Boolean(trace));
      if (value || trace) cell.style.setProperty("--pixel", value || trace);
      else cell.style.removeProperty("--pixel");
      cell.setAttribute("aria-label", `Row ${(index >> 3) + 1}, column ${(index % 8) + 1}, ${value || "off"}`);
    });
  }

  function thumbnail(element, pixels) {
    const ctx = element.getContext("2d");
    pixels.forEach((value, index) => {
      ctx.fillStyle = value || "#222c3b";
      ctx.fillRect(index % 8, index >> 3, 1, 1);
    });
  }

  function timelineCursor(scroll = false) {
    const cards = timeline.children;
    for (let i = 0; i < cards.length; i += 1) {
      cards[i].classList.toggle("is-selected", i === selected);
      cards[i].classList.toggle("is-playing", playing && i === playbackIndex);
      cards[i].setAttribute("aria-pressed", String(i === selected));
      cards[i].tabIndex = i === selected ? 0 : -1;
    }
    const card = cards[selected];
    if (scroll && card) {
      const edges = timeline.getBoundingClientRect();
      const tile = card.getBoundingClientRect();
      if (tile.left < edges.left) timeline.scrollLeft -= edges.left - tile.left + 5;
      if (tile.right > edges.right) timeline.scrollLeft += tile.right - edges.right + 5;
    }
  }

  function showTimeline(scroll) {
    const items = project.frames.map(({ pixels, duration: delay }, index) => {
      const card = document.createElement("button");
      card.className = "frame-card";
      card.type = "button";
      card.dataset.frame = index;
      card.setAttribute("aria-label", `Frame ${index + 1}, ${delay} milliseconds`);
      const thumb = document.createElement("canvas");
      thumb.width = thumb.height = 8;
      thumb.setAttribute("aria-hidden", "true");
      thumbnail(thumb, pixels);
      const info = document.createElement("span");
      const time = document.createElement("small");
      time.textContent = `${delay} ms`;
      info.append(String(index + 1), time);
      card.append(thumb, info);
      return card;
    });
    const focus = timeline.contains(document.activeElement);
    timeline.replaceChildren(...items);
    if (focus) items[selected].focus({ preventScroll: true });
    timelineCursor(scroll);
  }

  function showPreview() {
    const index = playing ? playbackIndex : selected;
    byId("preview-position").textContent = `Frame ${index + 1} / ${project.frames.length}`;
    if (!deviceReady && view === "device") return;
    preview.draw(canvas, project.frames[index].pixels, { mode: view });
  }

  function queuePreview() {
    if (previewRequest) return;
    previewRequest = requestAnimationFrame(() => {
      previewRequest = 0;
      showPreview();
    });
  }

  function render(scroll = false) {
    if (document.activeElement !== title) title.value = project.title;
    duration.value = frame().duration;
    const count = project.frames.length;
    const total = project.frames.reduce((sum, item) => sum + item.duration, 0);
    byId("frame-label").textContent = `Frame ${selected + 1} of ${count}`;
    byId("timeline-count").textContent = `${count} ${count === 1 ? "frame" : "frames"} · ${(total / 1000).toFixed(2)} s total`;
    byId("add-frame").disabled = byId("duplicate-frame").disabled = count >= model.MAX_FRAMES;
    byId("delete-frame").disabled = count === 1;
    byId("move-left").disabled = selected === 0;
    byId("move-right").disabled = selected === count - 1;
    byId("undo").disabled = history.length === 0;
    byId("redo").disabled = future.length === 0;
    byId("clear-frame").disabled = frame().pixels.every(value => value === null);
    showPixels();
    showTimeline(scroll);
    queuePreview();
  }

  function paint(index) {
    const pixels = frame().pixels;
    const next = tool === "eraser" ? null : color;
    const previous = pixels[index];
    if (previous === next) return false;
    pixels[index] = next;
    if (tool !== "fill") return true;

    const queue = [index];
    for (let i = 0; i < queue.length; i += 1) {
      const n = queue[i];
      const adjacent = [];
      if (n % 8 > 0) adjacent.push(n - 1);
      if (n % 8 < 7) adjacent.push(n + 1);
      if (n >= 8) adjacent.push(n - 8);
      if (n < 56) adjacent.push(n + 8);
      for (const neighbor of adjacent) {
        if (pixels[neighbor] === previous) {
          pixels[neighbor] = next;
          queue.push(neighbor);
        }
      }
    }
    return true;
  }

  function paintSegment(from, to) {
    const count = Math.max(Math.abs((to >> 3) - (from >> 3)), Math.abs(to % 8 - from % 8), 1);
    for (let step = 1; step <= count; step += 1) {
      const x = Math.round(from % 8 + (to % 8 - from % 8) * step / count);
      const y = Math.round((from >> 3) + ((to >> 3) - (from >> 3)) * step / count);
      stroke.changed = paint(y * 8 + x) || stroke.changed;
    }
  }

  function pickColor(index) {
    const value = frame().pixels[index];
    if (value) setColor(value);
    else notify("Pick a lit pixel to sample its color.");
  }

  function indexAt(pointer) {
    const cell = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest(".pixel");
    return cell && grid.contains(cell) ? Number(cell.dataset.index) : null;
  }

  function setCellFocus(index, focus = true) {
    cells[focusCell].tabIndex = -1;
    focusCell = index;
    cells[index].tabIndex = 0;
    if (focus) cells[index].focus({ preventScroll: true });
  }

  function endStroke(pointer) {
    if (stroke?.id !== pointer.pointerId) return;
    const completed = stroke;
    stroke = null;
    if (grid.hasPointerCapture(pointer.pointerId)) grid.releasePointerCapture(pointer.pointerId);
    if (completed.changed) {
      remember(completed.before);
      render();
      saveDraft();
    }
  }

  grid.addEventListener("pointerdown", pointer => {
    const index = indexAt(pointer);
    if (pointer.button !== 0 || index === null || stroke) return;
    setCellFocus(index, pointer.pointerType !== "touch");
    pointer.preventDefault();
    if (tool === "picker") {
      pickColor(index);
      return;
    }
    stop();
    stroke = { id: pointer.pointerId, before: snapshot(), last: index, changed: paint(index) };
    grid.setPointerCapture(pointer.pointerId);
    showPixels();
    queuePreview();
  });
  grid.addEventListener("pointermove", pointer => {
    if (stroke?.id !== pointer.pointerId || tool === "fill") return;
    const index = indexAt(pointer);
    if (index === null || index === stroke.last) return;
    paintSegment(stroke.last, index);
    stroke.last = index;
    showPixels();
    queuePreview();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(event => grid.addEventListener(event, endStroke));
  grid.addEventListener("keydown", event => {
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
    if (event.key in deltas) {
      event.preventDefault();
      const next = index + deltas[event.key];
      if (next >= 0 && next < 64 &&
          (Math.abs(deltas[event.key]) === 8 || (next >> 3) === (index >> 3))) setCellFocus(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (tool === "picker") pickColor(index);
      else {
        stop();
        const before = snapshot();
        if (paint(index)) {
          remember(before);
          render();
          saveDraft();
        }
      }
    }
  });
  grid.addEventListener("click", event => {
    const cell = event.target.closest(".pixel");
    if (!cell || event.detail !== 0) return;
    const index = Number(cell.dataset.index);
    if (tool === "picker") pickColor(index);
    else {
      stop();
      const before = snapshot();
      if (paint(index)) {
        remember(before);
        render();
        saveDraft();
      }
    }
  });

  function setView(mode) {
    view = mode;
    byId("preview-stage").dataset.view = view;
    document.querySelectorAll("[data-view][aria-pressed]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.view === view));
    });
    queuePreview();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(animationRequest);
    byId("play").textContent = "▶ Play";
    timelineCursor();
    queuePreview();
  }

  function tick(now) {
    const total = frameEnds[frameEnds.length - 1];
    const elapsed = now - playbackStart;
    if (elapsed >= total && !byId("loop").checked) {
      selectFrame(project.frames.length - 1);
      return;
    }
    const next = frameEnds.findIndex(end => end > elapsed % total);
    if (next !== playbackIndex) {
      playbackIndex = next;
      showPreview();
      timelineCursor();
    }
    animationRequest = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (playing) {
      selectFrame(playbackIndex);
      return;
    }
    let elapsed = 0;
    frameEnds = project.frames.map(item => (elapsed += item.duration));
    playbackIndex = selected;
    playbackStart = performance.now() - (frameEnds[selected - 1] || 0);
    playing = true;
    byId("play").textContent = "Ⅱ Pause";
    timelineCursor();
    queuePreview();
    animationRequest = requestAnimationFrame(tick);
  }

  function insertFrame(duplicate) {
    if (project.frames.length >= model.MAX_FRAMES) return;
    edit(() => {
      const next = duplicate ? structuredClone(frame()) : model.blankFrame(frame().duration);
      project.frames.splice(++selected, 0, next);
    });
    timelineCursor(true);
  }

  function moveFrame(delta) {
    const destination = selected + delta;
    if (destination < 0 || destination >= project.frames.length) return;
    edit(() => {
      const [moved] = project.frames.splice(selected, 1);
      project.frames.splice(destination, 0, moved);
      selected = destination;
    });
    timelineCursor(true);
  }

  function replaceProject(next) {
    edit(() => {
      project = next;
      selected = 0;
      timeline.scrollLeft = 0;
    });
  }

  async function importProject(file) {
    if (!file) return;
    try {
      if (file.size > model.MAX_BYTES) throw new Error("This file is too large for a Weather Light project.");
      replaceProject(model.parse(await file.text()));
      notify(`Opened “${project.title}”.`);
    } catch (error) {
      notify(error.message, true);
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function exportFile(kind) {
    if (exporting) return;
    const progress = byId("export-progress");
    const status = byId("export-status");
    const buttons = [...document.querySelectorAll("[data-export]")];
    const base = project.title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 64) || "weather-light";
    exporting = true;
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = "Preparing export…";
    try {
      let blob;
      let name;
      if (kind === "project") {
        blob = new Blob([model.serialize(project)], { type: "application/json" });
        name = `${base}.wla.json`;
      } else if (kind === "device") {
        blob = new Blob([model.firmwareHeader(project)], { type: "text/plain" });
        name = "CustomAnimation.h";
      } else if (kind === "still") {
        blob = await preview.exportFrame(frame().pixels, view);
        name = `${base}-frame-${selected + 1}-${view}.png`;
      } else {
        progress.max = project.frames.length;
        progress.value = 0;
        progress.hidden = false;
        blob = await preview.exportAnimation(project, view, (done, total) => {
          progress.value = done;
          status.textContent = `Rendering frame ${done} of ${total}…`;
        });
        name = `${base}-${view}.png`;
      }
      download(blob, name);
      status.textContent = `Downloaded ${name}.`;
    } catch (error) {
      status.textContent = `Export failed. ${error.message}`;
    } finally {
      progress.hidden = true;
      buttons.forEach(button => { button.disabled = false; });
      exporting = false;
    }
  }

  for (const [name, value] of swatches) {
    const swatch = document.createElement("button");
    swatch.className = "swatch";
    swatch.type = "button";
    swatch.dataset.color = value;
    swatch.style.setProperty("--swatch", value);
    swatch.title = `${name} ${value}`;
    swatch.setAttribute("aria-label", `${name} ${value}`);
    swatch.addEventListener("click", () => setColor(value));
    byId("palette").append(swatch);
  }
  model.examples.forEach((example, index) => byId("examples").add(new Option(example.label, index)));
  document.querySelectorAll("button[data-tool]").forEach(button =>
    button.addEventListener("click", () => setTool(button.dataset.tool)));
  document.querySelectorAll("button[data-view]").forEach(button =>
    button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("button[data-export]").forEach(button =>
    button.addEventListener("click", () => exportFile(button.dataset.export)));
  document.querySelectorAll(".close-dialog").forEach(button =>
    button.addEventListener("click", () => { if (!exporting) button.closest("dialog").close(); }));
  exportDialog.addEventListener("cancel", event => { if (exporting) event.preventDefault(); });

  on("custom-color", "input", event => setColor(event.target.value));
  on("trace", "change", showPixels);
  on("undo", "click", () => restore(history, future));
  on("redo", "click", () => restore(future, history));
  on("clear-frame", "click", () => edit(() => frame().pixels.fill(null)));
  on("add-frame", "click", () => insertFrame(false));
  on("duplicate-frame", "click", () => insertFrame(true));
  on("delete-frame", "click", () => {
    if (project.frames.length === 1) return;
    edit(() => {
      project.frames.splice(selected, 1);
      selected = Math.min(selected, project.frames.length - 1);
    });
  });
  on("move-left", "click", () => moveFrame(-1));
  on("move-right", "click", () => moveFrame(1));
  on("timeline", "click", event => {
    const card = event.target.closest(".frame-card");
    if (card) selectFrame(Number(card.dataset.frame));
  });
  on("timeline", "keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    selectFrame(selected + (event.key === "ArrowLeft" ? -1 : 1));
  });
  on("duration", "change", () => {
    const value = duration.valueAsNumber;
    if (!Number.isInteger(value) || value < model.MIN_DURATION || value > model.MAX_DURATION) {
      notify(`Enter a whole number from ${model.MIN_DURATION} to ${model.MAX_DURATION} ms.`, true);
      duration.value = frame().duration;
    } else if (value !== frame().duration) edit(() => { frame().duration = value; });
  });
  on("project-title", "change", () => {
    const value = title.value.trim().slice(0, model.MAX_TITLE_LENGTH) || model.DEFAULT_TITLE;
    if (value !== project.title) edit(() => { project.title = value; });
    title.value = project.title;
  });
  on("project-title", "keydown", event => { if (event.key === "Enter") title.blur(); });
  on("play", "click", togglePlay);
  on("new-project", "click", () => {
    replaceProject(model.newProject());
    title.focus();
    title.select();
  });
  on("examples", "change", event => {
    if (event.target.value === "") return;
    const example = model.examples[Number(event.target.value)];
    replaceProject(example.make());
    event.target.value = "";
    notify(`Loaded ${example.label}.`);
  });
  on("open-project", "click", () => byId("project-file").click());
  on("project-file", "change", event => {
    importProject(event.target.files[0]);
    event.target.value = "";
  });
  on("export-project", "click", () => {
    stop();
    byId("export-status").textContent = "";
    exportDialog.showModal();
  });
  on("help", "click", () => byId("help-dialog").showModal());
  document.addEventListener("keydown", event => {
    if (document.querySelector("dialog[open]") || event.target.matches("input, select, textarea")) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) restore(future, history);
      else restore(history, future);
    } else if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      const shortcuts = { b: "pencil", e: "eraser", f: "fill", i: "picker" };
      if (shortcuts[key]) setTool(shortcuts[key]);
      else if (key === " " && (!event.target.matches("button") || event.target.matches(".pixel"))) {
        event.preventDefault();
        togglePlay();
      }
    }
  });

  title.maxLength = model.MAX_TITLE_LENGTH;
  duration.min = model.MIN_DURATION;
  duration.max = model.MAX_DURATION;
  byId("timing-hint").textContent = `${model.MIN_DURATION}–${model.MAX_DURATION.toLocaleString()} ms per frame`;
  buildGrid();
  setTool(tool);
  setColor(color);
  render();
  saveDraft();
  preview.ready.then(() => {
    deviceReady = true;
    queuePreview();
  }).catch(() => {
    setView("grid");
    document.querySelector('button[data-view="device"]').disabled = true;
    notify("The housing image could not load. Grid preview is available.", true);
  });
})();
