const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

const forexCurrencies = new Set([
  "AED", "AUD", "BRL", "CAD", "CHF", "CLP", "CNY", "CZK", "DKK", "EUR",
  "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "JPY", "KRW", "MXN", "MYR",
  "NOK", "NZD", "PHP", "PLN", "RON", "RUB", "SAR", "SEK", "SGD", "THB",
  "TRY", "TWD", "UAH", "USD", "VND", "ZAR"
]);

function decimalParts(value) {
  const match = String(value).trim().match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || (!match[2] && !match[3])) {
    throw new TypeError(`Invalid decimal value: ${value}`);
  }

  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] || "0";
  const fraction = match[3] || "";
  const exponent = Number(match[4] || 0);
  const digits = whole + fraction;
  const decimalPosition = whole.length + exponent;

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    throw new RangeError(`Decimal exponent is out of range: ${value}`);
  }

  if (decimalPosition <= 0) {
    return { sign, integer: "0", fraction: "0".repeat(-decimalPosition) + digits };
  }
  if (decimalPosition >= digits.length) {
    return { sign, integer: digits + "0".repeat(decimalPosition - digits.length), fraction: "" };
  }

  return {
    sign,
    integer: digits.slice(0, decimalPosition),
    fraction: digits.slice(decimalPosition)
  };
}

function groupedInteger(integer) {
  return integerFormatter.format(BigInt(integer || "0"));
}

function minorUnits(value) {
  const parts = decimalParts(value);
  if (parts.fraction.slice(2).replace(/0/g, "") !== "") {
    throw new RangeError("Currency amounts support at most two decimal places.");
  }

  const fraction = (parts.fraction + "00").slice(0, 2);
  const amount = BigInt(parts.integer || "0") * 100n + BigInt(fraction || "0");
  return parts.sign < 0 ? -amount : amount;
}

function decimalFromMinorUnits(amount) {
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${amount < 0n ? "-" : ""}${whole}.${fraction}`;
}

export function moneyTotals(trades) {
  const totals = new Map();
  for (const trade of trades) {
    const currency = (trade.account_currency || "XXX").toUpperCase();
    totals.set(currency, (totals.get(currency) || 0n) + minorUnits(trade.pnl));
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({
      currency,
      amount: decimalFromMinorUnits(amount)
    }));
}

export function money(value, options = {}) {
  const amount = minorUnits(value);
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const currency = (options.currency || "XXX").toUpperCase();
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const fraction = String(absolute % 100n).padStart(2, "0");
  const body = formatter.formatToParts(whole)
    .filter((part) => part.type !== "minusSign")
    .map((part) => part.type === "fraction" ? fraction : part.value)
    .join("");
  const sign = amount < 0n ? "-" : amount > 0n && options.sign ? "+" : "";
  return `${sign}${body}`;
}

export function formatTradePnl(value, currency) {
  if (value == null || value === "") return "";

  try {
    const amount = minorUnits(value);
    if (currency) return money(value, { sign: true, currency }).replace(/^-/, "−");

    const absolute = amount < 0n ? -amount : amount;
    const whole = groupedInteger(String(absolute / 100n));
    const fraction = String(absolute % 100n).padStart(2, "0");
    const sign = amount < 0n ? "−" : amount > 0n ? "+" : "";
    return `${sign}${whole}.${fraction}`;
  } catch {
    return "";
  }
}

export function compactMoney(value) {
  const amount = Number(value);
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (absolute >= 1000) {
    return sign + "$" + (absolute / 1000).toFixed(1) + "k";
  }
  return sign + "$" + Math.round(absolute);
}

export function percent(fraction, digits) {
  const places = digits == null ? 1 : digits;
  return (fraction * 100).toFixed(places) + "%";
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character];
  });
}

export function formatDate(iso, withYear) {
  const options = { day: "numeric", month: "short" };
  if (withYear !== false) options.year = "numeric";
  return new Date(iso).toLocaleDateString("en-GB", options);
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function forexPair(symbol) {
  const normalized = String(symbol ?? "").toUpperCase();
  const pair = normalized.match(/^([A-Z]{6})(?:[._-][A-Z0-9]+|M|PRO)?$/)?.[1];
  return pair
    && forexCurrencies.has(pair.slice(0, 3))
    && forexCurrencies.has(pair.slice(3))
    ? pair
    : null;
}

export function isForexSymbol(symbol) {
  return forexPair(symbol) !== null;
}

export function positionSizeLabel(symbol) {
  return isForexSymbol(symbol) ? "Position Size (Lots)" : "Position size";
}

export function formatPositionSize(symbol, value) {
  if (value == null || value === "") return "—";
  return formatDecimal(value, isForexSymbol(symbol) ? 2 : 0);
}

export function formatPrice(symbol, value) {
  if (value == null || value === "") return "—";
  const pair = forexPair(symbol);
  const minimumDigits = pair ? pair.endsWith("JPY") ? 3 : 5 : 2;
  return formatDecimal(value, minimumDigits);
}

export function formatRMultiple(value) {
  if (value == null || value === "") return "—";
  const parts = decimalParts(value);
  const formatted = formatDecimal(value, 2);
  if (parts.sign < 0) return `${formatted}R`;
  if (parts.sign > 0 && (BigInt(parts.integer || "0") > 0n || /[1-9]/.test(parts.fraction))) {
    return `+${formatted}R`;
  }
  return `${formatted}R`;
}

function formatDecimal(value, minimumDigits) {
  const parts = decimalParts(value);
  const integer = groupedInteger(parts.integer.replace(/^0+(?=\d)/, ""));
  let fraction = parts.fraction.replace(/0+$/, "");
  if (fraction.length < minimumDigits) fraction = fraction.padEnd(minimumDigits, "0");
  const sign = parts.sign < 0 && (BigInt(parts.integer || "0") !== 0n || /[1-9]/.test(parts.fraction))
    ? "-"
    : "";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

export function pnlClass(value) {
  const amount = typeof value === "bigint" ? value : minorUnits(value);
  if (amount > 0n) return "pnl-pos";
  if (amount < 0n) return "pnl-neg";
  return "pnl-flat";
}
