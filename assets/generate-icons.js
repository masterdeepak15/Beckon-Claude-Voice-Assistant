'use strict';
// Generates simple tray icon PNGs for each state. Tray icons don't support
// animated GIFs reliably cross-platform, so "animation" is faked by cycling
// between 2-3 static frames on an interval (see main.js).
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 32;
const OUT_DIR = __dirname;

function drawCircle(png, cx, cy, r, [red, green, blue, alpha]) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx, dy = y - cy;
      const idx = (SIZE * y + x) << 2;
      if (dx * dx + dy * dy <= r * r) {
        png.data[idx] = red;
        png.data[idx + 1] = green;
        png.data[idx + 2] = blue;
        png.data[idx + 3] = alpha;
      } else {
        png.data[idx + 3] = 0; // transparent
      }
    }
  }
}

function drawDot(png, cx, cy, r, color) {
  for (let y = Math.max(0, cy - r); y < Math.min(SIZE, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(SIZE, cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const idx = (SIZE * y + x) << 2;
        png.data[idx] = color[0];
        png.data[idx + 1] = color[1];
        png.data[idx + 2] = color[2];
        png.data[idx + 3] = color[3];
      }
    }
  }
}

function saveFrame(name, drawFn) {
  const png = new PNG({ width: SIZE, height: SIZE });
  drawFn(png);
  const outPath = path.join(OUT_DIR, `${name}.png`);
  png.pack().pipe(fs.createWriteStream(outPath));
  console.log('Wrote', outPath);
}

// Idle — single static gray/neutral circle
saveFrame('tray-idle', (png) => drawCircle(png, 16, 16, 12, [130, 130, 140, 255]));

// Listening — 2 frames, green, pulsing radius (cycled on an interval for a "breathing" effect)
saveFrame('tray-listening-1', (png) => drawCircle(png, 16, 16, 10, [46, 204, 113, 255]));
saveFrame('tray-listening-2', (png) => drawCircle(png, 16, 16, 13, [46, 204, 113, 255]));

// Processing — 3 frames, blue circle with a rotating highlight dot (fake "spinner")
saveFrame('tray-processing-1', (png) => {
  drawCircle(png, 16, 16, 12, [52, 120, 246, 255]);
  drawDot(png, 16, 5, 3, [255, 255, 255, 255]);
});
saveFrame('tray-processing-2', (png) => {
  drawCircle(png, 16, 16, 12, [52, 120, 246, 255]);
  drawDot(png, 26, 16, 3, [255, 255, 255, 255]);
});
saveFrame('tray-processing-3', (png) => {
  drawCircle(png, 16, 16, 12, [52, 120, 246, 255]);
  drawDot(png, 16, 27, 3, [255, 255, 255, 255]);
});

// Paused — gray, slightly desaturated with a "pause bar" cutout look (kept simple: dimmer gray)
saveFrame('tray-paused', (png) => drawCircle(png, 16, 16, 12, [90, 90, 95, 255]));
