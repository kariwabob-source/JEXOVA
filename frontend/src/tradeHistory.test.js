import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("trade history filters database results, paginates, shows details, and renders an empty state", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#journal" }
  );
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent"];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const requests = [];
  let vite;
  let root;

  for (const name of globals) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === "window" ? dom.window
        : name === "document" ? dom.window.document
          : name === "navigator" ? dom.window.navigator
            : dom.window[name]
    });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === "/trade-summary") {
      return jsonResponse({
        total_trades: 2,
        open_trades: 0,
        closed_trades: 2,
        recorded_pnl: "50.00",
        recorded_pnl_by_currency: [{ currency: "EUR", amount: "50.00" }]
      });
    }
    if (url === "/trade-options") {
      return jsonResponse({
        accounts: [{ id: 7, name: "Test account", currency: "EUR" }],
        strategies: [{ id: 15, account_id: 7, name: "Breakout" }]
      });
    }
    if (String(url).startsWith("/trades?")) {
      const params = new URLSearchParams(String(url).split("?")[1]);
      if (params.get("search") === "MISS") {
        return jsonResponse({ data: [], total: 0, per_page: 10, current_page: 1, last_page: 1 });
      }
      const currentPage = Number(params.get("page") ?? 1);
      const perPage = Number(params.get("per_page") ?? 10);
      const trade = currentPage === 2 ? historyTrade(21) : historyTrade(20);
      return jsonResponse({
        data: [trade],
        total: 20,
        per_page: perPage,
        current_page: currentPage,
        last_page: Math.ceil(20 / perPage)
      });
    }
    if (/^\/trades\/\d+$/.test(url)) {
      const tradeId = Number(url.split("/").at(-1));
      return jsonResponse({
        data: {
          ...historyTrade(tradeId),
          account_name: "Test account",
          account_platform: "Paper",
          account_currency: "EUR",
          strategy_notes: "Breakout strategy notes",
          notes: null,
          created_at: "2026-11-15T10:00:00+00:00",
          updated_at: "2026-11-15T10:00:00+00:00"
        }
      });
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`);
  };

  try {
    const rootElement = dom.window.document.getElementById("root");
    rootElement.dataset.authenticated = "true";
    vite = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("..", import.meta.url)),
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
      optimizeDeps: { noDiscovery: true, entries: [] }
    });

    const [{ default: App }, React, { createRoot }] = await Promise.all([
      vite.ssrLoadModule("/src/App.jsx"),
      import("react"),
      import("react-dom/client")
    ]);

    root = createRoot(rootElement);
    await React.act(async () => {
      root.render(React.createElement(App));
      await flush();
    });

    assert.match(rootElement.textContent, /Trade History/);
    assert.doesNotMatch(rootElement.textContent, /No trades match this view\./);
    assert.deepEqual(
      [...rootElement.querySelectorAll("button[data-sort-field]")].map((button) => button.dataset.sortField),
      ["instrument", "trade_date", "direction", "lot_size", "r_multiple", "pnl", "status"]
    );
    assert.match(rootElement.querySelector("table thead").textContent, /Lot Size/);
    assert.doesNotMatch(rootElement.querySelector("table thead").textContent, /Position size/);

    const setControl = async (selector, value) => {
      const field = rootElement.querySelector(selector);
      const prototype = field instanceof dom.window.HTMLSelectElement
        ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
      await React.act(async () => {
        setter.call(field, value);
        field.dispatchEvent(new dom.window.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
        await flush();
      });
    };

    const tradeRequestsBeforeTyping = requests.filter(({ url }) => url.startsWith("/trades?")).length;
    await setControl('[aria-label="Search by instrument"]', "EURUSD");
    assert.equal(
      requests.filter(({ url }) => url.startsWith("/trades?")).length,
      tradeRequestsBeforeTyping,
      "search input does not request on every keystroke"
    );
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await setControl('[aria-label="Trade date from"]', "2026-11-01");
    await setControl('[aria-label="Trade date to"]', "2026-11-30");
    await setControl('[aria-label="Filter by strategy"]', "15");
    await setControl('[aria-label="Filter by direction"]', "short");
    await setControl('[aria-label="Filter by result"]', "winning");

    const filteredRequest = requests.filter(({ url }) => url.startsWith("/trades?")).at(-1);
    const filteredParams = new URLSearchParams(filteredRequest.url.split("?")[1]);
    assert.equal(filteredParams.get("search"), "EURUSD");
    assert.equal(filteredParams.get("from_date"), "2026-11-01");
    assert.equal(filteredParams.get("to_date"), "2026-11-30");
    assert.equal(filteredParams.get("strategy_id"), "15");
    assert.equal(filteredParams.get("side"), "short");
    assert.equal(filteredParams.get("outcome"), "winning");

    const instrumentSort = rootElement.querySelector('[data-sort-field="instrument"]');
    assert.ok(instrumentSort);
    await React.act(async () => {
      instrumentSort.click();
      await flush();
    });
    let sortedRequest = requests.filter(({ url }) => url.startsWith("/trades?")).at(-1);
    let sortedParams = new URLSearchParams(sortedRequest.url.split("?")[1]);
    assert.equal(sortedParams.get("sort"), "instrument");
    assert.equal(sortedParams.get("direction"), "asc");
    assert.equal(instrumentSort.closest("th").getAttribute("aria-sort"), "ascending");
    await React.act(async () => {
      instrumentSort.click();
      await flush();
    });
    sortedRequest = requests.filter(({ url }) => url.startsWith("/trades?")).at(-1);
    sortedParams = new URLSearchParams(sortedRequest.url.split("?")[1]);
    assert.equal(sortedParams.get("direction"), "desc");

    const nextPage = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Next");
    assert.ok(nextPage);
    await React.act(async () => {
      nextPage.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const pageTwoRequest = requests.filter(({ url }) => url.startsWith("/trades?")).at(-1);
    const pageTwoParams = new URLSearchParams(pageTwoRequest.url.split("?")[1]);
    assert.equal(pageTwoParams.get("page"), "2");
    assert.equal(pageTwoParams.get("strategy_id"), "15");
    assert.match(rootElement.textContent, /Page 2 of 2/);

    await setControl('[aria-label="Filter by position status"]', "closed");
    const filteredFromPageTwo = requests.filter(({ url }) => url.startsWith("/trades?")).at(-1);
    const filteredFromPageTwoParams = new URLSearchParams(filteredFromPageTwo.url.split("?")[1]);
    assert.equal(filteredFromPageTwoParams.get("page"), "1", "filter changes reset pagination");
    assert.equal(filteredFromPageTwoParams.get("status"), "closed");

    await React.act(async () => {
      nextPage.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flush();
    });
    assert.match(rootElement.textContent, /Page 2 of 2/);

    await setControl('[aria-label="Rows per page"]', "25");
    const resizedRequest = requests.filter(({ url }) => url.startsWith("/trades?")).at(-1);
    const resizedParams = new URLSearchParams(resizedRequest.url.split("?")[1]);
    assert.equal(resizedParams.get("per_page"), "25");
    assert.equal(resizedParams.get("page"), "1", "changing page size resets pagination");

    const viewDetails = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "View details");
    assert.ok(viewDetails);
    await React.act(async () => {
      viewDetails.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flush();
    });
    assert.match(rootElement.textContent, /Breakout strategy notes/);
    assert.match(rootElement.textContent, /\+€25\.00/);
    assert.match(rootElement.textContent, /1\.10000/);
    assert.match(rootElement.textContent, /0\.25/);
    assert.match(rootElement.textContent, /\+1\.25R/);
    assert.match(rootElement.textContent, /No trade notes yet/);
    assert.ok(rootElement.querySelector('[aria-label="Trade notes"]'));
    assert.ok(requests.some(({ url }) => /^\/trades\/\d+$/.test(url)));

    await setControl('[aria-label="Search by instrument"]', "MISS");
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    assert.match(rootElement.textContent, /No trades match this view\./);
    assert.match(rootElement.textContent, /Page 1 of 1/);
  } finally {
    if (root) {
      const React = await import("react");
      await React.act(async () => root.unmount());
    }
    if (vite) await vite.close();
    dom.window.close();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    if (previousFetch) Object.defineProperty(globalThis, "fetch", previousFetch);
    else delete globalThis.fetch;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

function historyTrade(id) {
  return {
    id,
    account_id: 7,
    strategy_id: 15,
    external_id: `history-${id}`,
    symbol: "EURUSD",
    side: id === 21 ? "short" : "long",
    trading_session: "London",
    opened_at: "2026-11-15T09:00",
    closed_at: "2026-11-15T10:00",
    entry_price: "1.10000000",
    exit_price: "1.11000000",
    quantity: "0.25000000",
    pnl: "25.00",
    r_multiple: "1.2500",
    status: "closed",
    strategy_name: "Breakout",
    account_currency: "EUR"
  };
}

function jsonResponse(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
