import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("trade detail actions edit, close, reopen, cancel deletion, and refresh summary data", async () => {
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
  const tradeDataEvents = [];
  let trade = initialTrade();
  let tradeExists = true;
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
  dom.window.scrollTo = () => {};
  dom.window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  dom.window.confirm = () => false;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    requests.push({ url: requestUrl, options });
    if (requestUrl === "/trade-options") {
      return jsonResponse({
        accounts: [{ id: 7, name: "Test account", currency: "USD" }],
        strategies: []
      });
    }
    if (requestUrl === "/trade-summary") {
      return jsonResponse({
        total_trades: tradeExists ? 1 : 0,
        open_trades: tradeExists && trade.status === "open" ? 1 : 0,
        closed_trades: tradeExists && trade.status === "closed" ? 1 : 0,
        recorded_pnl: tradeExists && trade.status === "closed" ? trade.pnl : "0.00",
        recorded_pnl_by_currency: [{
          currency: "USD",
          amount: tradeExists && trade.status === "closed" ? trade.pnl : "0.00"
        }]
      });
    }
    if (requestUrl.startsWith("/trades?")) {
      return jsonResponse({
        data: tradeExists ? [historyTrade(trade)] : [],
        total: tradeExists ? 1 : 0,
        per_page: 10,
        current_page: 1,
        last_page: 1
      });
    }
    if (requestUrl === "/trades/42" && (options.method ?? "GET") === "GET") {
      return jsonResponse({
        data: {
          ...trade,
          account_name: "Test account",
          account_platform: "Paper",
          account_currency: "USD",
          strategy_name: null,
          strategy_notes: null
        }
      });
    }
    if (requestUrl === "/trades/42" && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      trade = { ...trade, ...payload };
      if (payload.status === "open") {
        trade.closed_at = null;
        trade.exit_price = null;
        trade.r_multiple = null;
      }
      return jsonResponse({ data: trade });
    }
    if (requestUrl === "/trades/42" && options.method === "DELETE") {
      tradeExists = false;
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

    root = createRoot(rootElement);
    await React.act(async () => {
      root.render(React.createElement(App));
      await flush();
    });
    await viewDetails(rootElement, React, dom);
    assert.match(rootElement.textContent, /Open trades1/);

    await clickButton(rootElement, "Edit Trade", React, dom);
    let form = rootElement.querySelector(".trade-editor");
    assert.ok(form);
    assert.ok(form.querySelector('select[name="account_id"]'), "Edit Trade retains account selection");
    for (const field of ["contract_size", "commission", "swap", "setup", "risk_amount"]) {
      assert.equal(form.elements.namedItem(field), null, `${field} is not shown when editing`);
    }
    assert.equal(form.elements.namedItem("risk_percentage").value, "2.5000");
    await setField(form, "market_condition", "Trending", React, dom);
    await setField(form, "trend_direction", "Bullish", React, dom);
    await setField(form, "status", "closed", React, dom);
    await setField(form, "closed_at", "2026-11-15T10:00", React, dom);
    await setField(form, "exit_price", "1.10500000", React, dom);
    await setField(form, "pnl", "25.50", React, dom);
    await setField(form, "risk_percentage", "1.5", React, dom);
    await submit(form, React);

    let updateRequest = requests.filter(({ url, options }) => url === "/trades/42" && options.method === "PUT").at(-1);
    assert.ok(updateRequest);
    let updatePayload = JSON.parse(updateRequest.options.body);
    assert.equal(updatePayload.status, "closed");
    assert.equal(updatePayload.exit_price, "1.10500000");
    assert.equal(updatePayload.pnl, "25.50");
    assert.equal(updatePayload.risk_percentage, "1.5");
    for (const field of ["contract_size", "commission", "swap", "setup", "risk_amount"]) {
      assert.equal(field in updatePayload, false, `${field} is not submitted by the form`);
    }
    assert.equal("notes" in updatePayload, false, "editing other trade fields must not overwrite notes");
    assert.equal("strategy_notes" in updatePayload, false, "editing a trade must not overwrite saved strategy descriptions");
    assert.equal(updatePayload.market_condition, "Trending");
    assert.equal(updatePayload.trend_direction, "Bullish");
    assert.equal(trade.notes, "Keep this trade note.");
    assert.equal(trade.risk_percentage, "1.5");
    assert.equal(trade.contract_size, "10.00000000");
    assert.equal(trade.commission, "5.00");
    assert.equal(trade.swap, "-2.00");
    assert.equal(trade.risk_amount, "75.00");
    assert.equal(trade.setup, "Legacy setup");
    assert.match(rootElement.textContent, /Closed trades1/);
    assert.match(rootElement.textContent, /25\.50/);
    assert.equal(tradeDataEvents.length, 1, "an edit invalidates shared trade data");

    await changePage("calendar", React, dom);
    const calendarDay = rootElement.querySelector('[data-date="2026-11-15"]');
    assert.ok(calendarDay, "calendar uses the closed trade's recorded date without timezone conversion");
    assert.match(calendarDay.textContent, /1 trade/);
    assert.match(calendarDay.textContent, /25\.50/);
    await changePage("journal", React, dom);
    await viewDetails(rootElement, React, dom);

    await clickButton(rootElement, "Edit Trade", React, dom);
    form = rootElement.querySelector(".trade-editor");
    await setField(form, "symbol", "USDJPY", React, dom);
    await setField(form, "side", "short", React, dom);
    await setField(form, "closed_at", "2026-11-16T10:00", React, dom);
    await setField(form, "pnl", "-5.00", React, dom);
    assert.equal(form.querySelector('[aria-label="Formatted PnL"]').textContent, "−$5.00");
    await submit(form, React);
    assert.equal(trade.symbol, "USDJPY");
    assert.equal(trade.side, "short");
    assert.equal(trade.pnl, "-5.00");
    assert.match(rootElement.textContent, /-\$5\.00/);
    assert.equal(tradeDataEvents.length, 2, "each successful edit invalidates shared trade data once");
    await changePage("calendar", React, dom);
    const updatedCalendarDay = rootElement.querySelector('[data-date="2026-11-16"]');
    assert.ok(updatedCalendarDay, "editing a trade date moves its calendar entry");
    assert.match(updatedCalendarDay.textContent, /-\$5\.00/);
    assert.doesNotMatch(rootElement.querySelector('[data-date="2026-11-15"]').textContent, /trade/i);
    await changePage("journal", React, dom);
    await viewDetails(rootElement, React, dom);

    await clickButton(rootElement, "Edit Trade", React, dom);
    form = rootElement.querySelector(".trade-editor");
    await setField(form, "status", "open", React, dom);
    await submit(form, React);
    updateRequest = requests.filter(({ url, options }) => url === "/trades/42" && options.method === "PUT").at(-1);
    updatePayload = JSON.parse(updateRequest.options.body);
    assert.equal(updatePayload.status, "open");
    assert.equal("closed_at" in updatePayload, false);
    assert.equal("exit_price" in updatePayload, false);
    assert.equal(trade.status, "open");
    assert.equal(trade.notes, "Keep this trade note.");
    assert.match(rootElement.textContent, /Open trades1/);
    assert.match(rootElement.textContent, /Recorded P&L \(closed\).*\$0\.00/);
    assert.equal(tradeDataEvents.length, 3);

    await clickButton(rootElement, "Delete Trade", React, dom);
    assert.equal(requests.some(({ url, options }) => url === "/trades/42" && options.method === "DELETE"), false);
    assert.equal(tradeExists, true, "canceling confirmation must keep the trade");
    assert.equal(tradeDataEvents.length, 3, "canceling deletion must not invalidate persisted data");

    dom.window.confirm = () => true;
    await clickButton(rootElement, "Delete Trade", React, dom);
    assert.equal(tradeExists, false);
    assert.equal(tradeDataEvents.length, 4, "a successful deletion invalidates shared trade data");
    assert.match(rootElement.textContent, /Trade deleted successfully/);
    assert.match(rootElement.textContent, /Total trades0/);
    assert.match(rootElement.textContent, /No trades match this view/);
    await changePage("calendar", React, dom);
    assert.match(rootElement.textContent, /No trades are available for the calendar yet/);
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

function initialTrade() {
  return {
    id: 42,
    account_id: 7,
    strategy_id: null,
    external_id: "trade-42",
    symbol: "EURUSD",
    side: "long",
    trading_session: "London Session",
    market_condition: "Ranging",
    trend_direction: null,
    opened_at: "2026-11-15T09:00",
    closed_at: null,
    entry_price: "1.10000000",
    exit_price: null,
    quantity: "0.25000000",
    contract_size: "10.00000000",
    commission: "5.00",
    swap: "-2.00",
    risk_amount: "75.00",
    risk_percentage: "2.5000",
    setup: "Legacy setup",
    pnl: "0.00",
    account_currency: "USD",
    r_multiple: null,
    status: "open",
    notes: "Keep this trade note.",
    created_at: "2026-11-15T09:00:00+00:00",
    updated_at: "2026-11-15T09:00:00+00:00"
  };
}

function historyTrade(trade) {
  return {
    ...trade,
    ticket: trade.external_id,
    openedAt: trade.opened_at,
    closedAt: trade.closed_at,
    entry: trade.entry_price,
    exit: trade.exit_price,
    rMultiple: trade.r_multiple == null ? null : Number(trade.r_multiple),
    session: trade.trading_session,
    strategy: trade.strategy_name ?? "—"
  };
}

async function viewDetails(rootElement, React, dom) {
  const button = [...rootElement.querySelectorAll("button")]
    .find((item) => item.textContent.trim() === "View details");
  assert.ok(button);
  await React.act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await flush();
  });
}

async function changePage(page, React, dom) {
  await React.act(async () => {
    dom.window.history.replaceState(null, "", `#${page}`);
    dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
    await flush();
  });
}

async function clickButton(rootElement, text, React, dom) {
  const button = [...rootElement.querySelectorAll("button")]
    .find((item) => item.textContent.trim() === text);
  assert.ok(button, `expected button ${text}`);
  await React.act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await flush();
  });
}

async function setField(form, name, value, React, dom) {
  const field = form.elements.namedItem(name);
  const prototype = field instanceof dom.window.HTMLSelectElement
    ? dom.window.HTMLSelectElement.prototype
    : field instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  await React.act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new dom.window.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    await flush();
  });
}

async function submit(form, React) {
  await React.act(async () => {
    form.dispatchEvent(new form.ownerDocument.defaultView.Event("submit", { bubbles: true, cancelable: true }));
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
