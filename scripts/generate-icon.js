#!/usr/bin/env node
/**
 * generate-icon.js
 * Generates assets/icon.png (256×256) and assets/icon.ico (16+256 multi-size).
 * Run:  node scripts/generate-icon.js
 * Deps: jimp@0.16.x (pure JS, no native bindings needed)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const SIZE = 512; // 512px — AppImage Linux 아이콘 권장 크기

// ─── Palette ─────────────────────────────────────────────────────────────────
const CA = { r: 108, g: 99, b: 255 }; // #6C63FF — accent start
const CB = { r: 192, g: 132, b: 252 }; // #C084FC — accent end
const WHITE = Jimp.rgbaToInt(255, 255, 255, 255);
const CLEAR = Jimp.rgbaToInt(0, 0, 0, 0);

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// ─── Geometry ────────────────────────────────────────────────────────────────
function inRoundedRect(x, y, w, h, r) {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
    if (x >= w - r && y < r) return (x - (w - r)) ** 2 + (y - r) ** 2 <= r * r;
    if (x < r && y >= h - r) return (x - r) ** 2 + (y - (h - r)) ** 2 <= r * r;
    if (x >= w - r && y >= h - r) return (x - (w - r)) ** 2 + (y - (h - r)) ** 2 <= r * r;
    return true;
}

// ─── Drawing ─────────────────────────────────────────────────────────────────
function setPixel(img, x, y, color) {
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) img.setPixelColor(color, x, y);
}

function bresenham(img, x0, y0, x1, y1, color) {
    [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (; ;) {
        setPixel(img, x0, y0, color);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

function thickLine(img, x0, y0, x1, y1, thick, color) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const nx = -dy / len, ny = dx / len;
    const h = thick / 2;
    for (let t = -h; t <= h; t += 0.5) {
        bresenham(img, x0 + nx * t, y0 + ny * t, x1 + nx * t, y1 + ny * t, color);
    }
    // Rounded caps
    for (let cy = -h; cy <= h; cy++) {
        for (let cx = -h; cx <= h; cx++) {
            if (cx * cx + cy * cy <= h * h) {
                setPixel(img, Math.round(x0 + cx), Math.round(y0 + cy), color);
                setPixel(img, Math.round(x1 + cx), Math.round(y1 + cy), color);
            }
        }
    }
}

// ─── ICO builder (embeds raw PNG data — works on Vista+) ─────────────────────
function buildIco(entries) {
    const count = entries.length;
    const offset = 6 + count * 16;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(count, 4);

    let pos = offset;
    const dirs = entries.map(({ size, buf }) => {
        const e = Buffer.alloc(16);
        e.writeUInt8(size >= 256 ? 0 : size, 0);
        e.writeUInt8(size >= 256 ? 0 : size, 1);
        e.writeUInt8(0, 2); e.writeUInt8(0, 3);
        e.writeUInt16LE(1, 4);
        e.writeUInt16LE(32, 6);
        e.writeUInt32LE(buf.length, 8);
        e.writeUInt32LE(pos, 12);
        pos += buf.length;
        return e;
    });

    return Buffer.concat([header, ...dirs, ...entries.map(e => e.buf)]);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

    console.log('🎨 Generating app icon...\n');

    // Create blank 256×256 image
    const img = await new Promise((res, rej) =>
        new Jimp(SIZE, SIZE, CLEAR, (e, i) => (e ? rej(e) : res(i)))
    );

    // ── Draw gradient rounded-rectangle background ──────────────────────────
    const R = 52; // corner radius
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (!inRoundedRect(x, y, SIZE, SIZE, R)) continue;
            const t = (x + y) / (SIZE * 2);
            img.setPixelColor(
                Jimp.rgbaToInt(lerp(CA.r, CB.r, t), lerp(CA.g, CB.g, t), lerp(CA.b, CB.b, t), 255),
                x, y
            );
        }
    }

    // ── Draw white checkmark — coordinates scaled for SIZE × SIZE ————————————
    // Reference points at 256px; scale to actual SIZE
    const S = SIZE / 256;
    thickLine(img, 55 * S, 132 * S, 102 * S, 178 * S, 24 * S, WHITE);
    thickLine(img, 102 * S, 178 * S, 200 * S, 82 * S, 24 * S, WHITE);

    // ── Save SIZE×SIZE PNG ──────────────────────────────────────────────────
    const pngFull = await img.getBufferAsync('image/png');
    fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), pngFull);
    console.log(`  ✓ assets/icon.png      (${SIZE}×${SIZE})`);

    // ── Resize to 256×256 for ICO embedding (Windows max) ─────────────────────
    const img256 = img.clone().resize(256, 256, Jimp.RESIZE_BICUBIC);
    const png256 = await img256.getBufferAsync('image/png');

    // ── Resize to 16×16 ──────────────────────────────────────────────────────
    const img16 = img.clone().resize(16, 16, Jimp.RESIZE_BICUBIC);
    const png16 = await img16.getBufferAsync('image/png');
    console.log('  ✓ icon-16 ready        (16×16)');

    // ── Build multi-size ICO (16 + 256 PNG-embedded) ─────────────────────────
    const ico = buildIco([
        { size: 16, buf: png16 },
        { size: 256, buf: png256 },
    ]);
    fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), ico);
    console.log('  ✓ assets/icon.ico      (16 + 256)');

    console.log('\n✅ Icons generated successfully!\n');
}

main().catch((err) => {
    console.error('❌ Icon generation failed:', err.message);
    process.exit(1);
});
