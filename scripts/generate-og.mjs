import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync('public/og-image.svg', 'utf-8');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
});
const pngData = resvg.render();
const pngBuffer = pngData.asPng();
writeFileSync('public/og-image.png', pngBuffer);
console.log('Generated public/og-image.png (1200x630)');
