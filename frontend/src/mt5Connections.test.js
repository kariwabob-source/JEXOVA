import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("MT5 settings discovers the local connector, pairs, confirms, syncs, and disconnects", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#settings" }
  );
  dom.window.confirm = () => true;
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent"];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const requests = [];
  let connectionReads = 0;
  let localConnectorAvailable = false;
  let confirmed = false;
  let revoked = false;
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
    if (url === "/trade-options") {
      return jsonResponse({ accounts: [], strategies: [] });
    }
    if (url === "http://127.0.0.1:47620/health") {
      return jsonResponse({ data: { status: localConnectorAvailable ? "ready" : "unavailable" } });
    }
    if (url === "http://127.0.0.1:47620/pair" && options.method === "POST") {
      return jsonResponse({
        data: {
          connection_id: 31,
          login_masked: "****5678",
          server: "Broker-Demo",
          account_type: "demo",
          currency: "USD",
          balance: "10000.25",
          equity: "10025.50",
          leverage: 100
        }
      });
    }
    if (url === "http://127.0.0.1:47620/disconnect" && options.method === "POST") {
      return jsonResponse({ data: { status: "disconnected" } });
    }
    if (url === "/mt5/connections") {
      connectionReads += 1;
      if (revoked) return jsonResponse({ data: [revokedConnection] });
      if (confirmed) return jsonResponse({ data: [connectedConnection] });
      return jsonResponse({ data: connectionReads === 1 ? [] : [pendingConnection] });
    }
    if (url === "/mt5/pairings" && options.method === "POST") {
      return jsonResponse({
        data: {
          connection_id: 31,
          pairing_code: "a".repeat(64),
          expires_at: "2026-11-15T12:10:00+00:00"
        }
      }, 201);
    }
    if (url === "/mt5/connections/31/confirm" && options.method === "POST") {
      confirmed = true;
      return jsonResponse({ data: { status: "connected" } });
    }
    if (url === "/mt5/connections/31/sync" && options.method === "POST") {
      return jsonResponse({ data: { id: 8, status: "queued" } }, 202);
    }
    if (url === "/mt5/connections/31/revoke" && options.method === "POST") {
      revoked = true;
      return { status: 204, ok: true, json: async () => null };
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

    assert.match(rootElement.textContent, /MT5 Account Integration/);
    assert.match(rootElement.textContent, /Local connector: Not detected/);
    assert.match(rootElement.textContent, /Install the Windows connector/);
    assert.equal(
      [...rootElement.querySelectorAll("button")].find((button) => button.textContent.trim() === "Connect Trading Account").disabled,
      true
    );
    localConnectorAvailable = true;
    await clickButton(rootElement, React, "Check connector");
    assert.match(rootElement.textContent, /Local connector: Available/);
    const nameInput = rootElement.querySelector("#mt5-account-name");
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await React.act(async () => {
      setter.call(nameInput, "My demo account");
      nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await flush();
    });

    await clickButton(rootElement, React, "Connect Trading Account");
    assert.match(rootElement.textContent, /Confirm Trading Account/);
    assert.match(rootElement.textContent, /Account detected: \*\*\*\*5678/);
    assert.doesNotMatch(rootElement.textContent, /a{64}/);
    const pairingRequest = requests.find(({ url, options }) => url === "/mt5/pairings" && options.method === "POST");
    assert.deepEqual(JSON.parse(pairingRequest.options.body), { account_name: "My demo account" });

    await clickButton(rootElement, React, "Confirm Trading Account");
    assert.match(rootElement.textContent, /Account Status/);
    await clickButton(rootElement, React, "Synchronize Now");
    assert.match(rootElement.textContent, /Synchronization queued/);
    assert.ok(requests.some(({ url, options }) => url === "/mt5/connections/31/sync" && options.method === "POST"));

    await clickButton(rootElement, React, "Disconnect Account");
    assert.match(rootElement.textContent, /Trading account disconnected/);
    assert.match(rootElement.textContent, /Disconnected/);
    assert.ok(requests.some(({ url, options }) => url === "/mt5/connections/31/revoke" && options.method === "POST"));
    assert.ok(requests.some(({ url, options }) => url === "http://127.0.0.1:47620/pair" && options.method === "POST"));
    assert.ok(requests.some(({ url, options }) => url === "http://127.0.0.1:47620/disconnect" && options.method === "POST"));
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

const pendingConnection = {
  id: 31,
  account_name: "My demo account",
  status: "pending_confirmation",
  login_masked: null,
  server: null,
  currency: null,
  balance: null,
  equity: null,
  leverage: null,
  is_demo: false,
  account_type: null,
  last_sync_at: null,
  last_error_code: null,
  latest_sync: null
};

const connectedConnection = {
  ...pendingConnection,
  status: "connected",
  login_masked: "****5678",
  server: "Broker-Demo",
  currency: "USD",
  balance: "10000.25000000",
  equity: "10025.50000000",
  leverage: 100,
  is_demo: true,
  account_type: "demo"
};

const revokedConnection = {
  ...pendingConnection,
  status: "revoked"
};

async function clickButton(rootElement, React, label) {
  const button = [...rootElement.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.trim() === label);
  assert.ok(button, `Expected a "${label}" button`);
  await React.act(async () => {
    button.dispatchEvent(new domMouseEvent(button));
    await flush();
  });
}

function domMouseEvent(button) {
  return new button.ownerDocument.defaultView.MouseEvent("click", { bubbles: true });
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
