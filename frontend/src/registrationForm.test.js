import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("guest auth screens link to each other and registration submits its email separately", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="csrf-token" content="csrf-test"></head><body><div id="root"></div></body></html>',
    { url: "http://localhost/register" }
  );
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent"];
  const previousGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
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

  try {
    const rootElement = dom.window.document.getElementById("root");
    rootElement.dataset.authenticated = "false";
    rootElement.dataset.registrationErrors = "{}";
    rootElement.dataset.oldRegistration = JSON.stringify({
      first_name: "Ada",
      last_name: "Lovelace",
      country: "United States"
    });

    vite = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("..", import.meta.url)),
      server: { middlewareMode: true },
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
    });

    const signInLink = rootElement.querySelector('a[href="/login"]');
    assert.equal(signInLink?.textContent.trim(), "Back to Sign In");

    const form = rootElement.querySelector('form[action="/register"]');
    assert.ok(form, "registration form should render");

    const updateInput = async (name, value) => {
      const input = form.elements.namedItem(name);
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      await React.act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    };

    await updateInput("username", "champ_2026");
    await updateInput("email", "champ@gmail.com");
    await updateInput("password", "Secure-test-password-2026!");
    await updateInput("password_confirmation", "Secure-test-password-2026!");

    await React.act(async () => {
      form.elements.namedItem("terms_accepted").click();
      form.elements.namedItem("privacy_accepted").click();
    });

    let submittedData;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submittedData = new dom.window.FormData(form);
    }, { once: true });

    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });

    assert.equal(submittedData.get("username"), "champ_2026");
    assert.equal(submittedData.get("email"), "champ@gmail.com");
    assert.notEqual(submittedData.get("email"), submittedData.get("username"));
    assert.equal(form.elements.namedItem("email").getAttribute("name"), "email");
    assert.equal(form.elements.namedItem("email").getAttribute("aria-invalid"), "false");
    assert.equal(form.elements.namedItem("username").getAttribute("aria-invalid"), "false");

    dom.window.history.pushState({}, "", "/login");
    await React.act(async () => {
      root.render(React.createElement(App));
    });

    const createAccountLink = rootElement.querySelector('a[href="/register"]');
    assert.ok(createAccountLink, "login should link to the registration page");
    assert.equal(createAccountLink.textContent.trim(), "Create Account");
    assert.equal(
      createAccountLink.parentElement.textContent.trim(),
      "Don't have an account? Create Account"
    );
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
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
