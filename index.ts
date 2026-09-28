import { JSDOM } from "jsdom";
import { ScrapingBeeDispatcher } from "./scrapingbee-dispatcher.ts";

// ScrapingBee owns the network layer, jsdom runs the page's JavaScript.
// render_js=false → ScrapingBee launches NO browser; jsdom hydrates
// locally → we launch NO browser either. Dynamic content, end to end, browserless.

const DYNAMIC_PAGE_TARGET = "https://quotes.toscrape.com/js/";

const API_KEY = process.env.SCRAPINGBEE_API_KEY;
if (!API_KEY) {
  console.error("Set SCRAPINGBEE_API_KEY (e.g. `SCRAPINGBEE_API_KEY=xxx npm start`).");
  process.exit(1);
}

// One session_id for the whole run → the follow-up requests the page fires
// (jquery.js, CSS, any XHR) keep the SAME IP + TLS fingerprint as the first one.
const SESSION_ID = Math.floor(Math.random() * 1_000_000);
const dispatcher = new ScrapingBeeDispatcher({ apiKey: API_KEY, sessionId: SESSION_ID });

// Initial shell: also via ScrapingBee, same session.
const shellUrl = new URL("https://app.scrapingbee.com/api/v1/");
shellUrl.searchParams.set("url", DYNAMIC_PAGE_TARGET);
shellUrl.searchParams.set("render_js", "false");
shellUrl.searchParams.set("session_id", String(SESSION_ID));
const res = await fetch(shellUrl, { headers: { Authorization: `Bearer ${API_KEY}` } });

const dom = new JSDOM(await res.text(), {
  runScripts: "dangerously",
  // Route jsdom's sub-resource loading through ScrapingBee too (same session_id),
  // so the page's own JS requests keep the same IP / fingerprint.
  resources: { dispatcher },
  url: DYNAMIC_PAGE_TARGET,
});

await new Promise<void>((resolve) =>
  dom.window.addEventListener("load", () => resolve())
);

const quotes = dom.window.document.querySelectorAll(".quote");

const result: { quotes: { author: string | null; quote: string | null }[] } = { quotes: [] };
for (const quote of quotes) {
  result.quotes.push({
    author: quote.querySelector(".author")?.textContent ?? null,
    quote: quote.querySelector(".text")?.textContent ?? null,
  });
}

console.log(`session_id=${SESSION_ID} · render_js=false · ${result.quotes.length} quotes`);
console.log(JSON.stringify(result, null, 2));
