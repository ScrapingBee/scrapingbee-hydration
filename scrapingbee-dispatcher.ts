import { Dispatcher } from "undici";

/**
 * Undici Dispatcher that routes every request jsdom makes through the
 * ScrapingBee HTML API, so ScrapingBee owns the whole network layer
 * (proxy IP, headers, TLS/fingerprint, anti-bot) while jsdom does the JS
 * hydration locally — no browser on either side.
 *
 * Key parameters:
 *   - render_js=false : ScrapingBee does NOT spin up a headless browser
 *     (1 credit instead of 5). We run the JS ourselves in jsdom.
 *   - session_id      : keep the same IP *and* TLS fingerprint across the
 *     follow-up requests the page fires as it loads (jquery.js, CSS, any XHR),
 *     so they all share the identity of the first request instead of scattering
 *     across rotating IPs/fingerprints mid-render.
 */
export class ScrapingBeeDispatcher extends Dispatcher {
  #apiKey: string;
  #sessionId: number;
  #premiumProxy: boolean;

  constructor(opts: { apiKey: string; sessionId: number; premiumProxy?: boolean }) {
    super();
    this.#apiKey = opts.apiKey;
    this.#sessionId = opts.sessionId;
    this.#premiumProxy = opts.premiumProxy ?? false;
  }

  #wrap(targetUrl: string): string {
    const u = new URL("https://app.scrapingbee.com/api/v1/");
    u.searchParams.set("url", targetUrl);
    u.searchParams.set("render_js", "false");      // no browser on ScrapingBee's side
    u.searchParams.set("session_id", String(this.#sessionId)); // same IP + fingerprint
    if (this.#premiumProxy) u.searchParams.set("premium_proxy", "true");
    return u.toString();
  }

  override dispatch(opts: any, handler: any): boolean {
    const targetUrl: string = opts.opaque?.url ?? `${opts.origin}${opts.path}`;
    const proxied = this.#wrap(targetUrl);

    const ac = new AbortController();
    handler.onConnect?.((reason: unknown) => ac.abort(reason));

    fetch(proxied, {
      method: "GET", // ScrapingBee fetches the target; jsdom sub-resources are GETs
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      redirect: "manual",
      signal: ac.signal,
    })
      .then(async (res) => {
        const rawHeaders: Buffer[] = [];
        for (const [k, v] of res.headers) {
          rawHeaders.push(Buffer.from(k), Buffer.from(v));
        }
        handler.onHeaders?.(res.status, rawHeaders, () => {}, res.statusText);

        const body = res.body;
        if (body) {
          const reader = body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) handler.onData?.(Buffer.from(value));
          }
        }
        handler.onComplete?.([]);
      })
      .catch((err) => {
        handler.onError?.(err instanceof Error ? err : new Error(String(err)));
      });

    return true;
  }
}
