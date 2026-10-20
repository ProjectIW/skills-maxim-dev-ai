#!/usr/bin/env node
// Замер нагрузки анимаций страницы: кадры в секунду и доля времени процессора
// главного потока. Типичный случай: фоновая анимация лендинга греет компьютеры
// посетителей; обычно помогают 30 кадров в секунду и половинное разрешение холста.
//
// Запуск:
//   CHROMIUM=/usr/bin/chromium-browser node measure-animation.mjs --url http://127.0.0.1:3100/ \
//     --seconds 10 --width 1440 --height 900 [--scroll 0]
// Ориентиры: доля CPU главного потока в покое страницы < 15 %, кадры – столько,
// сколько задумано (30 для фона), без провалов. Сравнивай «до» и «после» на одной машине.
// Безголовый Chromium без GPU рисует медленнее реального браузера: числа сравнительные.

import puppeteer from "puppeteer-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const url = args.url;
if (!url) {
  console.error("нужен --url");
  process.exit(2);
}
const seconds = Number(args.seconds ?? 10);
const width = Number(args.width ?? 1440);
const height = Number(args.height ?? 900);
const scroll = Number(args.scroll ?? 0);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium-browser",
  args: ["--no-sandbox", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  await page.bringToFront(); // фоновая вкладка не крутит requestAnimationFrame
  if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
  await new Promise((r) => setTimeout(r, 2000)); // прогрев

  const cdp = await page.target().createCDPSession();
  await cdp.send("Performance.enable");
  const metric = async () =>
    Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  await page.evaluate(() => {
    window.__frames = [];
    const tick = (t) => {
      window.__frames.push(t);
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  const before = await metric();
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const after = await metric();
  const wall = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__frames;
  });

  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const p95 = gaps.length ? gaps[Math.floor(gaps.length * 0.95)] : 0;
  const task = after.TaskDuration - before.TaskDuration;
  const script = after.ScriptDuration - before.ScriptDuration;
  const layout = after.LayoutDuration - before.LayoutDuration;
  const style = after.RecalcStyleDuration - before.RecalcStyleDuration;

  console.log(`страница: ${url} (${width}×${height}), окно замера ${wall.toFixed(1)} с`);
  console.log(`кадров в секунду: ${(frames.length / wall).toFixed(1)}; 95-й процентиль интервала: ${p95.toFixed(1)} мс`);
  console.log(`доля CPU главного потока: ${((task / wall) * 100).toFixed(1)} %`);
  console.log(`  скрипты ${((script / wall) * 100).toFixed(1)} %, раскладка ${((layout / wall) * 100).toFixed(1)} %, стили ${((style / wall) * 100).toFixed(1)} %`);
} finally {
  await browser.close();
}
