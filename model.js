(() => {
  "use strict";

  const FORMAT = "weather-light-animation";
  const VERSION = 1;
  const SIDE = 8;
  const PIXEL_COUNT = SIDE * SIDE;
  const MIN_DURATION = 80;
  const MAX_DURATION = 10000;
  const MAX_FRAMES = 120;
  const MAX_BYTES = 256 * 1024;
  const MAX_TITLE_LENGTH = 64;
  const DEFAULT_DURATION = 120;
  const DEFAULT_TITLE = "Untitled animation";

  function normalizeColor(value) {
    if (value === null) return null;
    if (typeof value !== "string" || value.length !== 7 || !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error("Each pixel must be off or a six-digit hex color.");
    }
    return value.toUpperCase();
  }

  function normalizeTitle(title) {
    if (typeof title !== "string") throw new Error("The animation title must be text.");
    const cleanTitle = title.trim();
    if (cleanTitle.length > MAX_TITLE_LENGTH) {
      throw new Error(`The title can have up to ${MAX_TITLE_LENGTH} characters.`);
    }
    return cleanTitle || DEFAULT_TITLE;
  }

  function validateDuration(duration) {
    if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
      throw new Error(`Frame time must be a whole number from ${MIN_DURATION} to ${MAX_DURATION} ms.`);
    }
    return duration;
  }

  function blankFrame(duration = DEFAULT_DURATION) {
    return { duration: validateDuration(duration), pixels: Array(PIXEL_COUNT).fill(null) };
  }

  function newProject(title = DEFAULT_TITLE) {
    return { format: FORMAT, version: VERSION, title: normalizeTitle(title), frames: [blankFrame()] };
  }

  function validate(project) {
    if (!project || project.format !== FORMAT || project.version !== VERSION) {
      throw new Error("Choose a Weather Light Studio project (.json).");
    }
    const title = normalizeTitle(project.title);
    if (!Array.isArray(project.frames) || project.frames.length < 1 || project.frames.length > MAX_FRAMES) {
      throw new Error(`A project must have between 1 and ${MAX_FRAMES} frames.`);
    }
    const frames = Array.from(project.frames, (frame, index) => {
      if (!frame || !Array.isArray(frame.pixels) || frame.pixels.length !== PIXEL_COUNT) {
        throw new Error(`Frame ${index + 1} needs exactly ${PIXEL_COUNT} pixels.`);
      }
      try {
        return { duration: validateDuration(frame.duration), pixels: Array.from(frame.pixels, normalizeColor) };
      } catch (error) {
        throw new Error(`Frame ${index + 1}. ${error.message}`);
      }
    });
    return { format: FORMAT, version: VERSION, title, frames };
  }

  function parse(text) {
    if (typeof text !== "string" || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) {
      throw new Error("The project file is too large.");
    }
    let project;
    try {
      project = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error("This file could not be read as JSON.");
    }
    return validate(project);
  }

  function serialize(project) {
    return JSON.stringify(validate(project), null, 2) + "\n";
  }

  function rgb(color) {
    if (!color) return [0, 0, 0];
    const packed = Number.parseInt(color.slice(1), 16);
    return [packed >> 16, (packed >> 8) & 255, packed & 255];
  }

  function firmwareHeader(project) {
    const { frames } = validate(project);
    const durations = frames.map(frame => frame.duration).join(", ");
    const imageData = frames.map(frame => {
      const pixels = frame.pixels.map(pixel => `{${rgb(pixel).join(",")}}`);
      const rows = Array.from({ length: SIDE }, (_, row) => {
        const start = row * SIDE;
        return `    ${pixels.slice(start, start + SIDE).join(", ")}`;
      });
      return "  {\n" + rows.join(",\n") + "\n  }";
    });
    return [
      "#pragma once",
      "#include <stdint.h>",
      "",
      "// Weather Light Studio export. Rows start at the top-left pixel.",
      "namespace custom_animation {",
      `static constexpr uint16_t durations[] = {${durations}};`,
      "static constexpr uint8_t frames[][64][3] = {",
      imageData.join(",\n"),
      "};",
      "}  // namespace custom_animation",
      ""
    ].join("\n");
  }

  function hexPixel(red, green, blue) {
    const channels = [red, green, blue].map(value => Math.round(Math.max(0, Math.min(255, value))));
    if (Math.max(...channels) < 12) return null;
    return "#" + channels.map(value => value.toString(16).padStart(2, "0").toUpperCase()).join("");
  }

  function aurora() {
    const project = newProject("Aurora");
    const frameCount = 24;
    project.frames = Array.from({ length: frameCount }, (_, frame) => {
      const phase = frame * 2 * Math.PI / frameCount;
      const pixels = Array.from({ length: PIXEL_COUNT }, (_, index) => {
        const x = index % SIDE - 3.5;
        const y = Math.floor(index / SIDE) - 3.5;
        const crest = -0.5 + 1.35 * Math.sin(x * 0.65 + phase) + 0.32 * Math.sin(x * 1.2 - phase);
        const distance = y - crest;
        const band = Math.exp(-1.1 * distance * distance);
        const fringe = Math.exp(-1.15 * (distance - 1.45) ** 2);
        const haze = Math.exp(-2.1 * (distance + 0.98) ** 2);
        const teal = 0.5 + 0.5 * Math.cos(x * 0.55 + phase);
        return hexPixel(
          band * (23 + 24 * teal) + fringe * 139 + haze * 30,
          band * (156 + 97 * teal) + fringe * 47 + haze * 80,
          band * (245 - 45 * teal) + fringe * 219 + haze * 129
        );
      });
      return { duration: DEFAULT_DURATION, pixels };
    });
    return project;
  }

  function sunshower() {
    const project = newProject("Sunshower");
    const art = [
      ".....a..",
      "...aYYa.",
      "..cCYYY.",
      ".cCCCYa.",
      "bCCCCCc.",
      ".bbbbb..",
      "........",
      "........"
    ].join("");
    const colors = { Y: "#FFCA63", c: "#BFCCE9", C: "#E3EAFA", b: "#728BB2" };
    project.frames = Array.from({ length: 16 }, (_, frame) => {
      const pixels = Array.from(art, (mark, index) => {
        if (mark !== "a") return colors[mark] || null;
        return (Math.floor(frame / 4) + index) % 2 ? "#FFC45D" : "#775029";
      });
      for (const [column, timeOffset] of [[0, 0], [2, 3], [4, 5], [6, 2]]) {
        const drop = (frame + timeOffset) % 8;
        if (drop < 2 || drop > 4) continue;
        const dropIndex = (3 + drop) * SIDE + column;
        const trailIndex = dropIndex - SIDE;
        if (!pixels[dropIndex]) pixels[dropIndex] = "#69D5FF";
        if (!pixels[trailIndex]) pixels[trailIndex] = "#2E638F";
      }
      return { duration: 155, pixels };
    });
    return project;
  }

  function fireflies() {
    const project = newProject("Fireflies");
    const paths = [
      [[1, 4], [1, 3], [2, 2], [3, 2], [4, 3], [4, 4], [3, 5], [2, 5]],
      [[5, 4], [5, 3], [5, 2], [6, 1], [7, 1], [7, 3], [7, 4], [6, 5]],
      [[0, 5], [1, 6], [2, 6], [3, 7], [4, 7], [5, 6], [4, 6], [2, 5]]
    ];
    const glows = [
      ["#FFED8C", "#8F6235", "#3C314D"],
      ["#CFF28C", "#607A3B", "#283E45"],
      ["#FFC178", "#90513C", "#362744"]
    ];
    project.frames = Array.from({ length: 24 }, (_, frame) => {
      const pixels = blankFrame().pixels;
      pixels[2] = frame % 8 < 5 ? "#283D6C" : "#485E92";
      pixels[14] = frame % 12 > 4 ? "#31416E" : "#1C2448";
      pixels[24] = "#1D2655";
      for (let insect = 0; insect < paths.length; insect += 1) {
        const path = paths[insect];
        const step = Math.floor((frame + insect * 3) / 3);
        for (let trail = 2; trail >= 0; trail -= 1) {
          const [x, y] = path[(step + path.length - trail) % path.length];
          pixels[y * SIDE + x] = glows[insect][trail];
        }
      }
      return { duration: 130, pixels };
    });
    return project;
  }

  const examples = Object.freeze([
    Object.freeze({ label: "Aurora", make: aurora }),
    Object.freeze({ label: "Sunshower", make: sunshower }),
    Object.freeze({ label: "Fireflies", make: fireflies })
  ]);

  window.StudioModel = Object.freeze({
    FORMAT, VERSION, SIDE, PIXEL_COUNT, MAX_FRAMES, MIN_DURATION, MAX_DURATION,
    MAX_BYTES, MAX_TITLE_LENGTH, DEFAULT_DURATION, DEFAULT_TITLE, blankFrame,
    newProject, examples, normalizeColor, parse, serialize, firmwareHeader
  });
})();
