(() => {
  "use strict";

  const sizes = Object.freeze({
    grid: Object.freeze({width: 384, height: 384}),
    device: Object.freeze({width: 640, height: 752}),
  });
  const srgbToLinear = Float32Array.from({length: 256}, (_, index) => {
    const v = index / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const linearToSrgb = Uint8ClampedArray.from({length: 4097}, (_, index) => {
    const v = index / 4096;
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  });
  const ledDrive = Float32Array.from({length: 256}, (_, index) => 0.89 * (index / 255) ** 1.15);
  let device;

  function canvasFor(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function imageFrom(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The housing artwork could not be loaded."));
      image.src = dataUrl;
    });
  }

  async function prepareDevice() {
    const art = window.WeatherLightDeviceArt;
    if (!art) throw new Error("The housing artwork is missing.");
    const [background, atlas] = await Promise.all([
      imageFrom(art.background),
      imageFrom(art.weights),
    ]);
    const {origins, tileWidth, tileHeight} = art;
    const left = Math.min(...origins.map(([x]) => x));
    const top = Math.min(...origins.map(([, y]) => y));
    const width = Math.max(...origins.map(([x]) => x)) + tileWidth - left;
    const height = Math.max(...origins.map(([, y]) => y)) + tileHeight - top;
    const reader = canvasFor(background.width, background.height);
    const ctx = reader.getContext("2d", {alpha: false, willReadFrequently: true});
    ctx.drawImage(background, 0, 0);
    const image = ctx.getImageData(left, top, width, height);
    const srgb = image.data.slice();
    const linear = Float32Array.from(srgb, component => srgbToLinear[component]);
    const light = new Float32Array(image.data.length);

    reader.width = atlas.width;
    reader.height = atlas.height;
    ctx.drawImage(atlas, 0, 0);
    const packed = ctx.getImageData(0, 0, atlas.width, atlas.height).data;
    const weights = Float32Array.from({length: 256}, (_, value) => 1.5 * (value / 255) ** 2);
    const masks = origins.map(([x, y], index) => {
      const col = (index % 8) * tileWidth;
      const row = Math.floor(index / 8) * tileHeight;
      const result = [];
      for (let j = 0; j < tileHeight; j++) {
        const rowStart = 4 * ((row + j) * atlas.width + col);
        let start = 0;
        let end = tileWidth;
        while (start < end && !packed[rowStart + 4 * start]) start++;
        while (end > start && !packed[rowStart + 4 * (end - 1)]) end--;
        if (start === end) continue;
        result.push({
          offset: 4 * ((y - top + j) * width + x - left + start),
          weights: Float32Array.from({length: end - start},
            (_, i) => weights[packed[rowStart + 4 * (start + i)]]),
        });
      }
      return result;
    });
    device = {background, masks, left, top, srgb, linear, light, image};
  }

  const ready = prepareDevice();
  // The plain grid stays available even if the housing art fails to load.
  ready.catch(() => {});

  function paintGrid(ctx, pixels, background) {
    ctx.fillStyle = background || "#101729";
    ctx.fillRect(0, 0, sizes.grid.width, sizes.grid.height);
    for (let index = 0; index < 64; index++) {
      const x = 16 + 45 * (index % 8);
      const y = 16 + 45 * Math.floor(index / 8);
      ctx.fillStyle = pixels[index] || "#23304a";
      ctx.beginPath();
      ctx.roundRect(x, y, 37, 37, 6);
      ctx.fill();
    }
  }

  function paintDevice(ctx, pixels) {
    if (!device) {
      ctx.fillStyle = "#202225";
      ctx.fillRect(0, 0, sizes.device.width, sizes.device.height);
      return;
    }
    const {background, masks, left, top, srgb, linear, light, image} = device;
    ctx.drawImage(background, 0, 0);
    light.fill(0);
    let hasLight = false;
    pixels.forEach((color, index) => {
      if (!color || color === "#000000") return;
      const packed = Number.parseInt(color.slice(1), 16);
      if (!packed) return;
      const red = packed >> 16;
      const green = (packed >> 8) & 255;
      const blue = packed & 255;
      const spill = 0.032 * Math.max(red, green, blue) / 255;
      const r = ledDrive[red] + spill;
      const g = ledDrive[green] + spill;
      const b = ledDrive[blue] + spill;
      hasLight = true;
      for (const row of masks[index]) {
        let dest = row.offset;
        for (const weight of row.weights) {
          light[dest] += r * weight;
          light[dest + 1] += g * weight;
          light[dest + 2] += b * weight;
          dest += 4;
        }
      }
    });
    if (!hasLight) return;

    const result = image.data;
    result.set(srgb);
    for (let index = 0; index < light.length; index += 4) {
      if (!light[index]) continue;
      for (let channel = index; channel < index + 3; channel++) {
        const intensity = Math.min(1, linear[channel] + light[channel]);
        result[channel] = linearToSrgb[Math.round(intensity * 4096)];
      }
    }
    ctx.putImageData(image, left, top);
  }

  function draw(canvas, pixels, {mode = "grid", background} = {}) {
    const size = sizes[mode];
    if (!size) throw new Error("Unknown preview view.");
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    const ctx = canvas.getContext("2d", {alpha: false});
    if (mode === "device") paintDevice(ctx, pixels);
    else paintGrid(ctx, pixels, background);
  }

  function toPng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob?.type === "image/png") resolve(blob);
        else reject(new Error("The browser could not encode a PNG."));
      }, "image/png");
    });
  }

  async function exportFrame(pixels, mode = "grid", options = {}) {
    if (mode === "device") await ready;
    const {width, height} = sizes[mode];
    const canvas = canvasFor(width, height);
    draw(canvas, pixels, {...options, mode});
    return toPng(canvas);
  }

  // APNG keeps the browser's original PNG scanlines and uses a replacement
  // rectangle for each later frame. Animated colors never need a GIF palette.
  const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const crcTable = Uint32Array.from({length: 256}, (_, index) => {
    let entry = index;
    for (let bit = 0; bit < 8; bit++) {
      entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1;
    }
    return entry;
  });
  const ascii = new TextEncoder();

  function chunk(type, data) {
    const bytes = new Uint8Array(data.length + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    bytes.set(ascii.encode(type), 4);
    bytes.set(data, 8);
    let crc = 0xffffffff;
    for (let index = 4; index < bytes.length - 4; index++) {
      crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
    }
    view.setUint32(bytes.length - 4, crc ^ 0xffffffff);
    return bytes;
  }

  async function pngChunks(canvas) {
    const bytes = new Uint8Array(await (await toPng(canvas)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const chunks = [];
    for (let offset = pngSignature.length; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      const end = offset + 12 + length;
      if (end > bytes.length) break;
      chunks.push({type, data: bytes.subarray(offset + 8, end - 4), bytes: bytes.subarray(offset, end)});
      offset = end;
      if (type === "IEND" && chunks[0]?.type === "IHDR") return chunks;
    }
    throw new Error("The browser returned an incomplete PNG.");
  }

  function difference(previous, current, width, height) {
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0, pixel = 0; y < height; y++) {
      for (let x = 0; x < width; x++, pixel++) {
        if (previous[pixel] === current[pixel]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
    if (right < 0) return {x: 0, y: 0, w: 1, h: 1};
    return {x: left, y: top, w: right - left + 1, h: bottom - top + 1};
  }

  async function exportAnimation(project, mode = "grid", onProgress = () => {}) {
    const {frames} = project;
    if (!frames.length) throw new Error("Add a frame before exporting.");
    if (mode === "device") await ready;
    const {width, height} = sizes[mode];
    const canvas = canvasFor(width, height);
    const ctx = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
    const cropped = canvasFor(1, 1);
    const parts = [pngSignature];
    const animation = new Uint8Array(8);
    // num_plays is zero for an infinite loop.
    new DataView(animation.buffer).setUint32(0, frames.length);
    let sequence = 0;
    let previous;
    let encoding;
    for (const [index, frame] of frames.entries()) {
      if (!Number.isInteger(frame.duration) || frame.duration < 1 || frame.duration > 65535) {
        throw new Error("Frame duration must be between 1 and 65535 milliseconds.");
      }
      draw(canvas, frame.pixels, {mode});
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const current = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
      const bounds = previous ? difference(previous, current, width, height) : {x: 0, y: 0, w: width, h: height};
      const {x, y, w, h} = bounds;
      let rendered = canvas;
      if (index > 0) {
        cropped.width = w;
        cropped.height = h;
        cropped.getContext("2d", {alpha: false}).drawImage(canvas, x, y, w, h, 0, 0, w, h);
        rendered = cropped;
      }
      previous = current;
      const png = await pngChunks(rendered);
      if (index === 0) {
        encoding = png[0].data.slice(8);
        const imageStart = png.findIndex(item => item.type === "IDAT");
        parts.push(...png.slice(0, imageStart).map(item => item.bytes), chunk("acTL", animation));
      } else if (!encoding.every((component, i) => component === png[0].data[8 + i])) {
        throw new Error("The browser changed PNG pixel format between frames.");
      }
      const control = new Uint8Array(26);
      const header = new DataView(control.buffer);
      [sequence++, w, h, x, y].forEach((value, i) => header.setUint32(i * 4, value));
      header.setUint16(20, frame.duration);
      header.setUint16(22, 1000);
      // dispose=NONE and blend=SOURCE replace the changed rectangle exactly.
      parts.push(chunk("fcTL", control));
      for (const item of png) {
        if (item.type !== "IDAT") continue;
        if (index === 0) {
          parts.push(item.bytes);
        } else {
          const content = new Uint8Array(4 + item.data.length);
          new DataView(content.buffer).setUint32(0, sequence++);
          content.set(item.data, 4);
          parts.push(chunk("fdAT", content));
        }
      }
      onProgress(index + 1, frames.length);
    }
    parts.push(chunk("IEND", new Uint8Array(0)));
    return new Blob(parts, {type: "image/png"});
  }

  window.StudioPreview = Object.freeze({sizes, ready, draw, exportFrame, exportAnimation});
})();
