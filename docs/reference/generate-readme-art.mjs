// Rebuild the self-contained README artwork after installing the workspace:
// node docs/reference/generate-readme-art.mjs
// Text is rendered from the bundled brand fonts; the SVG decorations stay animated.
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../agent/package.json", import.meta.url));
const { chromium } = require("playwright");
const directory = new URL("./", import.meta.url);
const fonts = await Promise.all([
  ["Quicksand", "quicksand-normal.ttf", "300 700"],
  ["Plus Jakarta Sans", "plus-jakarta-sans-normal.ttf", "200 800"],
].map(async ([family, file, weight]) => {
  const bytes = await fs.readFile(new URL(`../../frontend/public/fonts/${file}`, import.meta.url));
  return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${bytes.toString("base64")}) format('truetype');font-weight:${weight};}`;
}));

const motion = `
  .float{animation:float 7s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  .float-late{animation-delay:-3.5s}
  .twinkle{animation:twinkle 5.5s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  .wave{animation:wave 1.9s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  .shine{animation:shine 9s ease-in-out infinite}
  .bloom{animation:bloom 7s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  @keyframes float{0%,100%{transform:translateY(3px)}50%{transform:translateY(-5px)}}
  @keyframes twinkle{0%,100%{opacity:.5;transform:scale(.85)}50%{opacity:1;transform:scale(1.08)}}
  @keyframes wave{0%,100%{transform:scaleY(.6)}50%{transform:scaleY(1)}}
  @keyframes shine{0%,8%{transform:translateX(-300px)}42%,100%{transform:translateX(1700px)}}
  @keyframes bloom{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
  @media(prefers-reduced-motion:reduce){.float,.twinkle,.wave,.shine,.bloom{animation:none}.shine{display:none}}
`;

const blinking = `
  .blink{animation:blink 6.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
  .blink-late{animation-duration:7.4s;animation-delay:-2.1s}
  @keyframes blink{0%,42%,46%,100%{transform:scaleY(1)}44%{transform:scaleY(.08)}}
  @media(prefers-reduced-motion:reduce){.blink{animation:none}}
`;

const showcase = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="260" viewBox="0 0 1120 260" role="img" aria-labelledby="title desc">
  <title id="title">Step inside the Relaya showcase</title>
  <desc id="desc">A little peek into our world. Meet RELAYA, made by Team ANNERA.</desc>
  <defs>
    <linearGradient id="paper" x2="1" y2="1"><stop stop-color="#FFF8F3"/><stop offset="1" stop-color="#FCE5E8"/></linearGradient>
    <clipPath id="button"><rect x="730" y="105" width="300" height="64" rx="32"/></clipPath>
    <linearGradient id="sheen"><stop stop-color="#FFFDF9" stop-opacity="0"/><stop offset=".5" stop-color="#FFFDF9" stop-opacity=".65"/><stop offset="1" stop-color="#FFFDF9" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="2" y="2" width="1116" height="256" rx="30" fill="url(#paper)" stroke="#F3A6B5" stroke-opacity=".45"/>
  <rect x="18" y="18" width="1084" height="224" rx="22" fill="none" stroke="#F3A6B5" stroke-dasharray="2 8" stroke-linecap="round"/>
  <circle cx="1065" cy="25" r="111" fill="#F7D7A8" opacity=".2"/>
  <g font-family="'Plus Jakarta Sans',sans-serif" fill="#443A41">
    <text x="64" y="63" font-size="12" letter-spacing="2.5" fill="#7B6F76">THE RELAYA SHOWCASE</text>
    <text x="64" y="121" font-family="Quicksand,sans-serif" font-size="43" font-weight="700">a little peek into our world.</text>
    <text x="66" y="159" font-size="18" fill="#7B6F76">Meet the idea. Explore the experience.</text>
    <text x="66" y="205" font-size="12" letter-spacing="1.5" fill="#7B6F76">MADE BY TEAM ANNERA</text>
    <rect x="730" y="105" width="300" height="64" rx="32" fill="#F3A6B5"/>
    <text x="863" y="144" text-anchor="middle" font-size="18" font-weight="650">step inside the showcase</text>
  </g>
  <path d="M996 131l6 6-6 6m-12-6h17" fill="none" stroke="#443A41" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <g clip-path="url(#button)"><g class="shine"><path d="M-180 80H-90L-25 190H-115Z" fill="url(#sheen)"/></g></g>
  <g class="twinkle"><path d="M1051 55Q1054 70 1069 73Q1054 76 1051 91Q1048 76 1033 73Q1048 70 1051 55Z" fill="#D79A4A"/></g>
  <g class="float float-late"><path d="M663 185C639 169 650 154 663 166C676 154 687 169 663 185Z" fill="#FF6B8B" opacity=".65"/></g>
</svg>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 460 }, deviceScaleFactor: 2 });
  const sources = [
    ["banner", "readme-hero.svg", 1280, 460],
    ["say", "readme-say-animated.svg", 440, 400],
    ["speak", "readme-speak-animated.svg", 440, 400],
    ["palette", "readme-footer-animated.svg", 1280, 150],
    ["showcase", "readme-showcase.svg", 1120, 260],
  ];

  for (const [kind, output, width, height] of sources) {
    const source = kind === "showcase" ? showcase : await fs.readFile(new URL(`readme-${kind}.svg`, directory), "utf8");
    await page.setViewportSize({ width, height });
    await page.setContent(`<style>${fonts.join("")}html,body{margin:0;background:transparent}svg{display:block}</style>${source}`);
    await page.evaluate(async () => {
      await Promise.all([document.fonts.load("700 128px Quicksand"), document.fonts.load('400 18px "Plus Jakarta Sans"')]);
      await document.fonts.ready;
    });
    if (kind === "showcase") {
      await page.locator("body>svg").screenshot({ path: fileURLToPath(new URL("readme-showcase.png", directory)), omitBackground: true });
    }

    // Bake only typography into a transparent layer. SVG images cannot depend on
    // external fonts on GitHub; the illustrations and motion remain native vectors.
    const textLayer = await page.evaluate(() => {
      const root = document.querySelector("body>svg");
      const clone = root.cloneNode(false);
      for (const text of root.querySelectorAll("text")) {
        const node = text.cloneNode(true);
        const computed = getComputedStyle(text);
        for (const property of ["font-family", "font-size", "font-weight", "letter-spacing", "text-anchor", "fill"]) node.setAttribute(property, computed.getPropertyValue(property));
        clone.append(node);
      }
      return clone.outerHTML;
    });
    await page.setContent(`<style>${fonts.join("")}html,body{margin:0;background:transparent}svg{display:block}</style>${textLayer}`);
    await page.evaluate(() => document.fonts.ready);
    const typography = (await page.locator("body>svg").screenshot({ omitBackground: true })).toString("base64");

    let titleMask;
    if (kind === "banner") {
      await page.evaluate(() => {
        const root = document.querySelector("body>svg");
        for (const node of [...root.querySelectorAll("text")]) {
          if (!node.textContent.startsWith("RELAYA")) node.remove();
          else { node.setAttribute("fill", "white"); for (const span of node.querySelectorAll("tspan")) span.setAttribute("fill", "white"); }
        }
      });
      titleMask = (await page.locator("body>svg").screenshot({ omitBackground: true })).toString("base64");
    }

    await page.setContent(source);
    const result = await page.evaluate(({ kind, typography, titleMask, motion, width, height }) => {
      const root = document.querySelector("body>svg");
      const ns = "http://www.w3.org/2000/svg";
      const make = (tag, attrs = {}) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
      const wrap = (node, className, delay) => {
        const group = make("g", { class: className });
        if (delay) group.setAttribute("style", `animation-delay:${delay}s`);
        node.before(group); group.append(node); return group;
      };
      root.querySelectorAll("text").forEach(node => node.remove());
      const style = make("style"); style.textContent = motion; root.prepend(style);
      root.append(make("image", { width, height, href: `data:image/png;base64,${typography}` }));

      if (kind === "banner") {
        const desc = root.querySelector("desc");
        desc.textContent = "RELAYA in Quicksand with a gentle title shine, floating speech bubbles with blinking eyes, and twinkling flowers. Made by Team ANNERA. Motion pauses when reduced motion is requested.";
        wrap(root.querySelector("#blush-eyes"), "blink");
        wrap(root.querySelector("#peach-eyes"), "blink blink-late");
        for (const [i, node] of [...root.querySelectorAll(':scope>g[transform^="translate("]')].entries()) wrap(node, i ? "float float-late" : "float");
        for (const [i, node] of [...root.querySelectorAll(':scope>use[href="#sparkle"],:scope>use[href="#heart"]')].entries()) wrap(node, "twinkle", -i * 1.2);
        root.querySelectorAll(':scope>use[href="#flower"]').forEach((node, i) => wrap(node, "bloom", -i * 2));
        const defs = root.querySelector("defs");
        const mask = make("mask", { id: "title-shine", maskUnits: "userSpaceOnUse", x: 0, y: 0, width, height, "mask-type": "alpha" });
        mask.append(make("image", { width, height, href: `data:image/png;base64,${titleMask}` })); defs.append(mask);
        const gradient = make("linearGradient", { id: "title-light" });
        for (const [offset, opacity] of [[0, 0], [.5, .7], [1, 0]]) gradient.append(make("stop", { offset, "stop-color": "#FFFDF9", "stop-opacity": opacity })); defs.append(gradient);
        const clipped = make("g", { mask: "url(#title-shine)" }); const sweep = make("g", { class: "shine" });
        sweep.append(make("path", { d: "M-180 120H-70L20 265H-90Z", fill: "url(#title-light)" })); clipped.append(sweep); root.append(clipped);
      }
      if (kind === "say") {
        const bars = [...root.querySelectorAll("svg rect")].filter(node => [162,171,180,189,198,207,216,225].includes(Number(node.getAttribute("x"))) && Number(node.getAttribute("width")) === 5);
        bars.forEach((node, i) => wrap(node, "wave", -i * .2));
      }
      if (kind === "speak") {
        root.querySelectorAll('g[transform="translate(300,6)"] rect').forEach((node, i) => wrap(node, "wave", -i * .3));
      }
      if (kind === "palette") {
        const heart = root.querySelector('path[fill="#F3A6B5"]'); if (heart) wrap(heart, "float");
      }
      return root.outerHTML;
    }, { kind, typography, titleMask, motion: kind === "banner" ? motion + blinking : motion, width, height });
    await fs.writeFile(new URL(output, directory), `${result.replace(/[\t ]+$/gm, "")}\n`);
    console.log(`Built ${fileURLToPath(new URL(output, directory))}`);
  }
} finally {
  await browser.close();
}
