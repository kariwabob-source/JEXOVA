import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPositionSize,
  formatPrice,
  formatRMultiple,
  formatTradePnl,
  isForexSymbol,
  money,
  moneyTotals,
  pnlClass,
  positionSizeLabel
} from "../js/format.js";

test("prices retain small and large decimal values without scientific notation", () => {
  assert.equal(formatPrice("EURUSD", "1.08542000"), "1.08542");
  assert.equal(formatPrice("EURUSD", "0.00000003"), "0.00000003");
  assert.equal(formatPrice("EURUSD", 3e-8), "0.00000003");
  assert.equal(formatPrice("USDJPY", "346.56"), "346.560");
  assert.equal(formatPrice("USDJPY.a", "346.56"), "346.560");
  assert.equal(formatPrice("NAS100", "3454.54"), "3,454.54");
  assert.equal(formatPrice("US30", "9999999999.99999999"), "9,999,999,999.99999999");
});

test("forex position sizes retain fractional lots and non-forex units stay unlabeled", () => {
  for (const [value, expected] of [
    ["0.01", "0.01"],
    ["0.02", "0.02"],
    ["0.05", "0.05"],
    ["0.10", "0.10"],
    ["0.50", "0.50"],
    ["1.00", "1.00"]
  ]) {
    assert.equal(formatPositionSize("EURUSD", value), expected);
  }
  assert.equal(positionSizeLabel("EURUSD"), "Position Size (Lots)");
  assert.equal(isForexSymbol("XAUUSD"), false);
  assert.equal(positionSizeLabel("NAS100"), "Position size");
  assert.equal(formatPositionSize("NAS100", "0.00000003"), "0.00000003");
});

test("P&L uses exact currency values, explicit signs, and separate account currencies", () => {
  assert.equal(money("125.50", { sign: true, currency: "USD" }), "+$125.50");
  assert.equal(money("-45.20", { sign: true, currency: "USD" }), "-$45.20");
  assert.equal(money("250.00", { sign: true, currency: "EUR" }), "+€250.00");
  assert.equal(money("-30.75", { sign: true, currency: "EUR" }), "-€30.75");
  assert.equal(money("0.00", { sign: true, currency: "EUR" }), "€0.00");
  assert.equal(money("90071992547409.91", { currency: "USD" }), "$90,071,992,547,409.91");
  assert.deepEqual(moneyTotals([
    { account_currency: "USD", pnl: "0.10" },
    { account_currency: "USD", pnl: "0.20" },
    { account_currency: "EUR", pnl: "-5.25" }
  ]), [
    { currency: "EUR", amount: "-5.25" },
    { currency: "USD", amount: "0.30" }
  ]);
  assert.equal(pnlClass("-0.01"), "pnl-neg");
  assert.equal(pnlClass("0.00"), "pnl-flat");
});

test("trade P&L display avoids placeholder currencies and uses a typographic minus", () => {
  assert.equal(formatTradePnl("125.50", "USD"), "+$125.50");
  assert.equal(formatTradePnl("-45.20", "USD"), "−$45.20");
  assert.equal(formatTradePnl("0.00", "EUR"), "€0.00");
  assert.equal(formatTradePnl("125.50"), "+125.50");
  assert.equal(formatTradePnl("-45.20"), "−45.20");
  assert.equal(formatTradePnl("0.00"), "0.00");
  assert.equal(formatTradePnl("", "USD"), "");
});

test("R-multiples keep significant decimal places and readable signs", () => {
  assert.equal(formatRMultiple("1.2500"), "+1.25R");
  assert.equal(formatRMultiple("-0.6000"), "-0.60R");
  assert.equal(formatRMultiple("0.0001"), "+0.0001R");
  assert.equal(formatRMultiple(null), "—");
});
