import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("manual trade form submits without an external ID and displays success and validation feedback", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#journal" }
  );
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent"];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const fetchCalls = [];
  const submittedPayloads = [];
  const tradeDataEvents = [];
  let postCount = 0;
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
  dom.window.addEventListener("jexova:trade-data-changed", () => tradeDataEvents.push(true));
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
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
      return jsonResponse({
        accounts: [{ id: 7, name: "Test account", currency: "USD" }],
        strategies: [{ id: 12, account_id: 7, name: "Test strategy" }]
      });
    }
    if (String(url).startsWith("/trades?")) {
      return jsonResponse({ data: [], total: 0, per_page: 10, current_page: 1, last_page: 1 });
    }
    if (url === "/trades" && options.method === "POST") {
      submittedPayloads.push(JSON.parse(options.body));
      postCount += 1;
      if (postCount === 1) {
        return jsonResponse({ data: { id: 42, external_id: "manual-test-id" } }, 201);
      }
      return jsonResponse({
        message: "The given data was invalid.",
        errors: { symbol: ["Enter a valid instrument."] }
      }, 422);
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const addTradeButton = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Add Trade");
    assert.ok(addTradeButton, "journal should show an Add Trade action");

    const fillRequiredFields = async (notes = "") => {
      await React.act(async () => {
        addTradeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });

      const form = rootElement.querySelector(".trade-editor");
      assert.ok(form, "Add Trade should open the trade form");
      assert.match(form.textContent, /Required/);
      assert.match(form.textContent, /Optional/);
      assert.equal(form.elements.namedItem("external_id"), null, "manual entry should not ask for an external ID");
      assert.equal(form.elements.namedItem("r_multiple"), null, "R multiple is not part of the trade entry form");
      for (const field of ["contract_size", "commission", "swap", "setup", "risk_amount"]) {
        assert.equal(form.elements.namedItem(field), null, `${field} is no longer part of the trade form`);
      }
      assert.equal(form.querySelector('select[name="account_id"]'), null, "Add Trade should not offer account selection");
      assert.equal(form.elements.namedItem("account_id").value, "7", "a single account is selected automatically");
      assert.ok(form.elements.namedItem("strategy_name"), "strategy name can be entered instead of selected");
      assert.equal(form.elements.namedItem("strategy_notes"), null, "market condition replaces strategy description entry");
      assert.deepEqual(
        [...form.elements.namedItem("trading_session").options].slice(1).map((option) => option.value),
        ["Asian Session", "London Session", "New York Session", "Sydney Session"]
      );

      const setField = async (name, value) => {
        const field = form.elements.namedItem(name);
        assert.ok(field, `expected form field ${name}`);
        const prototype = field instanceof dom.window.HTMLSelectElement
          ? dom.window.HTMLSelectElement.prototype
          : field instanceof dom.window.HTMLTextAreaElement
            ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
        await React.act(async () => {
          setter.call(field, value);
          field.dispatchEvent(new dom.window.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
        });
      };

      await setField("symbol", "EURUSD");
      await setField("strategy_name", "Opening range");
      await setField("market_condition", "Trending");
      await setField("trend_direction", "Bullish");
      await setField("market_condition", "Ranging");
      assert.equal(form.elements.namedItem("trend_direction"), null, "ranging hides trend direction");
      await setField("market_condition", "Trending");
      assert.equal(form.elements.namedItem("trend_direction").value, "", "switching to ranging clears trend direction");
      await setField("trend_direction", "Bearish");
      await setField("trading_session", "Sydney Session");
      const entryPrice = form.elements.namedItem("entry_price");
      assert.equal(entryPrice.type, "text", "price entry must not use a scientific-notation-capable number field");
      assert.equal(entryPrice.getAttribute("inputmode"), "decimal");
      await setField("entry_price", "2e-8");
      assert.equal(entryPrice.value, "0.00000002", "small exponent values display as standard decimals");
      await React.act(async () => {
        form.querySelector('[aria-label="Increase Entry price"]').click();
      });
      assert.equal(entryPrice.value, "0.00000003", "increment adds one exact 1e-8 step");
      await React.act(async () => {
        form.querySelector('[aria-label="Decrease Entry price"]').click();
      });
      assert.equal(entryPrice.value, "0.00000002", "decrement subtracts one exact 1e-8 step");
      await React.act(async () => {
        entryPrice.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      });
      assert.equal(entryPrice.value, "0.00000003", "keyboard up increments exactly");
      await React.act(async () => {
        entryPrice.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });
      assert.equal(entryPrice.value, "0.00000002", "keyboard down decrements exactly");
      await setField("exit_price", "1.10100000");
      assert.equal(form.elements.namedItem("exit_price").value, "1.10100000", "normal prices retain their entered precision");
      const quantity = form.elements.namedItem("quantity");
      assert.equal(quantity.type, "number");
      assert.equal(quantity.min, "0.01");
      assert.equal(quantity.step, "0.01");
      await setField("quantity", "0.005");
      assert.equal(quantity.validity.rangeUnderflow, true, "browser rejects lot sizes below 0.01");
      await setField("quantity", "0.015");
      assert.equal(quantity.validity.stepMismatch, true, "browser rejects lot sizes outside 0.01 increments");
      await setField("quantity", "0.10");
      assert.equal(quantity.validity.valid, true, "browser accepts a valid hundredth increment");
      assert.equal(quantity.value, "0.10", "lot size retains its decimal string precision");
      const riskPercentage = form.elements.namedItem("risk_percentage");
      assert.equal(riskPercentage.type, "number");
      assert.equal(riskPercentage.min, "0");
      assert.equal(riskPercentage.max, "999999.9999");
      assert.equal(riskPercentage.step, "0.0001");
      assert.equal(riskPercentage.parentElement.classList.contains("trade-percentage-control"), true);
      assert.equal(riskPercentage.parentElement.querySelector(".trade-percentage-suffix").textContent, "%");
      await setField("risk_percentage", "-0.5");
      assert.equal(riskPercentage.validity.rangeUnderflow, true, "negative risk percentages are rejected");
      await setField("risk_percentage", "2.5");
      assert.equal(riskPercentage.validity.valid, true, "decimal risk percentages are accepted");
      assert.equal(form.querySelector('[aria-label="Formatted PnL"]').textContent, "$0.00");
      await setField("pnl", "25.50");
      assert.equal(form.querySelector('[aria-label="Formatted PnL"]').textContent, "+$25.50");
      await setField("notes", notes);
      return form;
    };

    let form = await fillRequiredFields("Waited for a clean breakout.");
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(submittedPayloads[0].symbol, "EURUSD");
    assert.equal(submittedPayloads[0].entry_price, "0.00000002", "small decimals are submitted without floating-point conversion");
    assert.equal(submittedPayloads[0].exit_price, "1.10100000", "normal prices are submitted as exact strings");
    assert.equal(submittedPayloads[0].quantity, "0.10", "lot size is submitted through the existing quantity field");
    assert.equal(submittedPayloads[0].pnl, "25.50");
    assert.equal(submittedPayloads[0].risk_percentage, "2.5");
    assert.equal(submittedPayloads[0].account_id, 7, "the automatically selected account is submitted");
    for (const field of ["contract_size", "commission", "swap", "setup", "risk_amount"]) {
      assert.equal(field in submittedPayloads[0], false, `${field} is not submitted by the form`);
    }
    assert.equal("external_id" in submittedPayloads[0], false);
    assert.equal(submittedPayloads[0].notes, "Waited for a clean breakout.");
    assert.equal(submittedPayloads[0].strategy_name, "Opening range");
    assert.equal("strategy_notes" in submittedPayloads[0], false);
    assert.equal(submittedPayloads[0].market_condition, "Trending");
    assert.equal(submittedPayloads[0].trend_direction, "Bearish");
    assert.equal(submittedPayloads[0].trading_session, "Sydney Session");
    assert.equal(rootElement.querySelector('[role="status"]')?.textContent, "Trade saved successfully.");
    assert.equal(tradeDataEvents.length, 1, "successful saves invalidate shared trade data");
    assert.ok(fetchCalls.filter(({ url }) => url === "/trade-summary").length >= 2, "trade statistics refresh after save");
    assert.ok(fetchCalls.filter(({ url }) => String(url).startsWith("/trades?")).length >= 2, "trade journal refetches after save");

    form = await fillRequiredFields();
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const validationAlert = [...rootElement.querySelectorAll('[role="alert"]')]
      .find((element) => element.textContent.includes("Enter a valid instrument."));
    assert.ok(validationAlert, "backend validation feedback should be visible");
    assert.equal(fetchCalls.filter(({ url, options }) => url === "/trades" && options.method === "POST").length, 2);
    assert.equal(tradeDataEvents.length, 1, "failed saves do not invalidate data as if persisted");
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

test("Create Trade retries failed account options and submits the selected account", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#journal" }
  );
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Event", "MouseEvent"];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const submittedPayloads = [];
  let resolveInitialOptions;
  let resolveRetryOptions;
  let optionsRequestCount = 0;
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
    if (url === "/trade-summary") {
      return jsonResponse({
        total_trades: 0,
        open_trades: 0,
        closed_trades: 0,
        recorded_pnl: "0.00",
        recorded_pnl_by_currency: []
      });
    }
    if (url === "/trade-options") {
      optionsRequestCount += 1;
      return new Promise((resolve) => {
        if (optionsRequestCount === 1) resolveInitialOptions = resolve;
        else resolveRetryOptions = resolve;
      });
    }
    if (String(url).startsWith("/trades?")) {
      return jsonResponse({ data: [], total: 0, per_page: 10, current_page: 1, last_page: 1 });
    }
    if (url === "/trades" && options.method === "POST") {
      submittedPayloads.push(JSON.parse(options.body));
      return jsonResponse({ data: { id: 43, external_id: "multi-account-trade" } }, 201);
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const addTradeButton = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Add Trade");
    await React.act(async () => addTradeButton.click());
    let form = rootElement.querySelector(".trade-editor");
    const submitButton = form.querySelector('button[type="submit"]');
    assert.equal(submitButton.disabled, true, "submission stays disabled while account options are pending");
    assert.match(form.textContent, /Loading trading accounts/);

    await React.act(async () => {
      resolveInitialOptions(jsonResponse({ message: "Account options are temporarily unavailable." }, 503));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.match(rootElement.querySelector('[role="alert"]').textContent, /Could not load trading accounts/);
    assert.equal(submitButton.disabled, true, "submission stays disabled after options failure");

    await React.act(async () => {
      [...rootElement.querySelectorAll("button")].find((button) => button.textContent.trim() === "Retry").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(optionsRequestCount, 2, "retry issues another account-options request");
    assert.match(form.textContent, /Loading trading accounts/);
    assert.equal(submitButton.disabled, true, "submission remains disabled during the retry request");

    await React.act(async () => {
      resolveRetryOptions(jsonResponse({
        accounts: [
          { id: 7, name: "Primary account", currency: "USD" },
          { id: 8, name: "Second account", currency: "EUR" }
        ],
        strategies: []
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    form = rootElement.querySelector(".trade-editor");
    const accountSelector = form.elements.namedItem("account_id");
    assert.ok(accountSelector instanceof dom.window.HTMLSelectElement, "multiple accounts are selectable");
    assert.deepEqual([...accountSelector.options].map((option) => option.textContent), ["Primary account", "Second account"]);
    assert.equal(accountSelector.value, "7", "the first account is the initial selection");
    assert.equal(submitButton.disabled, false, "submission enables after account options load successfully");

    const setField = async (name, value) => {
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
    };

    await setField("account_id", "8");
    await setField("symbol", "EURUSD");
    await setField("market_condition", "Ranging");
    await setField("trading_session", "London Session");
    await setField("status", "open");
    await setField("entry_price", "1.10000000");
    await setField("quantity", "0.10");
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(submittedPayloads.length, 1);
    assert.equal(submittedPayloads[0].account_id, 8, "the selected account is included in the POST payload");
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

test("Add Trade remains clickable and can close and reopen when the user has no accounts", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/#journal" }
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
      return jsonResponse({
        total_trades: 0,
        open_trades: 0,
        closed_trades: 0,
        recorded_pnl: "0.00",
        recorded_pnl_by_currency: []
      });
    }
    if (url === "/trade-options") return jsonResponse({ accounts: [], strategies: [] });
    if (String(url).startsWith("/trades?")) {
      return jsonResponse({ data: [], total: 0, per_page: 10, current_page: 1, last_page: 1 });
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

    const addTradeButton = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Add Trade");
    assert.ok(addTradeButton);
    assert.equal(addTradeButton.disabled, false);

    await React.act(async () => {
      addTradeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    let form = rootElement.querySelector(".trade-editor");
    assert.ok(form, "Add Trade should open the entry form without accounts");
    assert.equal(form.querySelector('select[name="account_id"]'), null);
    assert.equal(form.elements.namedItem("account_id").value, "");
    assert.equal(form.querySelector('button[type="submit"]').disabled, true);
    assert.match(rootElement.textContent, /No trading account is linked/);
    assert.equal(form.querySelector('a[href="#settings"]')?.textContent, "Open Settings to create a manual account; MT5 is optional.");

    await React.act(async () => {
      form.querySelector('button[type="button"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(rootElement.querySelector(".trade-editor"), null, "Cancel should close the form");

    await React.act(async () => {
      addTradeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    form = rootElement.querySelector(".trade-editor");
    assert.ok(form, "Add Trade should reopen the entry form");
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

function jsonResponse(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data
  };
}
