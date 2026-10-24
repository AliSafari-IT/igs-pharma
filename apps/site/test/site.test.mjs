// Checks the built site (run `node src/build.mjs` first; `pnpm test` does).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LANGS, languages } from "../src/content.mjs";
import { esc } from "../src/html.mjs";
import { routes } from "../src/render.mjs";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (name.endsWith(".html")) pages.push(file);
  }
})(dist);
const read = (file) => readFileSync(file, "utf8");
const fileFor = (urlPath) => join(dist, urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath);

test("every route is built, in all four languages", () => {
  for (const byLang of Object.values(routes)) {
    assert.deepEqual(Object.keys(byLang), LANGS);
    for (const path of Object.values(byLang))
      assert.ok(existsSync(fileFor(path)), `${path} is missing`);
  }
  assert.ok(existsSync(join(dist, "404.html")));
  assert.ok(existsSync(join(dist, "og.png")));
});

test("pages fit the CSP: no inline scripts, styles or style attributes, nothing from another origin", () => {
  for (const file of pages) {
    const html = read(file);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${file}: inline <script>`);
    assert.doesNotMatch(html, /<style[\s>]/, `${file}: inline <style>`);
    assert.doesNotMatch(html, /\sstyle="/, `${file}: style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${file}: inline event handler`);
    for (const [, url] of html.matchAll(/<(?:script|link|img|image)[^>]+(?:src|href)="([^"]+)"/g)) {
      assert.ok(
        url.startsWith("/") || url.startsWith("https://igs.asafarim.site"),
        `${file}: external resource ${url}`,
      );
    }
  }
});

test("internal links point at pages that exist", () => {
  for (const file of pages) {
    for (const [, href] of read(file).matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) {
      assert.ok(
        existsSync(fileFor(href)) || existsSync(join(dist, href)),
        `${file}: broken link ${href}`,
      );
    }
  }
});

test("in-page anchors exist on every home page", () => {
  for (const lang of LANGS) {
    const html = read(fileFor(routes.home[lang]));
    for (const [, id] of html.matchAll(/href="(?:\/(?:[a-z]{2}\/)?)?#([a-z-]+)"/g)) {
      assert.match(html, new RegExp(`id="${id}"`), `${lang}: #${id} has no target`);
    }
  }
});

test("each page has the right language and links to the same page in the other three", () => {
  for (const byLang of Object.values(routes)) {
    for (const [lang, path] of Object.entries(byLang)) {
      const html = read(fileFor(path));
      assert.match(html, new RegExp(`<html lang="${languages[lang].lang}">`), `${path}: lang`);
      assert.match(
        html,
        /<span class="lang is-current" aria-current="true">/,
        `${path}: current language`,
      );
      for (const other of LANGS.filter((l) => l !== lang)) {
        assert.match(
          html,
          new RegExp(`class="lang" href="${byLang[other]}"`),
          `${path}: switch to ${other}`,
        );
        assert.match(
          html,
          new RegExp(
            `hreflang="${languages[other].lang}" href="https://igs.asafarim.site${byLang[other]}"`,
          ),
        );
      }
    }
  }
});

test("all languages tell the same story", () => {
  const { nl } = languages;
  assert.equal(nl.app.steps.length, 6);
  for (const lang of LANGS) {
    const t = languages[lang];
    assert.equal(t.app.steps.length, nl.app.steps.length, lang);
    assert.equal(t.what.items.length, nl.what.items.length, lang);
    assert.equal(t.care.items.length, nl.care.items.length, lang);
    assert.equal(t.plan.steps.length, nl.plan.steps.length, lang);
    assert.equal(t.faq.items.length, nl.faq.items.length, lang);
    assert.equal(t.hero.chips.length, nl.hero.chips.length, lang);
    assert.equal(t.app.screen.results.length, nl.app.screen.results.length, lang);
    assert.equal(t.app.screen.categories.length, nl.app.screen.categories.length, lang);
  }
});

test("the phone has one scene per step, the first one shown", () => {
  for (const lang of LANGS) {
    const html = read(fileFor(routes.home[lang]));
    assert.equal((html.match(/class="scene[^"]*" data-scene=/g) ?? []).length, 6);
    assert.match(html, /class="scene is-active" data-scene="0"/);
    assert.equal((html.match(/data-step="/g) ?? []).length, 6);
  }
});

test("the page says plainly that nothing can be ordered yet, and never names a price as an offer outside the drawing", () => {
  for (const lang of LANGS) {
    const html = read(fileFor(routes.home[lang]));
    assert.ok(html.includes(esc(languages[lang].hero.note)), `${lang}: the "not open yet" note`);
    const outsidePhone = html.replace(/<svg class="phone"[\s\S]*?<\/svg>/, "");
    assert.doesNotMatch(
      outsidePhone,
      /€\s?\d|\d,\d\d\s?€/,
      `${lang}: a price outside the phone drawing`,
    );
  }
});

test("the legal pages exist in all languages, with the same sections, and the footer links them all", async () => {
  const legal = await import("../src/legal.mjs");
  for (const name of ["privacy", "cookies", "deletion"]) {
    for (const lang of LANGS) {
      assert.equal(
        legal[name][lang].sections.length,
        legal[name].nl.sections.length,
        `${name} ${lang}: section count`,
      );
    }
  }
  for (const lang of LANGS) {
    const html = read(fileFor(routes.home[lang]));
    for (const page of ["privacy", "cookies", "deletion"]) {
      assert.match(
        html,
        new RegExp(`<a href="${routes[page][lang]}">`),
        `${lang}: footer link to ${page}`,
      );
      assert.doesNotMatch(
        read(fileFor(routes[page][lang])),
        /\{\{/,
        `${lang} ${page}: unfilled placeholder`,
      );
    }
  }
});

test("the privacy policy matches what the app does: no account, nothing about the user leaves the phone", async () => {
  const { privacy } = await import("../src/legal.mjs");
  const en = JSON.stringify(privacy.en);
  for (const phrase of [
    "Search words and product codes",
    "My list",
    "No account",
    "advertising id",
  ]) {
    assert.ok(en.includes(phrase), `privacy (en) should mention ${phrase}`);
  }
});
