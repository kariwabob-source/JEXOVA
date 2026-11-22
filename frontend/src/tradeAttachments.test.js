import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("trade image fields preview and submit optional attachments as multipart form data", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#journal" }
  );
  const globals = [
    "window", "document", "navigator", "HTMLElement", "HTMLInputElement",
    "HTMLSelectElement", "HTMLTextAreaElement", "Event", "MouseEvent", "FormData"
  ];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  const requests = [];
  let vite;
  let root;

  URL.createObjectURL = () => "blob:trade-preview";
  URL.revokeObjectURL = () => {};
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
        total_trades: 0,
        open_trades: 0,
        closed_trades: 0,
        recorded_pnl: "0.00",
        recorded_pnl_by_currency: [{ currency: "USD", amount: "0.00" }]
      });
    }
    if (url === "/trade-options") {
      return jsonResponse({ accounts: [{ id: 7, name: "Test account", currency: "USD" }], strategies: [] });
    }
    if (String(url).startsWith("/trades?")) {
      return jsonResponse({ data: [], total: 0, per_page: 10, current_page: 1, last_page: 1 });
    }
    if (url === "/trades" && options.method === "POST") {
      return jsonResponse({
        data: {
          id: 88,
          account_id: 7,
          strategy_id: null,
          strategy_name: null,
          strategy_notes: null
        }
      }, 201);
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

    const addTrade = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Add Trade");
    await React.act(async () => {
      addTrade.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    const beforeInput = rootElement.querySelector('[aria-label="Before Trade image"]');
    const afterInput = rootElement.querySelector('[aria-label="After Trade image"]');
    assert.equal(beforeInput.accept, "image/png,image/jpeg");
    assert.equal(afterInput.accept, "image/png,image/jpeg");

    const beforeFile = new dom.window.File(["png"], "before.png", { type: "image/png" });
    const afterFile = new dom.window.File(["jpg"], "after.jpg", { type: "image/jpeg" });
    await chooseFile(beforeInput, beforeFile, React, dom);
    await chooseFile(afterInput, afterFile, React, dom);
    assert.equal(rootElement.querySelectorAll('.trade-image-preview[src="blob:trade-preview"]').length, 2);

    const form = rootElement.querySelector(".trade-editor");
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });

    const request = requests.find(({ url, options }) => url === "/trades" && options.method === "POST");
    assert.ok(request);
    assert.equal(request.options.body instanceof dom.window.FormData, true);
    assert.equal(request.options.body.get("before_image").name, "before.png");
    assert.equal(request.options.body.get("after_image").name, "after.jpg");
    assert.equal(request.options.headers["Content-Type"], undefined, "the browser sets the multipart boundary");
    assert.match(rootElement.textContent, /Trade saved successfully/);
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
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

async function chooseFile(input, file, React, dom) {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await React.act(async () => {
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
  });
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
