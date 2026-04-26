// SVG placeholder generators for mock bridge. We render SVG strings that get
// uploaded to R2 with content-type image/svg+xml. The kiosk + share page can
// display these directly without any extra image processing.

export function generatePhotoSvg(opts: {
  index: number;
  sessionId: string;
  width?: number;
  height?: number;
}): string {
  const w = opts.width ?? 800;
  const h = opts.height ?? 600;
  const ts = new Date().toLocaleString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F5E642"/>
      <stop offset="100%" stop-color="#86C67C"/>
    </linearGradient>
    <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1.5" fill="#1A3A2A" fill-opacity="0.08"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#dots)"/>
  <g font-family="'Plus Jakarta Sans', system-ui, sans-serif" fill="#1A3A2A" text-anchor="middle">
    <text x="50%" y="42%" font-size="${Math.floor(w / 6)}" font-weight="800" letter-spacing="-2">📸</text>
    <text x="50%" y="58%" font-size="${Math.floor(w / 12)}" font-weight="700" letter-spacing="-1">PHOTO ${opts.index}</text>
    <text x="50%" y="68%" font-size="${Math.floor(w / 30)}" font-weight="500" opacity="0.6">${escapeXml(opts.sessionId)}</text>
    <text x="50%" y="${h - 24}" font-size="${Math.floor(w / 36)}" font-weight="500" opacity="0.5">${escapeXml(ts)}</text>
  </g>
</svg>`;
}

export function generateCompositeSvg(opts: { sessionId: string; boothName: string }): string {
  // Classic 4R photo strip — 1800x1200, two columns of 3 photos with a dotted
  // cut-line in between. Each photo cell is rendered in a slightly different
  // brand color so it reads as a real strip rather than blank.
  const w = 1800;
  const h = 1200;
  const cellW = 800;
  const cellH = 360;
  const padX = 40;
  const padY = 40;
  const colors = ["#F5E642", "#E8A598", "#86C67C"];
  const cells: string[] = [];
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 3; row++) {
      const x = padX + col * (cellW + 80);
      const y = padY + row * (cellH + 30);
      const fill = colors[row]!;
      cells.push(`
    <g transform="translate(${x}, ${y})">
      <rect width="${cellW}" height="${cellH}" rx="20" fill="${fill}" />
      <text x="${cellW / 2}" y="${cellH / 2 - 30}" text-anchor="middle" font-size="48" font-weight="800" fill="#1A3A2A">PHOTO ${row + 1}</text>
      <text x="${cellW / 2}" y="${cellH / 2 + 30}" text-anchor="middle" font-size="24" font-weight="500" fill="#1A3A2A" opacity="0.6">${escapeXml(opts.sessionId)}</text>
    </g>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#F5F0E8"/>
  ${cells.join("")}
  <line x1="${w / 2}" y1="${padY}" x2="${w / 2}" y2="${h - padY}" stroke="#1A3A2A" stroke-width="2" stroke-dasharray="8 8" opacity="0.4"/>
  <g font-family="'Plus Jakarta Sans', system-ui, sans-serif">
    <text x="${w / 2}" y="${h - 12}" text-anchor="middle" font-size="20" font-weight="700" fill="#1A3A2A" letter-spacing="6">${escapeXml(opts.boothName.toUpperCase())} · MAJA PHOTOBOOTH</text>
  </g>
</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
