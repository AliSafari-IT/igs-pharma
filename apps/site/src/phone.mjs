// The animated phone in "The app, step by step": six scenes of the phase-1 Android app, drawn as one
// inline SVG. app.js shows one scene at a time (class is-active); site.css does the motion and turns it
// off for prefers-reduced-motion. Every colour comes from CSS classes (no style attributes, for the CSP).
// The products are made-up examples (and not medicines): the page shows how the app works, not an offer.
import { esc } from "./html.mjs";

const W = 280;
const H = 560;

const text = (x, y, value, cls = "ph-text", extra = "") =>
  `<text x="${x}" y="${y}" class="${cls}"${extra}>${esc(value)}</text>`;
const lines = (x, y, values, cls, step = 20) =>
  `<text class="${cls}">${values.map((v, i) => `<tspan x="${x}" y="${y + i * step}">${esc(v)}</tspan>`).join("")}</text>`;
const button = (x, y, w, h, label, cls = "ph-btn") =>
  `<g class="${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>${text(x + w / 2, y + h / 2 + 5, label, "ph-btn-label", ' text-anchor="middle"')}</g>`;
const card = (x, y, w, h, cls = "ph-card") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" class="${cls}"/>`;
/** Availability: always words first, the dot only repeats it (never colour alone). */
const stock = (x, y, label, few = false) =>
  `<circle cx="${x + 4}" cy="${y - 4}" r="4" class="ph-dot${few ? " ph-dot--few" : ""}"/>${text(x + 13, y, label, "ph-small ph-stock")}`;
const searchIcon = (x, y) =>
  `<g class="ph-icon" transform="translate(${x} ${y})"><circle cx="6" cy="6" r="5"/><path d="M10 10l4 4"/></g>`;

function searchBox(value, typed = false) {
  return `${card(22, 84, 236, 40, "ph-card ph-search")}
    ${searchIcon(36, 97)}
    ${typed ? `<g class="ph-typed">${text(60, 109, value, "ph-text")}</g><rect x="${60 + value.length * 8.2}" y="94" width="2" height="20" class="ph-caret"/>` : text(60, 109, value, "ph-text ph-muted")}`;
}

function tabBar(active) {
  // Home, Search, My list, Pharmacy: the app's bottom tabs.
  const icons = [
    '<path d="M3 10l7-6 7 6v7H3z"/>',
    '<circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/>',
    '<path d="M4 5h12M4 10h12M4 15h8"/>',
    '<path d="M10 3v14M3 10h14"/>',
  ];
  return `<rect x="14" y="470" width="252" height="50" class="ph-tabs"/>${icons
    .map(
      (d, i) =>
        `<g class="ph-icon${i === active ? " is-on" : ""}" transform="translate(${36 + i * 60} 484)">${d}</g>`,
    )
    .join("")}`;
}

function scene1(s) {
  const tiles = s.categories
    .map((label, i) => {
      const x = i % 2 ? 146 : 22;
      const y = i < 2 ? 140 : 196;
      return `${card(x, y, 112, 46, "ph-card ph-tile")}${text(x + 56, y + 28, label, "ph-text ph-bold", ' text-anchor="middle"')}`;
    })
    .join("");
  return `
    ${searchBox(s.search)}
    <circle cx="140" cy="104" r="16" class="ph-tap"/>
    ${tiles}
    <g class="ph-rise">
      ${card(22, 256, 236, 92)}
      <g class="ph-icon" transform="translate(38 272)"><path d="M10 2v16M2 10h16"/></g>
      ${text(66, 287, s.pharmacy, "ph-text ph-bold")}
      ${text(38, 316, s.open, "ph-small ph-muted")}
      ${text(38, 336, s.hours, "ph-small ph-muted")}
    </g>
    ${tabBar(0)}`;
}

function scene2(s) {
  const results = s.results
    .map(([name, price, label], i) => {
      const y = 140 + i * 70;
      return `<g class="ph-rise ph-rise--${i + 1}">${card(22, y, 236, 60)}
        ${text(36, y + 24, name, "ph-text ph-bold")}
        ${text(36, y + 46, price, "ph-text")}
        ${stock(150, y + 46, label, i === 1)}</g>`;
    })
    .join("");
  return `${searchBox(s.query, true)}${results}${tabBar(1)}`;
}

function scene3(s) {
  return `
    ${text(24, 100, "‹", "ph-big ph-muted")}
    <g class="ph-rise">
      ${card(22, 112, 236, 84, "ph-card ph-product-bg")}
      <rect x="112" y="124" width="56" height="62" rx="10" class="ph-product"/>
      <rect x="126" y="116" width="28" height="12" rx="3" class="ph-product-cap"/>
      ${lines(24, 220, s.productName, "ph-title", 22)}
      ${text(24, 264, s.cnk, "ph-small ph-muted")}
      ${text(24, 294, s.price, "ph-big")}
      ${text(24 + s.price.length * 14 + 8, 294, s.vat, "ph-small ph-muted")}
      ${stock(170, 292, s.stock)}
      ${lines(24, 322, s.productText, "ph-small ph-muted", 17)}
      ${button(22, 382, 236, 38, s.add, "ph-btn ph-btn--ghost ph-add")}
      ${button(22, 426, 236, 38, s.order)}
    </g>`;
}

function scene4(s) {
  const items = s.listItems
    .map(
      ([name, price], i) =>
        `<g class="ph-rise ph-rise--${i + 1}">${card(22, 116 + i * 62, 236, 52)}
        ${text(36, 147 + i * 62, name, "ph-text ph-bold")}
        ${text(244, 147 + i * 62, price, "ph-text", ' text-anchor="end"')}</g>`,
    )
    .join("");
  return `
    ${text(24, 102, s.listTitle, "ph-title")}
    ${items}
    ${text(24, 264, s.listNote, "ph-small ph-muted")}
    ${button(22, 280, 236, 42, s.counter)}
    ${tabBar(2)}`;
}

function scene5(s) {
  return `
    <g class="ph-rise">
      ${card(22, 84, 236, 132)}
      <image href="/icon.svg" x="36" y="98" width="36" height="36"/>
      ${text(82, 122, s.pharmacy, "ph-title")}
      ${text(36, 156, s.hours, "ph-small ph-muted")}
      ${button(36, 168, 100, 36, s.call)}
      ${button(144, 168, 100, 36, s.route, "ph-btn ph-btn--ghost")}
    </g>
    <g class="ph-rise ph-rise--2">
      ${card(22, 228, 236, 48)}
      ${text(36, 257, s.duty, "ph-text ph-bold")}
      ${text(240, 257, "›", "ph-title ph-muted", ' text-anchor="end"')}
    </g>
    <g class="ph-rise ph-rise--3">
      ${card(22, 288, 236, 82, "ph-feedback")}
      ${lines(36, 314, s.emergency, "ph-small ph-bold", 20)}
    </g>
    ${tabBar(3)}`;
}

function scene6(s) {
  return `
    ${card(22, 84, 236, 34, "ph-card ph-url")}
    <g class="ph-icon ph-lock" transform="translate(34 92)"><rect x="1" y="8" width="12" height="9" rx="2"/><path d="M4 8V5a3 3 0 0 1 6 0v3"/></g>
    ${text(56, 106, s.site, "ph-text ph-small")}
    ${text(24, 152, s.checkout, "ph-title")}
    <g class="ph-rise">
      ${card(22, 168, 236, 104, "ph-feedback")}
      <circle cx="52" cy="200" r="14" class="ph-check-bg"/>
      <path d="M45 200l5 5 9-10" class="ph-check"/>
      ${lines(76, 196, s.checked, "ph-text ph-bold", 20)}
    </g>
    <rect x="22" y="290" width="236" height="10" rx="5" class="ph-line"/>
    <rect x="22" y="310" width="180" height="10" rx="5" class="ph-line"/>
    <rect x="22" y="330" width="210" height="10" rx="5" class="ph-line"/>
    ${button(22, 420, 236, 42, s.back, "ph-btn ph-btn--ghost")}`;
}

const SCENES = [scene1, scene2, scene3, scene4, scene5, scene6];

export function phone(t) {
  const s = t.app.screen;
  const scenes = SCENES.map(
    (draw, i) => `<g class="scene${i === 0 ? " is-active" : ""}" data-scene="${i}">${draw(s)}</g>`,
  ).join("");
  return `<svg class="phone" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="phone-title" focusable="false">
  <title id="phone-title">${esc(t.app.title)}</title>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="38" class="ph-frame"/>
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="28" class="ph-screen"/>
  <path d="M14 42a28 28 0 0 1 28-28h196a28 28 0 0 1 28 28v28H14z" class="ph-bar"/>
  <image href="/icon.svg" x="28" y="28" width="28" height="28"/>
  ${text(64, 49, s.app, "ph-bar-title")}
  ${scenes}
  <rect x="110" y="532" width="60" height="5" rx="2.5" class="ph-home"/>
</svg>`;
}
