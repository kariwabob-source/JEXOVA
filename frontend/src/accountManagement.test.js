import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("manual Prop Firm account is registered in Settings and immediately selectable for trades", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#settings" }
  );
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Event", "MouseEvent"];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const requests = [];
  let accountCreationCount = 0;
  let createdAccount = null;
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
  dom.window.scrollTo = () => {};
  dom.window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === "/trade-options") {
      return jsonResponse({ accounts: createdAccount ? [createdAccount] : [], strategies: [] });
    }
    if (url === "/mt5/connections") return jsonResponse({ data: [] });
    if (url === "http://127.0.0.1:47620/health") {
      return jsonResponse({ data: { status: "unavailable" } });
    }
    if (url === "/accounts" && options.method === "POST") {
      accountCreationCount += 1;
      if (accountCreationCount > 1) {
        return {
          ok: false,
          status: 404,
          json: async () => { throw new SyntaxError("Unexpected end of JSON input"); }
        };
      }
      const payload = JSON.parse(options.body);
      createdAccount = {
        id: 31,
        name: payload.name,
        account_type: payload.account_type,
        broker_name: payload.broker_name,
        platform: payload.platform,
        connection_method: payload.connection_method,
        currency: payload.currency,
        starting_balance: payload.starting_balance,
        nominal_account_size: payload.nominal_account_size,
        challenge_phase: payload.challenge_phase,
        connection_status: "manual",
        synchronization_status: null
      };
      return jsonResponse({ data: createdAccount }, 201);
    }
    if (String(url).startsWith("/trades?")) {
      return jsonResponse({ data: [], total: 0, per_page: 10, current_page: 1, last_page: 1 });
    }
    if (url === "/trade-summary") {
      return jsonResponse({
        total_trades: 0,
        open_trades: 0,
        closed_trades: 0,
        recorded_pnl: "0.00",
        recorded_pnl_by_currency: []
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

    await clickButton(rootElement, React, "Add Account");
    let form = rootElement.querySelector(".account-registration-form");
    assert.ok(form, "Settings should open the manual account form");
    assert.equal(form.elements.namedItem("account_type").value, "", "account type is optional by default");
    assert.equal(form.elements.namedItem("account_type").required, false);
    assert.equal(form.elements.namedItem("broker_name").required, false);
    assert.equal(form.elements.namedItem("platform").required, false);
    assert.equal(form.elements.namedItem("nominal_account_size"), null, "non-Prop-Firm types do not show Prop Firm-only fields");

    await setField(form, "name", "My Prop Firm Account", React, dom);
    await setField(form, "account_type", "prop_firm", React, dom);
    assert.ok(form.elements.namedItem("nominal_account_size"));
    assert.ok(form.elements.namedItem("challenge_phase"));
    await setField(form, "broker_name", "Example Funding Firm", React, dom);
    await setField(form, "platform", "MetaTrader 5", React, dom);
    await setField(form, "currency", "USD", React, dom);
    await setField(form, "starting_balance", "2500.00", React, dom);
    await setField(form, "account_reference", "PF-REF-001", React, dom);
    await setField(form, "nominal_account_size", "100000.00", React, dom);
    await setField(form, "challenge_phase", "Evaluation Phase 1", React, dom);
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });

    const createRequest = requests.find(({ url, options }) => url === "/accounts" && options.method === "POST");
    assert.ok(createRequest);
    const payload = JSON.parse(createRequest.options.body);
    assert.equal(payload.connection_method, "manual");
    assert.equal(payload.account_type, "prop_firm");
    assert.equal(payload.challenge_phase, "Evaluation Phase 1");
    assert.equal(payload.starting_balance, "2500.00");
    assert.equal(payload.nominal_account_size, "100000.00");
    assert.equal(payload.account_reference, "PF-REF-001");

    assert.match(rootElement.textContent, /My Prop Firm Account/);
    assert.match(rootElement.textContent, /Prop Firm/);
    assert.match(rootElement.textContent, /Manual/);
    assert.match(rootElement.textContent, /Manually managed/);
    assert.match(rootElement.textContent, /Evaluation Phase 1/);
    assert.match(rootElement.textContent, /Nominal account size/);
    assert.equal(rootElement.querySelector(".settings-account").textContent.includes("PF-REF-001"), false);
    assert.ok(requests.filter(({ url }) => url === "/trade-options").length >= 2, "account options refresh after creation");

    await clickButton(rootElement, React, "Add Account");
    form = rootElement.querySelector(".account-registration-form");
    await setField(form, "name", "Failed response test account", React, dom);
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    assert.equal(accountCreationCount, 2);
    assert.match(
      rootElement.querySelector('[role="alert"]').textContent,
      /invalid response \(HTTP 404\)/,
      "an empty error response is shown as a useful HTTP error instead of a JSON parse exception"
    );
    assert.ok(rootElement.querySelector(".account-registration-form"), "failed account creation keeps the form open");

    await React.act(async () => {
      dom.window.location.hash = "#journal";
      await flush();
    });
    await clickButton(rootElement, React, "Add Trade");
    const tradeForm = rootElement.querySelector(".trade-editor");
    assert.equal(tradeForm.elements.namedItem("account_id").value, "31");
    assert.equal(tradeForm.querySelector('button[type="submit"]').disabled, false);
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

async function setField(form, name, value, React, dom) {
  const field = form.elements.namedItem(name);
  assert.ok(field, `expected form field ${name}`);
  const prototype = field instanceof dom.window.HTMLSelectElement
    ? dom.window.HTMLSelectElement.prototype
    : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  await React.act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new dom.window.Event(field instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function clickButton(rootElement, React, label) {
  const button = [...rootElement.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.trim() === label);
  assert.ok(button, `expected button ${label}`);
  await React.act(async () => button.dispatchEvent(new rootElement.ownerDocument.defaultView.MouseEvent("click", { bubbles: true })));
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushInAct(React) {
  await React.act(flush);
}

function jsonResponse(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data
  };
}