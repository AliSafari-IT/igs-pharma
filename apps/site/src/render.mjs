// Page templates. Plain functions returning HTML strings; build.mjs writes them to dist/.
// No inline scripts or styles anywhere: the CSP is script-src 'self'; style-src 'self'.
import { CONTACT_EMAIL, LANGS, languages } from "./content.mjs";
import { esc } from "./html.mjs";
import { phone } from "./phone.mjs";

export const SITE_URL = "https://igs.asafarim.site";

/** Every page, per language, so the language switch links to the same page in the other languages. */
export const routes = {
  home: { nl: "/", fr: "/fr/", de: "/de/", en: "/en/" },
  privacy: {
    nl: "/privacy/",
    fr: "/fr/confidentialite/",
    de: "/de/datenschutz/",
    en: "/en/privacy/",
  },
  cookies: { nl: "/cookies/", fr: "/fr/cookies/", de: "/de/cookies/", en: "/en/cookies/" },
  deletion: {
    nl: "/gegevens-verwijderen/",
    fr: "/fr/supprimer-donnees/",
    de: "/de/daten-loeschen/",
    en: "/en/delete-data/",
  },
};

const ICONS = {
  cart: '<path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  rx: '<path d="M6 20V4h5a4 4 0 0 1 0 8H6"/><path d="M10 12l8 8M18 12l-8 8"/>',
  pharmacist:
    '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M12 8.5v7M8.5 12h7"/>',
  leaflet: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  eu: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 20L20 4"/>',
  speak: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ""}</svg>`;

function logo(t, home) {
  return `<a class="brand" href="${home}" aria-label="IGS-Pharma, ${esc(t.footer.tagline)}">
    <img class="brand-mark" src="/icon.svg" width="36" height="36" alt="">
    <span class="brand-name">IGS-Pharma</span>
  </a>`;
}

function themeToggle(t) {
  return `<button type="button" class="os-theme-toggle" data-theme-toggle aria-label="${esc(t.themeLabel)}" aria-pressed="false" title="${esc(t.themeLabel)}">
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <mask id="os-theme-moon"><rect width="24" height="24" fill="#fff"/><circle class="os-theme-bite" cx="17.5" cy="6.5" r="6" fill="#000"/></mask>
    <circle class="os-theme-core" cx="12" cy="12" r="5" fill="currentColor" mask="url(#os-theme-moon)"/>
    <path class="os-theme-rays" d="M12 1.5v2.5M12 20v2.5M1.5 12h2.5M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
  </svg>
</button>`;
}

/** NL · FR · DE · EN, each linking to this page in that language; the current one is marked, not linked. */
function langSwitch(t, lang, page, cls = "langs") {
  const items = LANGS.map((code) => {
    const other = languages[code];
    if (code === lang)
      return `<span class="lang is-current" aria-current="true">${other.code}</span>`;
    return `<a class="lang" href="${routes[page][code]}" hreflang="${other.lang}" lang="${other.lang}" title="${esc(other.langName)}">${other.code}</a>`;
  }).join("");
  return `<nav class="${cls}" aria-label="${esc(t.langLabel)}">${items}</nav>`;
}

function layout({ t, lang, page, title, description, body, nav = true }) {
  const home = routes.home[lang];
  const path = routes[page][lang];
  const anchors = nav
    ? `<nav class="nav" aria-label="IGS-Pharma">
        <a href="${home}#what">${esc(t.nav.what)}</a>
        <a href="${home}#app">${esc(t.nav.app)}</a>
        <a href="${home}#care">${esc(t.nav.care)}</a>
        <a href="${home}#plan">${esc(t.nav.plan)}</a>
        <a href="${home}#faq">${esc(t.nav.faq)}</a>
      </nav>`
    : "";
  const alternates = LANGS.map(
    (code) =>
      `<link rel="alternate" hreflang="${languages[code].lang}" href="${SITE_URL}${routes[page][code]}">`,
  ).join("\n");
  return `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE_URL}${path}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE_URL}${routes[page].nl}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta name="theme-color" content="#222222">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
<script src="/theme.js"></script>
<script src="/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="os-topbar topbar">
  <div class="wrap topbar-inner">
    ${logo(t, home)}
    ${anchors}
    <div class="topbar-tools">
      ${langSwitch(t, lang, page)}
      ${themeToggle(t)}
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap footer-inner">
    <div>
      ${logo(t, home)}
      <p class="muted">${esc(t.footer.tagline)}</p>
      <p class="small">${esc(t.footer.emergency)}</p>
    </div>
    <div class="footer-side">
      <nav class="footer-links" aria-label="Footer">
        <a href="${routes.privacy[lang]}">${esc(t.footer.privacy)}</a>
        <a href="${routes.cookies[lang]}">${esc(t.footer.cookies)}</a>
        <a href="${routes.deletion[lang]}">${esc(t.footer.delete)}</a>
        <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
        <a href="https://asafarim.site/">${esc(t.footer.os)}</a>
      </nav>
      ${langSwitch(t, lang, page, "langs langs--footer")}
    </div>
    <p class="muted small">© 2026 ${esc(t.footer.rights)}</p>
  </div>
</footer>
</body>
</html>
`;
}

function home(t, lang) {
  const a = t.app;
  const chips = t.hero.chips
    .map((c, i) => `<span class="chip chip--${i + 1}">${esc(c)}</span>`)
    .join("");
  const what = t.what.items
    .map(
      (it, i) =>
        `<li class="offer offer--${i + 1}">${icon(it.icon)}<span class="tag">${esc(it.tag)}</span><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></li>`,
    )
    .join("");
  const steps = a.steps
    .map(
      (s, i) => `<li>
        <button type="button" class="flow-step${i === 0 ? " is-active" : ""}" data-step="${i}" aria-pressed="${i === 0}">
          <span class="flow-num" aria-hidden="true">${i + 1}</span>
          <span><span class="flow-title">${esc(s.title)}</span><span class="flow-text">${esc(s.text)}</span></span>
        </button>
      </li>`,
    )
    .join("");
  const care = t.care.items
    .map(
      (it) =>
        `<li class="feature">${icon(it.icon)}<h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></li>`,
    )
    .join("");
  const plan = t.plan.steps
    .map(
      (s, i) =>
        `<li class="plan-step${i === 0 ? " is-now" : ""}"><span class="plan-dot" aria-hidden="true">${i === 0 ? icon("check") : i + 1}</span><div><span class="tag">${esc(s.status)}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div></li>`,
    )
    .join("");
  const faq = t.faq.items
    .map(
      (it) =>
        `<details class="faq-item"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`,
    )
    .join("");

  const body = `
<section class="hero">
  <div class="wrap hero-inner">
    <div class="hero-copy">
      <p class="kicker">${esc(t.hero.kicker)}</p>
      <h1>${esc(t.hero.title)}</h1>
      <p class="lead">${esc(t.hero.lead)}</p>
      <p class="notice">${esc(t.hero.note)}</p>
      <div class="hero-actions">
        <a class="btn" href="#app">${esc(t.hero.cta)}</a>
        <span class="btn btn--ghost btn--static" aria-disabled="true">${esc(t.playSoon)}</span>
      </div>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="hero-logo"><img src="/logo.svg" width="320" height="316" alt=""></div>
      ${chips}
    </div>
  </div>
</section>

<section id="what" class="section">
  <div class="wrap">
    <h2>${esc(t.what.title)}</h2>
    <p class="lead">${esc(t.what.lead)}</p>
    <ul class="offers">${what}</ul>
  </div>
</section>

<section id="app" class="section section--alt">
  <div class="wrap">
    <h2>${esc(a.title)}</h2>
    <p class="lead">${esc(a.lead)}</p>
    <div class="flow" data-flow>
      <div class="flow-phone">${phone(t)}<p class="flow-caption" data-flow-caption aria-hidden="true"><strong>1. </strong> ${esc(a.steps[0].title)}</p><p class="muted small flow-note">${esc(a.caption)}</p></div>
      <div class="flow-side">
        <ol class="flow-steps">${steps}</ol>
        <div class="flow-actions">
          <button type="button" class="btn btn--ghost flow-toggle" data-flow-toggle data-play="${esc(a.play)}" data-pause="${esc(a.pause)}" hidden>${esc(a.pause)}</button>
          <span class="btn btn--ghost btn--static" aria-disabled="true">${esc(t.playSoon)}</span>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="care" class="section">
  <div class="wrap">
    <h2>${esc(t.care.title)}</h2>
    <p class="lead">${esc(t.care.lead)}</p>
    <ul class="features">${care}</ul>
    <div class="card privacy-card">
      <div>
        <h3>${esc(t.privacyCard.title)}</h3>
        <p>${esc(t.privacyCard.text)}</p>
      </div>
      <p class="links"><a href="${routes.privacy[lang]}">${esc(t.privacyCard.privacy)}</a> · <a href="${routes.deletion[lang]}">${esc(t.privacyCard.delete)}</a></p>
    </div>
  </div>
</section>

<section id="plan" class="section section--alt">
  <div class="wrap">
    <h2>${esc(t.plan.title)}</h2>
    <p class="lead">${esc(t.plan.lead)}</p>
    <ol class="plan">${plan}</ol>
  </div>
</section>

<section id="faq" class="section">
  <div class="wrap narrow">
    <h2>${esc(t.faq.title)}</h2>
    ${faq}
    <p class="faq-next"><a class="btn" href="#what">${esc(t.nav.what)}</a> <a class="btn btn--ghost" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
  </div>
</section>`;
  return layout({
    t,
    lang,
    page: "home",
    title: t.meta.title,
    description: t.meta.description,
    body,
  });
}

/** Fills the {{deleteHref}}, {{privacyHref}} and {{cookiesHref}} placeholders with the page's language's paths. */
function links(text, lang) {
  return text
    .replaceAll("{{deleteHref}}", routes.deletion[lang])
    .replaceAll("{{privacyHref}}", routes.privacy[lang])
    .replaceAll("{{cookiesHref}}", routes.cookies[lang]);
}

function block(item, lang) {
  if (typeof item === "string") return `<p>${links(item, lang)}</p>`;
  if (item.list) return `<ul>${item.list.map((li) => `<li>${links(li, lang)}</li>`).join("")}</ul>`;
  if (item.ordered)
    return `<ol>${item.ordered.map((li) => `<li>${links(li, lang)}</li>`).join("")}</ol>`;
  return "";
}

function legal(t, lang, page, doc) {
  const sections = doc.sections
    .map(
      ([heading, items]) =>
        `<h2>${esc(heading)}</h2>${items.map((it) => block(it, lang)).join("")}`,
    )
    .join("");
  const body = `<section class="section"><div class="wrap narrow prose">
    <h1>${esc(doc.title)}</h1>
    ${doc.draft ? `<p class="notice">${esc(doc.draft)}</p>` : ""}
    ${doc.lead ? `<p class="lead">${esc(doc.lead)}</p>` : ""}
    ${sections}
    ${doc.updated ? `<p class="muted small">${esc(doc.updated)}</p>` : ""}
    <p><a class="btn btn--ghost" href="${routes.home[lang]}">← ${esc(t.back)}</a></p>
  </div></section>`;
  return layout({
    t,
    lang,
    page,
    title: `${doc.title} · IGS-Pharma`,
    description: doc.lead ?? doc.title,
    body,
    nav: false,
  });
}

function notFound(t) {
  const homes = LANGS.filter((code) => code !== "nl")
    .map(
      (code) =>
        `<a class="btn btn--ghost" href="${routes.home[code]}" lang="${languages[code].lang}">${esc(languages[code].langName)}</a>`,
    )
    .join(" ");
  const body = `<section class="section"><div class="wrap narrow prose">
    <h1>${esc(t.notFound.title)}</h1>
    <p>${esc(t.notFound.text)}</p>
    <p class="actions"><a class="btn" href="/">${esc(t.notFound.home)}</a> ${homes}</p>
  </div></section>`;
  return layout({
    t,
    lang: "nl",
    page: "home",
    title: `${t.notFound.title} · IGS-Pharma`,
    description: t.notFound.text,
    body,
    nav: false,
  });
}

export { home, legal, notFound };
