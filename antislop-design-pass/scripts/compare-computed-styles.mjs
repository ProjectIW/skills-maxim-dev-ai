#!/usr/bin/env node
// Сравнение вычисленных стилей двух сборок одной страницы (прод-сборка против dev
// или старый образ против нового). Ловит то, что не видно в коде: минификатор CSS
// переставил или склеил объявления (например, gap и row-gap), потерялся шрифт.
//
// Запуск (node 18+, puppeteer-core, Chromium):
//   CHROMIUM=/usr/bin/chromium-browser node compare-computed-styles.mjs \
//     --a http://127.0.0.1:3100/ --b http://127.0.0.1:3101/ \
//     --prefix hero-,card-,price- --widths 1440,1280,390
// Вместо --prefix можно --selectors ".hero,.pricing .card".
// Выход: список различий «ширина | элемент | свойство | a | b», код 1 при различиях.

import puppeteer from "puppeteer-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const A = args.a, B = args.b;
if (!A || !B) {
  console.error("нужны --a и --b");
  process.exit(2);
}
const prefixes = (args.prefix ?? "").split(",").filter(Boolean);
const selectors = (args.selectors ?? "").split(",").filter(Boolean);
const widths = (args.widths ?? "1440,1280,390").split(",").map(Number);
const waitMs = Number(args.wait ?? 1500);

const PROPS = [
  "display", "position", "box-sizing", "width", "height", "max-width",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "gap", "row-gap", "column-gap", "grid-template-columns", "grid-template-rows", "flex-direction", "align-items", "justify-content",
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "font-variant-numeric",
  "color", "background-color", "border-radius", "border-top-width", "opacity", "transform", "z-index", "overflow",
];

async function snapshot(browser, url, width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, waitMs));
  const data = await page.evaluate(
    (prefixes, selectors, props) => {
      const pick = new Set();
      if (selectors.length) selectors.forEach((s) => document.querySelectorAll(s).forEach((el) => pick.add(el)));
      if (prefixes.length)
        document.querySelectorAll("[class]").forEach((el) => {
          if ([...el.classList].some((c) => prefixes.some((p) => c.startsWith(p)))) pick.add(el);
        });
      const seen = new Map();
      const out = {};
      for (const el of pick) {
        const base = `${el.tagName.toLowerCase()}.${[...el.classList].sort().join(".")}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const cs = getComputedStyle(el);
        out[`${base}#${n}`] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
      }
      return out;
    },
    prefixes,
    selectors,
    PROPS,
  );
  await page.close();
  return data;
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
});
let diffs = 0;
try {
  for (const w of widths) {
    const [a, b] = [await snapshot(browser, A, w), await snapshot(browser, B, w)];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!a[k] || !b[k]) {
        console.log(`${w}\t${k}\t(элемент есть только в ${a[k] ? "a" : "b"})`);
        diffs++;
        continue;
      }
      for (const p of PROPS) {
        if (a[k][p] !== b[k][p]) {
          // округление в 1px между сборками – шум, не различие
          const na = parseFloat(a[k][p]), nb = parseFloat(b[k][p]);
          if (!Number.isNaN(na) && !Number.isNaN(nb) && Math.abs(na - nb) <= 1 && /px$/.test(a[k][p])) continue;
          console.log(`${w}\t${k}\t${p}\t${a[k][p]}\t${b[k][p]}`);
          diffs++;
        }
      }
    }
    console.error(`ширина ${w}: элементов a=${Object.keys(a).length}, b=${Object.keys(b).length}`);
  }
} finally {
  await browser.close();
}
console.error(diffs ? `различий: ${diffs}` : "различий нет");
process.exit(diffs ? 1 : 0);
