/**
 * Render the Settle brand assets from the mark's geometry (S4.13).
 *
 * The pfp and the favicon are the same glyph — an arrow descending onto a rule — on the one brand
 * field, rasterised deterministically so the asset is reproducible from code (the AI screener's
 * reproducibility check, Q-017). Geometry mirrors `components/ui/mark.tsx`; colours are the
 * `@theme` roles in `app/globals.css` (brand field, canvas paper). Run: `pnpm brand`.
 */

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const BRAND = "#0b6e4f";
const PAPER = "#f4f5f7";

/** The mark on a square field, centred, glyph ~55% of the width. `size` is the output edge in px. */
function svg(size: number): string {
  // Native glyph bbox is x 4→20, y 4→17 (16×13 units); scale so it spans 0.55·size, centred.
  const scale = (size * 0.55) / 16;
  const tx = size / 2 - 12 * scale;
  const ty = size / 2 - 10.5 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block">
  <rect width="${size}" height="${size}" fill="${BRAND}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="${PAPER}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 17h16"/>
    <path d="M12 4v8.5M12 12.5 8.6 9.1M12 12.5l3.4-3.4"/>
  </g>
</svg>`;
}

async function render(size: number, out: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<html><body style="margin:0;background:${BRAND}">${svg(size)}</body></html>`,
    );
    const png = await page.screenshot({ type: "png" });
    await mkdir(dirname(join(root, out)), { recursive: true });
    await writeFile(join(root, out), png);
    // Read the PNG IHDR back: the first 8 bytes are the signature, then width/height at 16..24.
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    console.log(`${out}: ${w}×${h}px, ${png.length} bytes`);
  } finally {
    await browser.close();
  }
}

await render(1024, "public/pfp.png");
await render(256, "app/icon.png");
