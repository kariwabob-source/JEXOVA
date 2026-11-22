import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("dashboard renders database trades and a real empty state", async () => {
  await withDashboard([{
    id: 501,
    account_id: 7,
    strategy_id: null,
    external_id: "db-trade-501",
    symbol: "DBONLY",
    side: "long",
    trading_session: "Test",
    opened_at: "2026-10-10T09:00:00",
    closed_at: "2026-10-10T10:00:00",
    entry_price: "1.10000000",
    exit_price: "1.11000000",
    quantity: "0.10000000",
    pnl: "42.50",
    r_multiple: null,
    status: "closed",
    strategy_name: null,
    account_currency: "USD"
  }], (rootElement) => {
    assert.match(rootElement.textContent, /DBONLY/);
    assert.match(rootElement.textContent, /Recorded P&L/);
    assert.match(rootElement.textContent, /\+\$42\.50/);
    assert.match(rootElement.textContent, /MT5-reported account balances/);
    assert.match(rootElement.textContent, /\$10,000\.25/);
    assert.match(rootElement.textContent, /Database-backed/);
    assert.doesNotMatch(rootElement.textContent, /Sample data|Sample account|EURUSD/);
  }, [{
    id: 8,
    account_name: "Linked trading account",
    balance: "10000.25",
    currency: "USD"
  }]);

  await withDashboard([], (rootElement) => {
    assert.match(rootElement.textContent, /No trades have been recorded yet\./);
    assert.match(rootElement.textContent, /\$0\.00/);
    assert.doesNotMatch(rootElement.textContent, /Sample data|Sample account/);
  });
});

async function withDashboard(trades, assertion, connections = []) {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#dashboard" }
  );
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent"];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
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
  globalThis.fetch = async (url) => {
    if (url === "/trade-summary") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          recorded_pnl_by_currency: trades.length
            ? [{ currency: trades[0].account_currency, amount: trades[0].pnl }]
            : [{ currency: "USD", amount: "0.00" }]
        })
      };
    }
    if (String(url).startsWith("/trades?")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: trades, current_page: 1, last_page: 1 })
      };
    }
    if (url === "/mt5/connections") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: connections })
      };
    }
    throw new Error(`Unexpected request: ${url}`);
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assertion(rootElement);
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
}
