import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("trade notes save, survive an app refresh, and delete without deleting the trade", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#journal" }
  );
  const globals = [
    "window", "document", "navigator", "HTMLElement", "HTMLInputElement",
    "HTMLSelectElement", "HTMLTextAreaElement", "Event", "MouseEvent"
  ];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const requests = [];
  let storedNotes = null;
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
    const requestUrl = String(url);
    requests.push({ url: requestUrl, options });
    if (requestUrl === "/trade-summary") {
      return jsonResponse({
        total_trades: 1,
        open_trades: 0,
        closed_trades: 1,
        recorded_pnl: "25.00",
        recorded_pnl_by_currency: [{ currency: "USD", amount: "25.00" }]
      });
    }
    if (requestUrl === "/trade-options") {
      return jsonResponse({ accounts: [{ id: 7, name: "Test account", currency: "USD" }], strategies: [] });
    }
    if (requestUrl.startsWith("/trades?")) {
      return jsonResponse({
        data: [historyTrade()],
        total: 1,
        per_page: 10,
        current_page: 1,
        last_page: 1
      });
    }
    if (requestUrl === "/trades/42" && options.method !== "PUT") {
      return jsonResponse({
        data: {
          ...historyTrade(),
          account_name: "Test account",
          account_platform: "Paper",
          account_currency: "USD",
          strategy_notes: null,
          notes: storedNotes,
          created_at: "2026-11-15T10:00:00+00:00",
          updated_at: "2026-11-15T10:00:00+00:00"
        }
      });
    }
    if (requestUrl === "/trades/42/notes" && options.method === "PUT") {
      const body = JSON.parse(options.body);
      storedNotes = body.notes || null;
      return jsonResponse({ data: { id: 42, notes: storedNotes } });
    }
    if (requestUrl === "/trades/42/notes" && options.method === "DELETE") {
      storedNotes = null;
      return jsonResponse(null, 204);
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${requestUrl}`);
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

    const mount = async () => {
      root = createRoot(rootElement);
      await React.act(async () => {
        root.render(React.createElement(App));
        await flush();
      });
    };
    const openDetails = async () => {
      const button = [...rootElement.querySelectorAll("button")]
        .find((item) => item.textContent.trim() === "View details");
      assert.ok(button, "the trade should remain in the history list");
      await React.act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
        await flush();
      });
    };

    await mount();
    await openDetails();
    assert.match(rootElement.textContent, /No trade notes yet/);
    assert.equal(rootElement.querySelector('[aria-label="Trade notes"]').value, "");

    const field = rootElement.querySelector('[aria-label="Trade notes"]');
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
    await React.act(async () => {
      setter.call(field, "Waited for confirmation.");
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const notesForm = rootElement.querySelector(".trade-notes-editor form");
    await React.act(async () => {
      notesForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });

    const saveRequest = requests.find(({ url, options }) => url === "/trades/42/notes" && options.method === "PUT");
    assert.ok(saveRequest);
    assert.deepEqual(JSON.parse(saveRequest.options.body), { notes: "Waited for confirmation." });
    assert.equal(storedNotes, "Waited for confirmation.");
    assert.match(rootElement.textContent, /Trade notes saved/);
    assert.match(rootElement.textContent, /EURUSD/);
    assert.match(rootElement.textContent, /1\.10000/);

    await React.act(async () => root.unmount());
    await mount();
    await openDetails();
    assert.equal(rootElement.querySelector('[aria-label="Trade notes"]').value, "Waited for confirmation.");

    dom.window.confirm = () => true;
    const deleteButton = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Delete notes");
    assert.ok(deleteButton);
    await React.act(async () => {
      deleteButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flush();
    });
    assert.equal(storedNotes, null);
    assert.match(rootElement.textContent, /No trade notes yet/);
    assert.ok(rootElement.querySelector(".symbol-link"), "deleting notes must leave the trade in history");
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

function historyTrade() {
  return {
    id: 42,
    account_id: 7,
    strategy_id: null,
    external_id: "history-42",
    symbol: "EURUSD",
    side: "long",
    trading_session: "London",
    opened_at: "2026-11-15T09:00",
    closed_at: "2026-11-15T10:00",
    entry_price: "1.10000000",
    exit_price: "1.11000000",
    quantity: "0.25000000",
    pnl: "25.00",
    r_multiple: "1.2500",
    status: "closed",
    strategy_name: null,
    account_currency: "USD"
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
