import React, { useEffect, useRef, useState } from "react";
import PhoneInput from "react-phone-number-input/input";
import countryFlags from "react-phone-number-input/flags";
import countryLabels from "react-phone-number-input/locale/en.json";
import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString
} from "libphonenumber-js";
import {
  formatDate,
  formatPositionSize,
  formatTradePnl,
  formatPrice,
  formatRMultiple,
  formatTime,
  moneyTotals,
  money,
  percent,
  pnlClass,
  positionSizeLabel
} from "../js/format.js";
import { validateRegistrationIdentity } from "./registrationValidation.js";

const pages = {
  dashboard: ["Dashboard", "Performance overview"],
  journal: ["Trade History", "Your recorded trades"],
  calendar: ["Calendar", "Daily result by session date"],
  analytics: ["Analytics", "Breakdown of your recorded trades"],
  strategies: ["Strategies", "Your saved trading strategies"],
  settings: ["Settings", "Account, display, and MT5 connections"]
};
const tradingSessions = ["Asian Session", "London Session", "New York Session", "Sydney Session"];
const TRADE_DATA_CHANGED = "jexova:trade-data-changed";

function announceTradeDataChanged() {
  window.dispatchEvent(new Event(TRADE_DATA_CHANGED));
}

function useTradeDataRevision() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(TRADE_DATA_CHANGED, refresh);
    return () => window.removeEventListener(TRADE_DATA_CHANGED, refresh);
  }, []);

  return revision;
}

const registrationCountries = getCountries()
  .map((code) => ({
    code,
    name: countryLabels[code] ?? code,
    callingCode: getCountryCallingCode(code)
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const registrationCountryByCode = Object.fromEntries(
  registrationCountries.map((country) => [country.code, country])
);

const navigation = [
  {
    name: "dashboard",
    label: "Dashboard",
    icon: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>
  },
  {
    name: "journal",
    label: "Trade History",
    icon: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>
  },
  {
    name: "calendar",
    label: "Calendar",
    icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>
  },
  {
    name: "analytics",
    label: "Analytics",
    icon: <path d="M4 19V10M10 19V5M16 19v-7M22 19H2" />
  },
  {
    name: "strategies",
    label: "Strategies",
    icon: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>
  },
  {
    name: "settings",
    label: "Settings",
    icon: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6-1.6" /></>
  }
];

function pageFromHash() {
  const name = window.location.hash.slice(1);
  return pages[name] ? name : "dashboard";
}

function MoneyTotals({ totals }) {
  if (!totals.length) return "-";
  return totals.map((total, index) => (
    <React.Fragment key={total.currency}>
      {index > 0 && "  |  "}
      <span className={pnlClass(total.amount)}>{money(total.amount, { sign: true, currency: total.currency })}</span>
    </React.Fragment>
  ));
}

const priceScale = 100000000n;
const minimumPrice = 1n;

function expandPriceExponent(value) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match || !match[4]) return value;

  const [, sign, integer = "", fraction = "", exponentText] = match;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 64) return value;
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  if (decimalPosition <= 0) return `${sign}0.${"0".repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) return `${sign}${digits}${"0".repeat(decimalPosition - digits.length)}`;
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function scaledPrice(value) {
  if (!/^\d+(?:\.\d{0,8})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * priceScale + BigInt(fraction.padEnd(8, "0"));
}

function formatScaledPrice(value) {
  const integer = value / priceScale;
  const fraction = String(value % priceScale).padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : String(integer);
}

function stepPrice(value, direction) {
  if (value === "" && direction < 0) return value;
  const current = value === "" ? 0n : scaledPrice(value);
  if (current === null) return value;
  const next = current + BigInt(direction);
  return formatScaledPrice(next < minimumPrice ? minimumPrice : next);
}

function TradePriceInput({ name, label, value, onChange }) {
  return (
    <div className="trade-price-control">
      <input
        aria-label={label}
        aria-valuemin="0.00000001"
        inputMode="decimal"
        name={name}
        pattern="[0-9]+([.][0-9]{1,8})?"
        required
        role="spinbutton"
        type="text"
        value={value}
        onChange={(event) => {
          const typedValue = event.target.value;
          const nextValue = expandPriceExponent(typedValue);
          if (/[eE]/.test(nextValue)) return;
          event.target.setCustomValidity(nextValue === "" || (scaledPrice(nextValue) ?? 0n) >= minimumPrice
            ? ""
            : "Enter a price of at least 0.00000001 with no more than 8 decimal places.");
          onChange(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          onChange(stepPrice(value, event.key === "ArrowUp" ? 1 : -1));
        }}
      />
      <span className="trade-price-stepper">
        <button type="button" aria-label={`Increase ${label}`} title={`Increase ${label}`} onClick={() => onChange(stepPrice(value, 1))}>{"\u25B2"}</button>
        <button type="button" aria-label={`Decrease ${label}`} title={`Decrease ${label}`} onClick={() => onChange(stepPrice(value, -1))}>{"\u25BC"}</button>
      </span>
    </div>
  );
}

function monthKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function toJournalTrade(trade) {
  return {
    ...trade,
    ticket: trade.external_id,
    openedAt: trade.opened_at,
    closedAt: trade.closed_at,
    entry: trade.entry_price,
    exit: trade.exit_price,
    quantity: trade.quantity,
    pnl: trade.pnl,
    strategy: trade.strategy_name ?? "Unassigned",
    session: trade.trading_session
  };
}

function closedTrades(trades) {
  return trades.filter((trade) => trade.status === "closed");
}

function tradeMonth(date) {
  const [year, month] = date.split("-").map(Number);
  return { year, month: month - 1 };
}

function latestTradeMonth(trades) {
  const dates = trades
    .map((trade) => tradeCalendarDate(trade))
    .filter(Boolean)
    .sort();
  if (!dates.length) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return tradeMonth(dates[dates.length - 1]);
}

function monthBounds(trades) {
  const dates = trades
    .map((trade) => tradeCalendarDate(trade))
    .filter(Boolean)
    .sort();
  if (!dates.length) {
    const now = new Date();
    const month = { year: now.getFullYear(), month: now.getMonth() };
    return { start: month, end: month };
  }
  return {
    start: tradeMonth(dates[0]),
    end: tradeMonth(dates[dates.length - 1])
  };
}

function sameMonth(a, b) {
  return a.year === b.year && a.month === b.month;
}

function tradesOn(trades, key) {
  return trades.filter((trade) => {
    const sessionDate = trade.status === "closed" ? trade.closedAt : trade.openedAt;
    return sessionDate?.slice(0, 10) === key;
  });
}

function tradeCalendarDate(trade) {
  const value = trade.status === "closed" ? trade.closedAt : trade.openedAt;
  return value?.slice(0, 10) ?? "";
}

function useDatabaseTrades() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useTradeDataRevision();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    async function loadTrades() {
      try {
        const records = [];
        let page = 1;
        let lastPage = 1;

        do {
          const result = await requestJson(`/trades?per_page=50&page=${page}`);
          records.push(...(result.data ?? []).map(toJournalTrade));
          lastPage = Number(result.last_page) || 1;
          page += 1;
        } while (page <= lastPage);

        if (active) setTrades(records);
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadTrades();
    return () => { active = false; };
  }, [revision]);

  return { trades, loading, error };
}

function useTradeOptions() {
  const [options, setOptions] = useState({ accounts: [], strategies: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    requestJson("/trade-options")
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [reloadVersion]);

  return {
    options,
    loading,
    error,
    refresh: () => setReloadVersion((version) => version + 1)
  };
}

function summarizeTrades(trades) {
  const wins = trades.filter((trade) => Number(trade.pnl) > 0);

  return {
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnlByCurrency: moneyTotals(trades)
  };
}

function groupTrades(trades, field) {
  const groups = new Map();
  for (const trade of trades) {
    const name = trade[field] || "Unassigned";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(trade);
  }
  return [...groups.entries()].map(([name, rows]) => ({
    name,
    ...summarizeTrades(rows)
  }));
}

function JournalTableHeader({ field, label, sort, onSort, className }) {
  if (!onSort) return <th className={className}>{label}</th>;

  const active = sort.field === field;
  const directionLabel = sort.direction === "asc" ? "ascending" : "descending";
  return (
    <th className={className} aria-sort={active ? directionLabel : "none"}>
      <button
        className="journal-sort-button"
        type="button"
        data-sort-field={field}
        aria-label={active ? `${label}, sorted ${directionLabel}` : `Sort by ${label}`}
        onClick={() => onSort(field)}
      >
        {label}{active && <span aria-hidden="true">{sort.direction === "asc" ? " ↑" : " ↓"}</span>}
      </button>
    </th>
  );
}

function TradeTable({ rows, onEdit, onDelete, onView, deletingTradeId, saving, sort, onSort }) {
  const canEdit = Boolean(onEdit && onDelete);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <JournalTableHeader field="instrument" label="Instrument" sort={sort} onSort={onSort} />
            <JournalTableHeader field="trade_date" label="Trade date" sort={sort} onSort={onSort} />
            <JournalTableHeader field="direction" label="Direction" sort={sort} onSort={onSort} />
            <th>Strategy</th>
            <th className="num">Entry</th><th className="num">Exit</th>
            <JournalTableHeader field="lot_size" label="Lot Size" sort={sort} onSort={onSort} className="num" />
            <JournalTableHeader field="r_multiple" label="R-multiple" sort={sort} onSort={onSort} className="num" />
            <JournalTableHeader field="pnl" label="P&L" sort={sort} onSort={onSort} className="num" />
            <JournalTableHeader field="status" label="Position status" sort={sort} onSort={onSort} />
            {canEdit && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((trade) => {
            const direction = trade.side === "long" ? "Long" : "Short";
            return (
              <tr key={trade.id}>
                <td>
                  {onView
                    ? <button className="text-link symbol-link" type="button" onClick={() => onView(trade)}>{trade.symbol}</button>
                    : <span className="symbol">{trade.symbol}</span>}
                  <div className="muted">{trade.ticket ?? trade.id}</div>
                  {onView && <button className="text-link" type="button" onClick={() => onView(trade)}>View details</button>}
                </td>
                <td>{formatDate(trade.openedAt, false)}<div className="muted">{formatTime(trade.openedAt)}</div></td>
                <td><span className={`badge badge-${trade.side}`}>{direction}</span></td>
                <td>{trade.strategy}<div className="muted">{trade.session}</div></td>
                <td className="num">{formatPrice(trade.symbol, trade.entry)}</td>
                <td className="num">{formatPrice(trade.symbol, trade.exit)}</td>
                <td className="num">
                  {formatPositionSize(trade.symbol, trade.quantity ?? trade.lots)}
                  {positionSizeLabel(trade.symbol) === "Position Size (Lots)" ? " lots" : ""}
                </td>
                <td className="num">{formatRMultiple(trade.r_multiple ?? trade.rMultiple)}</td>
                <td className={`num ${pnlClass(trade.pnl)}`}>{money(trade.pnl, { sign: true, currency: trade.account_currency })}</td>
                <td><span className={`badge badge-${trade.status}`}>{trade.status === "open" ? "Open" : "Closed"}</span></td>
                {canEdit && (
                  <td className="trade-actions">
                    <button className="text-link" type="button" onClick={() => onEdit(trade)} disabled={saving || deletingTradeId === trade.id}>Edit</button>
                    <button className="text-link danger-link" type="button" onClick={() => onDelete(trade)} disabled={saving || deletingTradeId === trade.id}>
                      {deletingTradeId === trade.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                )}
              </tr>
            );
          }) : <tr><td className="empty" colSpan={canEdit ? 11 : 10}>No trades match this view.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, valueClass = "", meta }) {
  return (
    <article className="stat">
      <div className="stat-top"><span className="stat-label">{label}</span></div>
      <p className={`stat-value ${valueClass}`}>{value}</p>
      <p className="stat-meta">{meta}</p>
    </article>
  );
}

function TradeImageField({ label, imageUrl, file, removed, onFileChange, onRemoveChange }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shownUrl = file ? previewUrl : removed ? null : imageUrl;

  return (
    <div className="trade-image-field">
      <label>
        <span className="trade-field-label">{label} <span className="trade-field-indicator">Optional</span></span>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          aria-label={`${label} image`}
          onChange={(event) => {
            onFileChange(event.target.files?.[0] ?? null);
            onRemoveChange(false);
          }}
        />
      </label>
      <p className="hint">PNG or JPG, up to 2 MB.</p>
      {shownUrl && <img className="trade-image-preview" src={shownUrl} alt={`${label} preview`} />}
      {file && (
        <button className="text-link danger-link" type="button" onClick={() => {
          onFileChange(null);
          if (inputRef.current) inputRef.current.value = "";
        }}>
          Remove selected image
        </button>
      )}
      {!file && imageUrl && !removed && (
        <button className="text-link danger-link" type="button" onClick={() => onRemoveChange(true)}>
          Remove image
        </button>
      )}
      {removed && (
        <button className="text-link" type="button" onClick={() => onRemoveChange(false)}>
          Keep current image
        </button>
      )}
    </div>
  );
}

function Dashboard() {
  const { trades, loading, error } = useDatabaseTrades();
  const tradeDataRevision = useTradeDataRevision();
  const [pnlSummary, setPnlSummary] = useState(null);
  const [pnlSummaryError, setPnlSummaryError] = useState("");
  const [connections, setConnections] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState("");
  const closed = closedTrades(trades);
  const performance = summarizeTrades(closed);
  const openCount = trades.filter((trade) => trade.status === "open").length;

  useEffect(() => {
    let active = true;
    requestJson("/trade-summary")
      .then((result) => {
        if (active) {
          setPnlSummary(result);
          setPnlSummaryError("");
        }
      })
      .catch((requestError) => {
        if (active) setPnlSummaryError(requestError.message);
      });

    return () => { active = false; };
  }, [tradeDataRevision]);

  useEffect(() => {
    let active = true;
    requestJson("/mt5/connections")
      .then((response) => {
        if (active) setConnections(response.data ?? []);
      })
      .catch((requestError) => {
        if (active) setConnectionsError(requestError.message);
      })
      .finally(() => {
        if (active) setConnectionsLoading(false);
      });

    return () => { active = false; };
  }, []);

  return (
    <>
      <p className="intro">Dashboard figures and recent trades come from your JEXOVA journal.</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {pnlSummaryError && <p className="auth-error" role="alert">{pnlSummaryError}</p>}
      <section className="stat-grid">
        <Stat
          label="Recorded P&L"
          value={<MoneyTotals totals={pnlSummary?.recorded_pnl_by_currency ?? []} />}
          meta={`${performance.trades} closed ${performance.trades === 1 ? "trade" : "trades"}`}
        />
        <Stat label="Win rate" value={percent(performance.winRate)} meta={`${performance.wins} winning trades`} />
        <Stat label="Closed trades" value={String(performance.trades)} meta="From your recorded trade history" />
        <Stat label="Open trades" value={String(openCount)} meta="Currently recorded as open" />
      </section>
      <section className="card stack">
        <div className="panel-head"><h2>MT5-reported account balances</h2><a className="text-link" href="#settings">Manage connections</a></div>
        <p className="hint">Balances are the values most recently reported by MetaTrader 5; unavailable balances are not inferred.</p>
        {connectionsError && <p className="auth-error" role="alert">{connectionsError}</p>}
        {connectionsLoading
          ? <p className="hint" role="status">Loading account balances...</p>
          : connections.filter((connection) => connection.balance !== null && connection.balance !== undefined).length
            ? <div className="side-grid">
              {connections.filter((connection) => connection.balance !== null && connection.balance !== undefined).map((connection) => (
                <div className="mini-stat" key={connection.id}>
                  <span>{connection.account_name}</span>
                  <strong>{money(connection.balance, { currency: connection.currency })}</strong>
                </div>
              ))}
            </div>
            : <p className="empty">No MT5-reported account balances are available.</p>}
      </section>
      <section className="card stack">
        <div className="panel-head"><h2>Recent trades</h2><a className="text-link" href="#journal">View trade history</a></div>
        {loading
          ? <p className="hint" role="status">Loading your recorded trades...</p>
          : trades.length
            ? <TradeTable rows={trades.slice(0, 6)} />
            : <p className="empty">No trades have been recorded yet.</p>}
      </section>
    </>
  );
}

function Journal() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState("");
  const [side, setSide] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [outcome, setOutcome] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sort, setSort] = useState({ field: "trade_date", direction: "desc" });
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [editor, setEditor] = useState(null);
  const [deletingTradeId, setDeletingTradeId] = useState(null);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [notesSuccess, setNotesSuccess] = useState("");
  const rows = (result?.data ?? []).map((trade) => ({
    ...trade,
    ticket: trade.external_id,
    openedAt: trade.opened_at,
    closedAt: trade.closed_at,
    entry: trade.entry_price,
    exit: trade.exit_price,
    pnl: trade.pnl,
    quantity: trade.quantity,
    session: trade.trading_session,
    strategy: trade.strategy_name ?? "-"
  }));

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery === debouncedQuery) return undefined;

    const timeout = setTimeout(() => {
      setDebouncedQuery(normalizedQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, debouncedQuery]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError("");
    requestJson("/trade-options", { signal: controller.signal })
      .then((data) => {
        setAccounts(data.accounts);
        setStrategies(data.strategies);
        setEditor((current) => current && !current.id && !current.account_id && data.accounts.length
          ? { ...current, account_id: data.accounts[0].id }
          : current);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setOptionsError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      sort: sort.field,
      direction: sort.direction
    });
    if (debouncedQuery) params.set("search", debouncedQuery);
    if (status) params.set("status", status);
    if (side) params.set("side", side);
    if (strategyFilter) params.set("strategy_id", strategyFilter);
    if (outcome) params.set("outcome", outcome);
    if (fromDate) params.set("from_date", fromDate);
    if (toDate) params.set("to_date", toDate);
    setLoading(true);
    requestJson(`/trades?${params}`, { signal: controller.signal })
      .then((data) => {
        setResult(data);
        setError("");
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedQuery, status, side, strategyFilter, outcome, fromDate, toDate, page, perPage, sort, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryLoading(true);
    requestJson("/trade-summary", { signal: controller.signal })
      .then((data) => {
        setSummary(data);
        setSummaryError("");
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setSummaryError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  async function viewTrade(trade) {
    setSelectedTrade(null);
    setDetailsError("");
    setNotesDraft("");
    setNotesError("");
    setNotesSuccess("");
    setDetailsLoading(true);
    try {
      const response = await requestJson(`/trades/${trade.id}`);
      setSelectedTrade(response.data);
      setNotesDraft(response.data.notes ?? "");
    } catch (requestError) {
      setDetailsError(requestError.message);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function saveTradeNotes(event) {
    event.preventDefault();
    if (!selectedTrade) return;
    setNotesSaving(true);
    setNotesError("");
    setNotesSuccess("");
    try {
      const response = await requestJson(`/trades/${selectedTrade.id}/notes`, {
        method: "PUT",
        body: JSON.stringify({ notes: notesDraft })
      });
      setSelectedTrade((current) => current?.id === response.data.id
        ? { ...current, notes: response.data.notes }
        : current);
      setNotesDraft(response.data.notes ?? "");
      setNotesSuccess("Trade notes saved.");
    } catch (requestError) {
      setNotesError(requestError.message);
    } finally {
      setNotesSaving(false);
    }
  }

  async function deleteTradeNotes() {
    if (!selectedTrade || !window.confirm("Delete notes for this trade? The trade itself will remain.")) return;
    setNotesSaving(true);
    setNotesError("");
    setNotesSuccess("");
    try {
      await requestJson(`/trades/${selectedTrade.id}/notes`, { method: "DELETE" });
      setSelectedTrade((current) => current?.id === selectedTrade.id
        ? { ...current, notes: null }
        : current);
      setNotesDraft("");
      setNotesSuccess("Trade notes deleted.");
    } catch (requestError) {
      setNotesError(requestError.message);
    } finally {
      setNotesSaving(false);
    }
  }

  function startCreate() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const localNow = now.toISOString().slice(0, 16);
    setError("");
    setSuccess("");
    setFormErrors({});
    setEditor({
      id: null,
      account_id: accounts[0]?.id ?? "",
      strategy_name: "",
      symbol: "",
      side: "long",
      trading_session: "",
      market_condition: "",
      trend_direction: "",
      status: "closed",
      opened_at: localNow,
      closed_at: localNow,
      entry_price: "",
      exit_price: "",
      quantity: "",
      pnl: "0",
      risk_percentage: "",
      stop_loss: "",
      take_profit: "",
      timeframe: "",
      trade_source: "manual",
      lessons_learned: "",
      emotional_state: "",
      notes: "",
      before_image_url: null,
      after_image_url: null,
      before_image_file: null,
      after_image_file: null,
      remove_before_image: false,
      remove_after_image: false
    });
  }

  function startEdit(trade) {
    setError("");
    setSuccess("");
    setFormErrors({});
    setEditor({
      id: trade.id,
      account_id: trade.account_id,
      strategy_name: trade.strategy_name ?? "",
      external_id: trade.external_id ?? trade.ticket,
      symbol: trade.symbol,
      side: trade.side,
      trading_session: trade.trading_session ?? trade.session,
      market_condition: trade.market_condition ?? "",
      trend_direction: trade.trend_direction ?? "",
      status: trade.status,
      opened_at: trade.opened_at ?? trade.openedAt,
      closed_at: trade.closed_at ?? trade.closedAt ?? "",
      entry_price: trade.entry_price ?? trade.entry,
      exit_price: trade.exit_price ?? trade.exit ?? "",
      quantity: trade.quantity,
      pnl: trade.pnl,
      risk_percentage: trade.risk_percentage ?? "",
      stop_loss: trade.stop_loss ?? "",
      take_profit: trade.take_profit ?? "",
      timeframe: trade.timeframe ?? "",
      trade_source: trade.trade_source ?? "manual",
      lessons_learned: trade.lessons_learned ?? "",
      emotional_state: trade.emotional_state ?? "",
      before_image_url: trade.before_image_url ?? null,
      after_image_url: trade.after_image_url ?? null,
      before_image_file: null,
      after_image_file: null,
      remove_before_image: false,
      remove_after_image: false
    });
  }

  async function saveTrade(event) {
    event.preventDefault();
    if (!editor || saving || deletingTradeId !== null) return;
    if (!accounts.some((account) => String(account.id) === String(editor.account_id))) {
      setError("Select an available trading account before saving this trade.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    setFormErrors({});
    const payload = { ...editor, account_id: Number(editor.account_id) };
    delete payload.id;
    delete payload.before_image_url;
    delete payload.after_image_url;
    delete payload.before_image_file;
    delete payload.after_image_file;
    delete payload.remove_before_image;
    delete payload.remove_after_image;
    const hasImageChanges = Boolean(
      editor.before_image_file
      || editor.after_image_file
      || editor.remove_before_image
      || editor.remove_after_image
    );
    payload.strategy_name = editor.strategy_name.trim() || null;
    if (!editor.id) delete payload.external_id;
    if (payload.status === "open") {
      delete payload.closed_at;
      delete payload.exit_price;
    }

    try {
      const editingTradeId = editor.id;
      let options;
      if (hasImageChanges) {
        const body = new FormData();
        for (const [field, value] of Object.entries(payload)) {
          if (value !== undefined && value !== null) body.append(field, String(value));
        }
        if (editor.before_image_file) body.append("before_image", editor.before_image_file);
        if (editor.after_image_file) body.append("after_image", editor.after_image_file);
        if (editor.remove_before_image) body.append("remove_before_image", "1");
        if (editor.remove_after_image) body.append("remove_after_image", "1");
        if (editor.id) body.append("_method", "PUT");
        options = { method: "POST", body };
      } else {
        options = {
          method: editor.id ? "PUT" : "POST",
          body: JSON.stringify(payload)
        };
      }

      const saved = await requestJson(editor.id ? `/trades/${editor.id}` : "/trades", options);
      announceTradeDataChanged();
      if (saved.data?.strategy_id && saved.data.strategy_name) {
        setStrategies((current) => current.some((strategy) => Number(strategy.id) === Number(saved.data.strategy_id))
          ? current.map((strategy) => Number(strategy.id) === Number(saved.data.strategy_id)
            ? { ...strategy, name: saved.data.strategy_name, notes: saved.data.strategy_notes }
            : strategy)
          : [...current, {
            id: saved.data.strategy_id,
            account_id: saved.data.account_id,
            name: saved.data.strategy_name,
            notes: saved.data.strategy_notes
          }]);
      }
      setEditor(null);
      setSuccess(editor.id ? "Trade updated successfully." : "Trade saved successfully.");
      setPage(1);
      setRefresh((value) => value + 1);
      if (editingTradeId && selectedTrade?.id === editingTradeId) {
        await viewTrade({ id: editingTradeId });
      }
    } catch (requestError) {
      setError(requestError.message);
      setFormErrors(requestError.validation ?? {});
    } finally {
      setSaving(false);
    }
  }

  async function deleteTrade(trade) {
    if (saving || deletingTradeId !== null) return;
    const tradeLabel = trade.external_id ?? trade.ticket ?? trade.id;
    if (!window.confirm(`Delete ${trade.symbol} trade ${tradeLabel}? This cannot be undone.`)) return;
    setDeletingTradeId(trade.id);
    setError("");
    setSuccess("");
    try {
      await requestJson(`/trades/${trade.id}`, { method: "DELETE" });
      announceTradeDataChanged();
      setSuccess("Trade deleted successfully.");
      setSelectedTrade((current) => current?.id === trade.id ? null : current);
      setEditor((current) => current?.id === trade.id ? null : current);
      setPage(1);
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingTradeId(null);
    }
  }

  function updateEditor(field, value) {
    setEditor((current) => field === "market_condition" && value !== "Trending"
      ? { ...current, [field]: value, trend_direction: "" }
      : { ...current, [field]: value });
  }

  function retryAccountOptions() {
    setOptionsRetry((attempt) => attempt + 1);
  }

  function changeSort(field) {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === "asc" ? "desc" : "asc"
    }));
    setPage(1);
  }

  const editorStrategies = strategies.filter((strategy) => String(strategy.account_id) === String(editor?.account_id));
  const editorAccount = accounts.find((account) => String(account.id) === String(editor?.account_id));
  const formattedEditorPnl = formatTradePnl(editor?.pnl, editorAccount?.currency);
  const validationMessages = Object.values(formErrors).flat();

  return (
    <article className="card">
      <div className="journal-toolbar">
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search instrument"
            aria-label="Search by instrument"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          />
          <select aria-label="Filter by position status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All position statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <select aria-label="Filter by strategy" value={strategyFilter} onChange={(event) => { setStrategyFilter(event.target.value); setPage(1); }}>
            <option value="">All strategies</option>
            {strategies.map((strategy) => <option value={strategy.id} key={strategy.id}>{strategy.name}</option>)}
          </select>
          <select aria-label="Filter by direction" value={side} onChange={(event) => { setSide(event.target.value); setPage(1); }}>
            <option value="">All directions</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
          <select aria-label="Filter by result" value={outcome} onChange={(event) => { setOutcome(event.target.value); setPage(1); }}>
            <option value="">All results</option>
            <option value="winning">Winning trades</option>
            <option value="losing">Losing trades</option>
          </select>
          <label className="history-date-filter">From
            <input aria-label="Trade date from" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} />
          </label>
          <label className="history-date-filter">To
            <input aria-label="Trade date to" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} />
          </label>
          <label className="history-page-size">Rows
            <select aria-label="Rows per page" value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </label>
        </div>
        <button className="btn btn-primary" type="button" onClick={startCreate} aria-busy={optionsLoading}>
          Add Trade
        </button>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {success && <p className="auth-status" role="status">{success}</p>}
      {optionsError && (
        <div className="auth-error" role="alert">
          <span>Could not load trading accounts. {optionsError}</span>{" "}
          <button className="text-link" type="button" onClick={retryAccountOptions} disabled={optionsLoading}>Retry</button>
        </div>
      )}
      {!accounts.length && !optionsLoading && !optionsError && <p className="hint" role="status">No trading account is linked to your profile yet. Add a manual account in Settings to save trades; MT5 is not required.</p>}
      <section className="trade-summary" aria-label="Trade statistics" aria-busy={summaryLoading}>
        {summaryError && <p className="auth-error" role="alert">{summaryError}</p>}
        {summaryLoading && !summary
          ? <p className="hint" role="status">Loading trade statistics...</p>
          : summary && <>
            <div><span>Total trades</span><strong>{summary.total_trades}</strong></div>
            <div><span>Open trades</span><strong>{summary.open_trades}</strong></div>
            <div><span>Closed trades</span><strong>{summary.closed_trades}</strong></div>
            <div><span>Recorded P&amp;L (closed)</span><strong><MoneyTotals totals={summary.recorded_pnl_by_currency ?? []} /></strong></div>
          </>}
      </section>
      {(detailsLoading || detailsError || selectedTrade) && (
        <section className="trade-detail-panel" aria-labelledby="trade-detail-title">
          <div className="panel-head">
            <h2 id="trade-detail-title">Trade details</h2>
            <button className="text-link" type="button" onClick={() => {
              setSelectedTrade(null);
              setDetailsError("");
            }}>Close details</button>
          </div>
          {detailsLoading && <p className="hint" role="status">Loading trade details...</p>}
          {detailsError && <p className="auth-error" role="alert">{detailsError}</p>}
          {selectedTrade && (
            <>
              <dl className="trade-detail-grid">
                <div><dt>Account</dt><dd>{selectedTrade.account_name}</dd></div>
                <div><dt>Platform / currency</dt><dd>{selectedTrade.account_platform}  |  {selectedTrade.account_currency}</dd></div>
                <div><dt>Trade date</dt><dd>{selectedTrade.opened_at}</dd></div>
                <div><dt>Exit date</dt><dd>{selectedTrade.closed_at ?? "-"}</dd></div>
                <div><dt>Instrument</dt><dd>{selectedTrade.symbol}</dd></div>
                <div><dt>Direction</dt><dd>{selectedTrade.side === "long" ? "Long" : "Short"}</dd></div>
                <div><dt>Position status</dt><dd>{selectedTrade.status === "open" ? "Open" : "Closed"}</dd></div>
                <div><dt>Strategy</dt><dd>{selectedTrade.strategy_name ?? "-"}</dd></div>
                <div><dt>Strategy description</dt><dd>{selectedTrade.strategy_notes || "No strategy description recorded."}</dd></div>
                <div><dt>Market condition</dt><dd>{selectedTrade.market_condition ?? "-"}</dd></div>
                <div><dt>Trend direction</dt><dd>{selectedTrade.trend_direction ?? "-"}</dd></div>
                <div><dt>Trading session</dt><dd>{selectedTrade.trading_session}</dd></div>
                <div><dt>Entry price</dt><dd>{formatPrice(selectedTrade.symbol, selectedTrade.entry_price)}</dd></div>
                <div><dt>Exit price</dt><dd>{formatPrice(selectedTrade.symbol, selectedTrade.exit_price)}</dd></div>
                <div><dt>{positionSizeLabel(selectedTrade.symbol)}</dt><dd>{formatPositionSize(selectedTrade.symbol, selectedTrade.quantity)}</dd></div>
                <div><dt>R-multiple</dt><dd>{formatRMultiple(selectedTrade.r_multiple)}</dd></div>
                <div><dt>Profit / loss</dt><dd>{money(selectedTrade.pnl, { sign: true, currency: selectedTrade.account_currency })}</dd></div>
                <div><dt>External ID</dt><dd>{selectedTrade.external_id}</dd></div>
                <div><dt>Created</dt><dd>{selectedTrade.created_at ?? "-"}</dd></div>
                <div><dt>Updated</dt><dd>{selectedTrade.updated_at ?? "-"}</dd></div>
              </dl>
              <section className="trade-attachments" aria-label="Trade images">
                {[
                  ["Before Trade", selectedTrade.before_image_url],
                  ["After Trade", selectedTrade.after_image_url]
                ].map(([label, imageUrl]) => (
                  <figure key={label}>
                    <figcaption>{label}</figcaption>
                    {imageUrl
                      ? <img className="trade-image-preview" src={imageUrl} alt={`${label} image`} />
                      : <p className="hint">No image attached.</p>}
                  </figure>
                ))}
              </section>
              <div className="trade-detail-actions">
                <button className="btn" type="button" onClick={() => startEdit(selectedTrade)} disabled={saving || deletingTradeId !== null}>
                  Edit Trade
                </button>
                <button className="btn danger-link" type="button" onClick={() => deleteTrade(selectedTrade)} disabled={saving || deletingTradeId !== null}>
                  {deletingTradeId === selectedTrade.id ? "Deleting..." : "Delete Trade"}
                </button>
              </div>
              <section className="trade-notes-editor" aria-labelledby="trade-notes-title">
                <h3 id="trade-notes-title">Trade notes</h3>
                <p className="hint">
                  {selectedTrade.notes ? "Notes saved for this trade." : "No trade notes yet. Add notes specific to this trade."}
                </p>
                <form onSubmit={saveTradeNotes}>
                  <label htmlFor="trade-notes">Notes</label>
                  <textarea
                    id="trade-notes"
                    name="notes"
                    aria-label="Trade notes"
                    rows="5"
                    maxLength="10000"
                    value={notesDraft}
                    onChange={(event) => {
                      setNotesDraft(event.target.value);
                      setNotesError("");
                      setNotesSuccess("");
                    }}
                  />
                  {notesError && <p className="auth-error" role="alert">{notesError}</p>}
                  {notesSuccess && <p className="auth-status" role="status">{notesSuccess}</p>}
                  <div className="trade-notes-actions">
                    <button className="btn btn-primary" type="submit" disabled={notesSaving}>
                      {notesSaving ? "Saving..." : "Save notes"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={deleteTradeNotes}
                      disabled={notesSaving || !selectedTrade.notes}
                    >
                      Delete notes
                    </button>
                  </div>
                </form>
              </section>
            </>
          )}
        </section>
      )}
      {editor && (
        <form className="trade-editor" onSubmit={saveTrade}>
          <div className="panel-head">
            <h2>{editor.id ? "Edit trade" : "New trade"}</h2>
            <button className="text-link" type="button" onClick={() => setEditor(null)}>Cancel</button>
          </div>
          {validationMessages.length > 0 && (
            <ul className="auth-error" role="alert">
              {validationMessages.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
            </ul>
          )}
          <div className="trade-form-grid">
            {editor.id || accounts.length > 1 ? <label>
              <span className="trade-field-label">Trading account <span className="trade-field-indicator">Required</span></span>
              <select name="account_id" required value={editor.account_id} onChange={(event) => {
                updateEditor("account_id", event.target.value);
                updateEditor("strategy_name", "");
              }}>
                {editor.id && !accounts.some((account) => String(account.id) === String(editor.account_id)) && (
                  <option value={editor.account_id}>{optionsLoading ? "Loading account..." : "Account unavailable"}</option>
                )}
                {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
              </select>
            </label> : <>
              <input type="hidden" name="account_id" value={editor.account_id} />
              {optionsLoading
                ? <p className="hint" role="status">Loading trading accounts...</p>
                : accounts.length === 1
                  ? <p className="hint">Trading account: {accounts[0].name}</p>
                  : optionsError
                    ? <p className="hint">Account options are unavailable. Retry loading them above.</p>
                    : <p className="hint" role="status">
                      No trading accounts are linked. <a className="text-link" href="#settings">Open Settings to create a manual account; MT5 is optional.</a>
                    </p>}
            </>}
            <label>
              <span className="trade-field-label">Strategy name <span className="trade-field-indicator">Optional</span></span>
              <input
                name="strategy_name"
                list="trade-strategy-suggestions"
                maxLength="120"
                value={editor.strategy_name}
                onChange={(event) => updateEditor("strategy_name", event.target.value)}
              />
              <datalist id="trade-strategy-suggestions">
                {editorStrategies.map((strategy) => <option value={strategy.name} key={strategy.id} />)}
              </datalist>
            </label>
            <label>
              <span className="trade-field-label">Market condition <span className="trade-field-indicator">Required</span></span>
              <select name="market_condition" required value={editor.market_condition} onChange={(event) => updateEditor("market_condition", event.target.value)}>
                <option value="">Select a market condition</option>
                <option value="Trending">Trending</option>
                <option value="Ranging">Ranging</option>
              </select>
            </label>
            {editor.market_condition === "Trending" && <label>
              <span className="trade-field-label">Trend direction <span className="trade-field-indicator">Required</span></span>
              <select name="trend_direction" required value={editor.trend_direction} onChange={(event) => updateEditor("trend_direction", event.target.value)}>
                <option value="">Select a trend direction</option>
                <option value="Bullish">Bullish</option>
                <option value="Bearish">Bearish</option>
              </select>
            </label>}
            {editor.id && <label>
              <span className="trade-field-label">External ID <span className="trade-field-indicator">Required</span></span>
              <input name="external_id" required maxLength="80" value={editor.external_id} onChange={(event) => updateEditor("external_id", event.target.value)} />
            </label>
            }
            <label>
              <span className="trade-field-label">Instrument / pair <span className="trade-field-indicator">Required</span></span>
              <input name="symbol" required maxLength="32" value={editor.symbol} onChange={(event) => updateEditor("symbol", event.target.value)} />
            </label>
            <label>
              <span className="trade-field-label">Direction <span className="trade-field-indicator">Required</span></span>
              <select name="side" required value={editor.side} onChange={(event) => updateEditor("side", event.target.value)}>
                <option value="long">Long</option><option value="short">Short</option>
              </select>
            </label>
            <label>
              <span className="trade-field-label">Trading session <span className="trade-field-indicator">Required</span></span>
              <select name="trading_session" required value={editor.trading_session} onChange={(event) => updateEditor("trading_session", event.target.value)}>
                <option value="">Select a trading session</option>
                {!tradingSessions.includes(editor.trading_session) && editor.trading_session && <option value={editor.trading_session}>Existing session: {editor.trading_session}</option>}
                {tradingSessions.map((session) => <option value={session} key={session}>{session}</option>)}
              </select>
            </label>
            <label>
              <span className="trade-field-label">Position status <span className="trade-field-indicator">Required</span></span>
              <select name="status" required value={editor.status} onChange={(event) => updateEditor("status", event.target.value)}>
                <option value="open">Open</option><option value="closed">Closed</option>
              </select>
            </label>
            <label>
              <span className="trade-field-label">Entry date and time <span className="trade-field-indicator">Required</span></span>
              <input name="opened_at" required type="datetime-local" value={editor.opened_at} onChange={(event) => updateEditor("opened_at", event.target.value)} />
            </label>
            <label>
              <span className="trade-field-label">Entry price <span className="trade-field-indicator">Required</span></span>
              <TradePriceInput name="entry_price" label="Entry price" value={editor.entry_price} onChange={(value) => updateEditor("entry_price", value)} />
            </label>
            <label>
              <span className="trade-field-label">Lot Size <span className="trade-field-indicator">Required</span></span>
              <input name="quantity" required type="number" min="0.01" step="0.01" value={editor.quantity} onChange={(event) => updateEditor("quantity", event.target.value)} />
            </label>
            {editor.status === "closed" && <>
              <label>
                <span className="trade-field-label">Exit date and time <span className="trade-field-indicator">Required</span></span>
                <input name="closed_at" required type="datetime-local" value={editor.closed_at} onChange={(event) => updateEditor("closed_at", event.target.value)} />
              </label>
              <label>
                <span className="trade-field-label">Exit price <span className="trade-field-indicator">Required</span></span>
                <TradePriceInput name="exit_price" label="Exit price" value={editor.exit_price} onChange={(value) => updateEditor("exit_price", value)} />
              </label>
            </>}
            <label>
              <span className="trade-field-label">Risk percentage <span className="trade-field-indicator">Optional</span></span>
              <span className="trade-percentage-control">
                <input name="risk_percentage" type="number" min="0" max="999999.9999" step="0.0001" inputMode="decimal" value={editor.risk_percentage} onChange={(event) => updateEditor("risk_percentage", event.target.value)} />
                <span className="trade-percentage-suffix" aria-hidden="true">%</span>
              </span>
            </label>
            <label>
              <span className="trade-field-label">Stop loss <span className="trade-field-indicator">Optional</span></span>
              <TradePriceInput name="stop_loss" label="Stop loss" value={editor.stop_loss} onChange={(value) => updateEditor("stop_loss", value)} />
            </label>
            <label>
              <span className="trade-field-label">Take profit <span className="trade-field-indicator">Optional</span></span>
              <TradePriceInput name="take_profit" label="Take profit" value={editor.take_profit} onChange={(value) => updateEditor("take_profit", value)} />
            </label>
            <label>
              <span className="trade-field-label">Timeframe <span className="trade-field-indicator">Optional</span></span>
              <input name="timeframe" maxLength="32" value={editor.timeframe} onChange={(event) => updateEditor("timeframe", event.target.value)} />
            </label>
            <label>
              <span className="trade-field-label">Trade source <span className="trade-field-indicator">Required</span></span>
              <select name="trade_source" value={editor.trade_source} onChange={(event) => updateEditor("trade_source", event.target.value)}>
                <option value="manual">Manual</option>
                <option value="imported">Imported</option>
              </select>
            </label>
            <label>
              <span className="trade-field-label">Emotional state <span className="trade-field-indicator">Optional</span></span>
              <input name="emotional_state" maxLength="40" value={editor.emotional_state} onChange={(event) => updateEditor("emotional_state", event.target.value)} />
            </label>
            <label>
              <span className="trade-field-label">PnL <span className="trade-field-indicator">Required</span></span>
              <input name="pnl" required type="number" step="0.01" value={editor.pnl} onChange={(event) => updateEditor("pnl", event.target.value)} />
              <output className={`trade-pnl-display${formattedEditorPnl ? ` ${pnlClass(editor.pnl)}` : ""}`} aria-label="Formatted PnL">{formattedEditorPnl}</output>
            </label>
            {!editor.id && <label className="trade-notes-field">
              <span className="trade-field-label">Trade notes <span className="trade-field-indicator">Optional</span></span>
              <textarea name="notes" rows="4" maxLength="10000" value={editor.notes} onChange={(event) => updateEditor("notes", event.target.value)} />
            </label>}
          </div>
          <div className="trade-image-grid">
            <TradeImageField
              label="Before Trade"
              imageUrl={editor.before_image_url}
              file={editor.before_image_file}
              removed={editor.remove_before_image}
              onFileChange={(file) => updateEditor("before_image_file", file)}
              onRemoveChange={(removed) => updateEditor("remove_before_image", removed)}
            />
            <TradeImageField
              label="After Trade"
              imageUrl={editor.after_image_url}
              file={editor.after_image_file}
              removed={editor.remove_after_image}
              onFileChange={(file) => updateEditor("after_image_file", file)}
              onRemoveChange={(removed) => updateEditor("remove_after_image", removed)}
            />
          </div>
          <p className="hint">Closed trades require a recorded P&amp;L; open trades start at 0.00. P&amp;L is stored as entered because no reliable price-to-currency calculation rule exists for every instrument.</p>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={saving || !accounts.some((account) => String(account.id) === String(editor.account_id))}
          >
            {saving ? "Saving..." : editor.id ? "Save changes" : "Create trade"}
          </button>
        </form>
      )}
      {result && <p className="hint">{loading ? "Refreshing trades..." : `Showing ${rows.length} of ${result.total} trades  |  Page ${result.current_page} of ${result.last_page}`}</p>}
      {loading && !result
        ? <p className="hint" role="status">Loading trades...</p>
        : <TradeTable
          rows={rows}
          onEdit={startEdit}
          onDelete={deleteTrade}
          onView={viewTrade}
          deletingTradeId={deletingTradeId}
          saving={saving}
          sort={sort}
          onSort={changeSort}
        />}
      {result && result.last_page > 1 && (
        <div className="pagination">
          <button className="btn" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>Previous</button>
          <span>Page {result.current_page} of {result.last_page}</span>
          <button className="btn" type="button" onClick={() => setPage((value) => Math.min(result.last_page, value + 1))} disabled={page >= result.last_page || loading}>Next</button>
        </div>
      )}
    </article>
  );
}

async function requestJson(url, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      "X-CSRF-TOKEN": document.querySelector('meta[name="csrf-token"]')?.content ?? "",
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) throw parseError;
      const error = new Error(
        response.ok
          ? "The server returned an empty or invalid JSON response."
          : `The server returned an invalid response (HTTP ${response.status}).`
      );
      error.status = response.status;
      throw error;
    }
  }
  if (!response.ok) {
    const error = new Error(data?.message ?? `The request could not be completed (HTTP ${response.status}).`);
    error.status = response.status;
    error.validation = data?.errors;
    throw error;
  }
  return data;
}

function Calendar() {
  const { trades, loading, error } = useDatabaseTrades();
  const [month, setMonth] = useState(() => latestTradeMonth([]));
  const [selectedDate, setSelectedDate] = useState(null);
  useEffect(() => {
    if (!loading) setMonth(latestTradeMonth(trades));
  }, [loading, trades]);

  const monthDate = new Date(month.year, month.month, 1);
  const label = monthDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const bounds = monthBounds(trades);
  const atStart = sameMonth(month, bounds.start);
  const atEnd = sameMonth(month, bounds.end);
  const dayCount = new Date(month.year, month.month + 1, 0).getDate();
  const leadingDays = monthDate.getDay();
  const todayKey = monthKey(new Date());
  const selectedRows = selectedDate ? tradesOn(trades, selectedDate) : [];

  function changeMonth(offset) {
    const date = new Date(month.year, month.month + offset, 1);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
    setSelectedDate(null);
  }

  if (loading) return <p className="hint" role="status">Loading your recorded trades...</p>;
  if (error) return <p className="auth-error" role="alert">{error}</p>;
  if (trades.length === 0) return <p className="empty">No trades are available for the calendar yet.</p>;

  return (
    <>
      <div className="cal-nav">
        <button type="button" className="btn" onClick={() => changeMonth(-1)} disabled={atStart}>Previous</button>
        <h2>{label}</h2>
        <button type="button" className="btn" onClick={() => changeMonth(1)} disabled={atEnd}>Next</button>
      </div>
      <div className="cal-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className="cal-dow" key={day}>{day}</div>)}
        {Array.from({ length: leadingDays }, (_, index) => <div className="cal-pad" key={`pad-${index}`} />)}
        {Array.from({ length: dayCount }, (_, index) => {
          const date = new Date(month.year, month.month, index + 1);
          const key = monthKey(date);
          const rows = tradesOn(trades, key);
          const realizedRows = closedTrades(rows);
          const totals = moneyTotals(realizedRows);
          const allPositive = totals.length > 0 && totals.every((total) => Number(total.amount) > 0);
          const allNegative = totals.length > 0 && totals.every((total) => Number(total.amount) < 0);
          const classes = ["cal-day"];
          if (rows.length) classes.push("has-trades");
          if (allPositive) classes.push("is-pos");
          if (allNegative) classes.push("is-neg");
          if (key === todayKey) classes.push("is-today");
          if (key === selectedDate) classes.push("is-selected");
          return (
            <button
              type="button"
              className={classes.join(" ")}
              data-date={key}
              key={key}
              onClick={() => setSelectedDate(selectedDate === key ? null : key)}
            >
              <span className="cal-num">{index + 1}</span>
              {rows.length > 0 && (
                <>
                  {totals.map((total) => (
                    <span className={`cal-pnl ${pnlClass(total.amount)}`} key={total.currency}>
                      {money(total.amount, { sign: true, currency: total.currency })}
                    </span>
                  ))}
                  <span className="cal-count">{rows.length} {rows.length === 1 ? "trade" : "trades"}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <section className="card stack" id="day-detail">
        {selectedDate ? (
          <>
            <div className="panel-head">
              <h2>{formatDate(`${selectedDate}T12:00:00`)}</h2>
              <span>{selectedRows.length} {selectedRows.length === 1 ? "trade" : "trades"}</span>
            </div>
            <TradeTable rows={selectedRows} />
          </>
        ) : (
          <>
            <h2>Day detail</h2>
            <p className="note">Select a highlighted day to list its trades.</p>
          </>
        )}
      </section>
    </>
  );
}

function Analytics() {
  const { trades, loading, error } = useDatabaseTrades();
  const closed = closedTrades(trades);
  const strategies = groupTrades(closed, "strategy");
  const sessions = groupTrades(closed, "session");
  const sides = groupTrades(closed, "side");

  if (loading) return <p className="hint" role="status">Loading your recorded trades...</p>;
  if (error) return <p className="auth-error" role="alert">{error}</p>;
  if (closed.length === 0) return <p className="empty">Analytics will appear after you record a closed trade.</p>;

  return (
    <>
      <p className="intro">These breakdowns are calculated from your closed, database-backed trades.</p>
      <section className="split">
        <article className="card">
          <div className="panel-head"><h2>By strategy</h2><span>Win rate</span></div>
          <div className="bar-list">
            {strategies.map((item) => (
              <div key={item.name}>
                <div className="bar-top">
                  <span>{item.name}</span>
                  <MoneyTotals totals={item.netPnlByCurrency} />
                </div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round(item.winRate * 100)}%` }} /></div>
                <p className="hint">{percent(item.winRate)}  |  {item.trades} trades</p>
              </div>
            ))}
          </div>
        </article>
        <article className="card">
          <div className="panel-head"><h2>By session</h2></div>
          <div className="bar-list">
            {sessions.map((item) => (
              <div key={item.name}>
                <div className="bar-top"><span>{item.name}</span><span>{item.trades} trades</span></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round(item.winRate * 100)}%` }} /></div>
                <p className="hint"><MoneyTotals totals={item.netPnlByCurrency} />  |  {percent(item.winRate)} win rate</p>
              </div>
            ))}
          </div>
        </article>
      </section>
      <section className="card stack">
        <div className="panel-head"><h2>Long versus short</h2><span>{closed.length} closed trades</span></div>
        <div className="side-grid">
          {sides.map((side) => (
            <div className="mini-stat" key={side.name}>
              <span className={`badge badge-${side.name}`}>{side.name}</span>
              <strong><MoneyTotals totals={side.netPnlByCurrency} /></strong>
              <span>{percent(side.winRate)} win rate  |  {side.trades} trades</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Strategies() {
  const { options, loading: optionsLoading, error: optionsError, refresh: refreshTradeOptions } = useTradeOptions();
  const { trades, loading: tradesLoading, error: tradesError } = useDatabaseTrades();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accountId && options.accounts.length) setAccountId(String(options.accounts[0].id));
  }, [accountId, options.accounts]);

  async function saveStrategy(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await requestJson("/strategies", {
        method: "POST",
        body: JSON.stringify({ account_id: Number(accountId), name: name.trim(), notes: notes.trim() || null })
      });
      setName("");
      setNotes("");
      setFormOpen(false);
      setNotice("Strategy created successfully.");
      refreshTradeOptions();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteStrategy(strategy) {
    if (!window.confirm(`Delete ${strategy.name}? Trades assigned to it will become unassigned.`)) return;
    setError("");
    setNotice("");
    try {
      await requestJson(`/strategies/${strategy.id}`, { method: "DELETE" });
      setNotice("Strategy deleted successfully.");
      refreshTradeOptions();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function editStrategy(strategy) {
    const nameValue = window.prompt("Strategy name", strategy.name)?.trim();
    if (!nameValue) return;
    const notesValue = window.prompt("Strategy description", strategy.notes ?? "")?.trim() ?? null;
    setError("");
    setNotice("");
    try {
      await requestJson(`/strategies/${strategy.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: nameValue, notes: notesValue })
      });
      setNotice("Strategy updated successfully.");
      refreshTradeOptions();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  if (optionsLoading || tradesLoading) return <p className="hint" role="status">Loading your saved strategies...</p>;
  if (optionsError) return <p className="auth-error" role="alert">{optionsError}</p>;
  if (tradesError) return <p className="auth-error" role="alert">{tradesError}</p>;
  if (options.strategies.length === 0 && !formOpen) {
    return (
      <section className="card stack">
        <p className="empty">No strategies have been added to your journal yet.</p>
        <button className="btn btn-primary" type="button" onClick={() => setFormOpen(true)}>Create strategy</button>
      </section>
    );
  }

  return (
    <>
      <p className="intro">Strategy summaries use trades assigned to strategies saved in your journal.</p>
      {notice && <p className="auth-status" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="journal-toolbar">
        <button className="btn btn-primary" type="button" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? "Cancel" : "Create strategy"}
        </button>
      </div>
      {formOpen && (
        <form className="trade-editor" onSubmit={saveStrategy}>
          <div className="trade-form-grid">
            {options.accounts.length > 1 && (
              <label>
                <span className="trade-field-label">Trading account</span>
                <select required value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  {options.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
                </select>
              </label>
            )}
            <label>
              <span className="trade-field-label">Strategy name</span>
              <input required maxLength="120" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="trade-notes-field">
              <span className="trade-field-label">Description</span>
              <textarea rows="4" maxLength="10000" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save strategy"}</button>
        </form>
      )}
      <div className="strategy-grid">
        {options.strategies.map((strategy) => {
          const rows = closedTrades(trades).filter((trade) => Number(trade.strategy_id) === Number(strategy.id));
          const summary = summarizeTrades(rows);
          return (
            <article className="card strategy-card" key={strategy.id}>
              <span className="panel-kicker">Strategy</span>
              <h3>{strategy.name}</h3>
              <p>{summary.trades ? `${summary.trades} closed ${summary.trades === 1 ? "trade" : "trades"} in your journal.` : "No closed trades are assigned to this strategy yet."}</p>
              <div className="meta-row"><span>{summary.trades} trades</span><span>{percent(summary.winRate)}</span></div>
              <div className="meta-row">
                <span>Net</span>
                <MoneyTotals totals={summary.netPnlByCurrency} />
              </div>
              <div className="trade-detail-actions">
                <button className="text-link" type="button" onClick={() => editStrategy(strategy)}>Edit strategy</button>
                <button className="text-link danger-link" type="button" onClick={() => deleteStrategy(strategy)}>Delete strategy</button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Settings() {
  const { options, loading: optionsLoading, error: optionsError, refresh: refreshTradeOptions } = useTradeOptions();
  const [connections, setConnections] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState("");
  const [accountName, setAccountName] = useState("My MT5 account");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [localConnectorReady, setLocalConnectorReady] = useState(false);
  const [localConnectorLoading, setLocalConnectorLoading] = useState(true);
  const [syncingId, setSyncingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [disconnectingId, setDisconnectingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");
  const [accountValidationErrors, setAccountValidationErrors] = useState({});
  const [accountDraft, setAccountDraft] = useState({
    name: "",
    account_type: "",
    broker_name: "",
    platform: "",
    currency: "USD",
    starting_balance: "0.00",
    account_reference: "",
    nominal_account_size: "",
    challenge_phase: ""
  });

  function updateAccountDraft(field, value) {
    setAccountDraft((current) => ({ ...current, [field]: value }));
    setAccountValidationErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function createManualAccount(event) {
    event.preventDefault();
    if (accountSaving) return;
    setAccountSaving(true);
    setAccountError("");
    setAccountSuccess("");
    setAccountValidationErrors({});

    const payload = {
      ...accountDraft,
      connection_method: "manual",
      account_reference: accountDraft.account_reference.trim() || null
    };
    if (payload.account_type === "prop_firm") {
      payload.nominal_account_size = payload.nominal_account_size || null;
      payload.challenge_phase = payload.challenge_phase || null;
    } else {
      delete payload.nominal_account_size;
      delete payload.challenge_phase;
    }

    try {
      const response = await requestJson("/accounts", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (!Number.isInteger(Number(response?.data?.id)) || typeof response?.data?.name !== "string") {
        throw new Error("The server did not return the saved account record.");
      }
      setAccountSuccess(`${response.data.name} added to your accounts.`);
      setAccountFormOpen(false);
      setAccountDraft({
        name: "",
        account_type: "",
        broker_name: "",
        platform: "",
        currency: "USD",
        starting_balance: "0.00",
        account_reference: "",
        nominal_account_size: "",
        challenge_phase: ""
      });
      refreshTradeOptions();
    } catch (requestError) {
      setAccountError(requestError.message);
      setAccountValidationErrors(requestError.validation ?? {});
    } finally {
      setAccountSaving(false);
    }
  }

  async function refreshConnections() {
    setConnectionsError("");
    try {
      const response = await requestJson("/mt5/connections");
      setConnections(response.data);
    } catch (requestError) {
      setConnectionsError(requestError.message);
    } finally {
      setConnectionsLoading(false);
    }
  }

  async function checkLocalConnector() {
    setLocalConnectorLoading(true);
    try {
      const response = await fetch("http://127.0.0.1:47620/health", {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Local connector is unavailable.");
      const result = await response.json();
      setLocalConnectorReady(result.data?.status === "ready");
    } catch {
      setLocalConnectorReady(false);
    } finally {
      setLocalConnectorLoading(false);
    }
  }

  useEffect(() => {
    refreshConnections();
    checkLocalConnector();
    const timer = window.setInterval(checkLocalConnector, 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function connectorRequest(path, payload) {
    let response;
    try {
      response = await fetch(`http://127.0.0.1:47620${path}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch {
      throw new Error("The local connector is unavailable. Start or install it, then try again.");
    }
    let result = {};
    try {
      result = await response.json();
    } catch {
      throw new Error("The local connector returned an invalid response.");
    }
    if (!response.ok) throw new Error(mt5ErrorMessage(result.error));
    return result.data;
  }

  async function createPairing(event) {
    event.preventDefault();
    setPairingLoading(true);
    setConnectionsError("");
    setNotice("");
    try {
      const health = await fetch("http://127.0.0.1:47620/health", {
        headers: { Accept: "application/json" }
      });
      if (!health.ok || (await health.json()).data?.status !== "ready") {
        setLocalConnectorReady(false);
        throw new Error("Install or start the local MT5 connector before connecting an account.");
      }
      const response = await requestJson("/mt5/pairings", {
        method: "POST",
        body: JSON.stringify({ account_name: accountName })
      });
      const detected = await connectorRequest("/pair", { pairing_code: response.data.pairing_code });
      setNotice(`Account detected: ${detected.login_masked}  |  ${detected.server}. Confirm the account below to enable synchronization.`);
      await refreshConnections();
    } catch (requestError) {
      setConnectionsError(requestError.message);
    } finally {
      setPairingLoading(false);
    }
  }

  async function confirmAccount(connection) {
    setConfirmingId(connection.id);
    setConnectionsError("");
    setNotice("");
    try {
      await requestJson(`/mt5/connections/${connection.id}/confirm`, { method: "POST" });
      setNotice("Trading account confirmed. Synchronization is now available.");
      await refreshConnections();
    } catch (requestError) {
      setConnectionsError(requestError.message);
    } finally {
      setConfirmingId(null);
    }
  }

  async function requestSync(connectionId) {
    setSyncingId(connectionId);
    setConnectionsError("");
    setNotice("");
    try {
      await requestJson(`/mt5/connections/${connectionId}/sync`, { method: "POST" });
      setNotice("Synchronization queued. The local connector will process it in the background.");
      await refreshConnections();
    } catch (requestError) {
      setConnectionsError(requestError.message);
    } finally {
      setSyncingId(null);
    }
  }

  async function disconnectAccount(connection) {
    if (!window.confirm(`Disconnect ${connection.account_name}? Imported records will be preserved.`)) return;
    setDisconnectingId(connection.id);
    setConnectionsError("");
    setNotice("");
    try {
      await requestJson(`/mt5/connections/${connection.id}/revoke`, { method: "POST" });
      try {
        await connectorRequest("/disconnect", { connection_id: connection.id });
        setNotice("Trading account disconnected. Imported records were preserved.");
      } catch {
        setNotice("Trading account disconnected in JEXOVA. The local connector is unavailable; remove its saved access when it is running.");
      }
      await refreshConnections();
    } catch (requestError) {
      setConnectionsError(requestError.message);
    } finally {
      setDisconnectingId(null);
    }
  }

  async function removeLocalAccess(connectionId) {
    setDisconnectingId(connectionId);
    setConnectionsError("");
    setNotice("");
    try {
      await connectorRequest("/disconnect", { connection_id: connectionId });
      setNotice("Saved local connector access removed.");
    } catch (requestError) {
      setConnectionsError(requestError.message);
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <div className="settings-grid">
      <article className="card">
        <div className="panel-head">
          <h2>Trading accounts</h2>
          <button className="btn btn-primary" type="button" onClick={() => {
            setAccountError("");
            setAccountSuccess("");
            setAccountValidationErrors({});
            setAccountFormOpen((open) => !open);
          }}>
            {accountFormOpen ? "Close form" : "Add Account"}
          </button>
        </div>
        {optionsError && (
          <p className="auth-error" role="alert">
            Could not load account details. {optionsError}{" "}
            <button className="text-link" type="button" onClick={refreshTradeOptions} disabled={optionsLoading}>Retry</button>
          </p>
        )}
        {accountError && <p className="auth-error" role="alert">{accountError}</p>}
        {accountSuccess && <p className="auth-status" role="status">{accountSuccess}</p>}
        {optionsLoading && !options.accounts.length
          ? <p className="hint" role="status">Loading trading accounts...</p>
          : options.accounts.length
            ? <div className="settings-account-list">
              {options.accounts.map((account) => (
                <section className="settings-account" key={account.id} aria-label={`${account.name} account`}>
                  <div className="settings-account-heading">
                    <h3>{account.name}</h3>
                    <span className="badge">{account.account_type === "demo"
                      ? "Demo"
                      : account.account_type === "real"
                        ? "Real"
                        : account.account_type === "prop_firm"
                          ? "Prop Firm"
                          : "Unclassified"}</span>
                  </div>
                  <dl className="settings-account-details">
                    <div><dt>Connection method</dt><dd>{account.connection_method === "mt5" ? "MT5" : account.connection_method === "manual" ? "Manual" : "Unknown"}</dd></div>
                    <div><dt>Account status</dt><dd>{account.connection_status === "manual" ? "Manually managed" : account.connection_status}</dd></div>
                    <div><dt>Broker / firm</dt><dd>{account.broker_name || "-"}</dd></div>
                    <div><dt>Platform</dt><dd>{account.platform}</dd></div>
                    <div><dt>Currency</dt><dd>{account.currency}</dd></div>
                    <div><dt>Starting balance</dt><dd>{money(account.starting_balance, { currency: account.currency })}</dd></div>
                    {account.account_type === "prop_firm" && account.challenge_phase && (
                      <div><dt>Challenge phase</dt><dd>{account.challenge_phase}</dd></div>
                    )}
                    {account.account_type === "prop_firm" && account.nominal_account_size && (
                      <div><dt>Nominal account size</dt><dd>{money(account.nominal_account_size, { currency: account.currency })}</dd></div>
                    )}
                    {account.connection_method === "mt5" && account.synchronization_status && (
                      <div><dt>Synchronization</dt><dd>{account.synchronization_status === "not_synced" ? "Not synchronized yet" : account.synchronization_status}</dd></div>
                    )}
                  </dl>
                </section>
              ))}
            </div>
            : <p className="hint">No accounts yet. Add a manual account here or connect one through MetaTrader 5.</p>}
        {accountFormOpen && (
          <form className="trade-editor account-registration-form" onSubmit={createManualAccount}>
            <div className="panel-head"><h3>Register a manual account</h3></div>
            {Object.values(accountValidationErrors).flat().length > 0 && (
              <ul className="auth-error" role="alert">
                {Object.values(accountValidationErrors).flat().map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
              </ul>
            )}
            <div className="trade-form-grid">
              <label>
                <span className="trade-field-label">Account name <span className="trade-field-indicator">Required</span></span>
                <input name="name" required maxLength="120" value={accountDraft.name} onChange={(event) => updateAccountDraft("name", event.target.value)} />
              </label>
              <label>
                <span className="trade-field-label">Account type <span className="trade-field-indicator">Optional</span></span>
                <select name="account_type" value={accountDraft.account_type} onChange={(event) => {
                  const accountType = event.target.value;
                  setAccountDraft((current) => ({
                    ...current,
                    account_type: accountType,
                    nominal_account_size: accountType === "prop_firm" ? current.nominal_account_size : "",
                    challenge_phase: accountType === "prop_firm" ? current.challenge_phase : ""
                  }));
                }}>
                  <option value="">Not specified</option>
                  <option value="demo">Demo</option>
                  <option value="real">Real</option>
                  <option value="prop_firm">Prop Firm</option>
                </select>
              </label>
              <label>
                <span className="trade-field-label">Broker or prop firm <span className="trade-field-indicator">Optional</span></span>
                <input name="broker_name" maxLength="120" value={accountDraft.broker_name} onChange={(event) => updateAccountDraft("broker_name", event.target.value)} />
              </label>
              <label>
                <span className="trade-field-label">Trading platform <span className="trade-field-indicator">Optional</span></span>
                <input name="platform" maxLength="80" value={accountDraft.platform} onChange={(event) => updateAccountDraft("platform", event.target.value)} />
              </label>
              <label>
                <span className="trade-field-label">Currency <span className="trade-field-indicator">Required</span></span>
                <input name="currency" required maxLength="3" minLength="3" pattern="[A-Z]{3}" value={accountDraft.currency} onChange={(event) => updateAccountDraft("currency", event.target.value.toUpperCase())} />
              </label>
              <label>
                <span className="trade-field-label">Starting balance <span className="trade-field-indicator">Required</span></span>
                <input name="starting_balance" required type="number" min="0" step="0.01" value={accountDraft.starting_balance} onChange={(event) => updateAccountDraft("starting_balance", event.target.value)} />
              </label>
              <label>
                <span className="trade-field-label">Account reference <span className="trade-field-indicator">Optional</span></span>
                <input name="account_reference" maxLength="120" autoComplete="off" value={accountDraft.account_reference} onChange={(event) => updateAccountDraft("account_reference", event.target.value)} />
              </label>
              {accountDraft.account_type === "prop_firm" && <>
                <label>
                  <span className="trade-field-label">Nominal account size <span className="trade-field-indicator">Optional</span></span>
                  <input name="nominal_account_size" type="number" min="0.01" step="0.01" value={accountDraft.nominal_account_size} onChange={(event) => updateAccountDraft("nominal_account_size", event.target.value)} />
                </label>
                <label>
                  <span className="trade-field-label">Challenge phase <span className="trade-field-indicator">Optional</span></span>
                  <select name="challenge_phase" value={accountDraft.challenge_phase} onChange={(event) => updateAccountDraft("challenge_phase", event.target.value)}>
                    <option value="">Select a phase</option>
                    <option value="Evaluation Phase 1">Evaluation Phase 1</option>
                    <option value="Evaluation Phase 2">Evaluation Phase 2</option>
                    <option value="Funded">Funded</option>
                    <option value="Instant Funding">Instant Funding</option>
                  </select>
                </label>
              </>}
              <p className="hint">Connection method: Manual. No platform credentials are requested or stored.</p>
            </div>
            <button className="btn btn-primary" type="submit" disabled={accountSaving}>
              {accountSaving ? "Adding account..." : "Create account"}
            </button>
          </form>
        )}
        <dl className="settings"><div><dt>Storage</dt><dd>JEXOVA database</dd></div></dl>
      </article>
      <article className="card">
        <div className="panel-head"><h2>Appearance</h2></div>
        <dl className="settings">
          <div><dt>Theme</dt><dd>Dark</dd></div>
          <div><dt>Numbers</dt><dd>Instrument-aware prices and sizes; P&amp;L in account currency</dd></div>
        </dl>
      </article>
      <article className="card mt5-card">
        <div className="mt5-heading">
          <p className="panel-kicker">MT5 Account Integration  |  Read-only</p>
          <h2>MetaTrader 5</h2>
          <p>Connect an already authenticated local terminal. JEXOVA never requests your MT5 password and cannot place, modify, or close orders.</p>
        </div>
        {connectionsError && <p className="auth-error" role="alert">{connectionsError}</p>}
        {notice && <p className="auth-status" role="status">{notice}</p>}
        <div className="mt5-connector-status">
          <span className={`status-dot ${localConnectorReady ? "status-dot--connected" : ""}`} aria-hidden="true" />
          <span>Local connector: {localConnectorLoading ? "Checking..." : localConnectorReady ? "Available" : "Not detected"}</span>
          <button className="text-link" type="button" onClick={checkLocalConnector} disabled={localConnectorLoading}>
            Check connector
          </button>
        </div>
        {!localConnectorReady && !localConnectorLoading && (
          <div className="mt5-install">
            <h3>Install the Windows connector</h3>
            <p>A local connector is required; a website cannot access your desktop MT5 terminal directly. Install it once from the JEXOVA <code>connector\mt5</code> folder:</p>
            <pre><code>powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-edgeledger-mt5-connector.ps1</code></pre>
            <p className="hint">The installer registers a per-user Windows startup task. Open MT5 and sign in yourself before connecting. For a remote HTTPS site, pass its URL with <code>-EdgeLedgerUrl</code> and allow the browser's local-network access prompt if shown.</p>
          </div>
        )}
        {connectionsLoading
          ? <p className="hint" role="status">Loading MT5 connections...</p>
          : connections.length === 0
            ? <p className="hint">No trading accounts connected.</p>
            : <div className="mt5-connection-list">
              {connections.map((connection) => (
                <section className="mt5-connection" key={connection.id} aria-label={`${connection.account_name} connection`}>
                  <div className="mt5-connection-heading">
                    <div>
                      <h3>{connection.account_name}</h3>
                      <p className="muted">{connection.server ?? "Broker not verified"}{connection.login_masked ? `  |  Account ${connection.login_masked}` : ""}</p>
                    </div>
                    <span className={`badge badge-${connection.status === "connected" ? "closed" : connection.status === "error" ? "open" : "pending"}`}>
                      {connection.status === "connected"
                        ? "Connected"
                        : connection.status === "pending_confirmation"
                          ? "Confirm account"
                        : connection.status === "disconnected"
                          ? "Disconnected"
                        : connection.status === "revoked"
                          ? "Disconnected"
                        : connection.status === "error"
                          ? "Needs attention"
                          : connection.status === "paired" ? "Checking terminal" : "Pairing pending"}
                    </span>
                  </div>
                  {connection.currency && <>
                    <h4 className="mt5-section-title">Trading Account Details</h4>
                    <dl className="mt5-account-details">
                    <div><dt>Account type</dt><dd>{connection.account_type === "demo" ? "Demo" : connection.account_type === "live" ? "Live" : "Not verified"}</dd></div>
                    <div><dt>Currency</dt><dd>{connection.currency}</dd></div>
                    <div><dt>Equity</dt><dd>{connection.equity == null ? "-" : money(connection.equity, { currency: connection.currency })}</dd></div>
                    <div><dt>Leverage</dt><dd>1:{connection.leverage}</dd></div>
                    <div><dt>Account Status</dt><dd>{connection.status === "connected" ? "Connected" : connection.status === "pending_confirmation" ? "Awaiting confirmation" : connection.status}</dd></div>
                    <div><dt>Last successful synchronization</dt><dd>{connection.last_sync_at ? new Date(connection.last_sync_at).toLocaleString() : "Never"}</dd></div>
                    </dl>
                  </>}
                  {connection.last_error_code && (
                    <p className="auth-error" role="alert">{mt5ErrorMessage(connection.last_error_code)}</p>
                  )}
                  <p className="hint" role="status">
                    Synchronization Status: {connection.latest_sync
                      ? connection.latest_sync.status
                      : connection.last_sync_at ? "Synchronized" : "Not synchronized yet"}
                  </p>
                  {connection.latest_sync && (
                    <p className="hint" role="status">
                      Synchronization Status: {connection.latest_sync.status}; {connection.latest_sync.orders_count} orders, {connection.latest_sync.deals_count} deals, {connection.latest_sync.positions_count} open positions.
                    </p>
                  )}
                  <div className="mt5-actions">
                    {connection.status === "pending_confirmation" && (
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => confirmAccount(connection)}
                        disabled={confirmingId === connection.id}
                      >
                        {confirmingId === connection.id ? "Confirming..." : "Confirm Trading Account"}
                      </button>
                    )}
                    <button
                      className="btn"
                      type="button"
                      onClick={() => requestSync(connection.id)}
                      disabled={connection.status !== "connected" || syncingId === connection.id}
                    >
                      {syncingId === connection.id ? "Queueing..." : "Synchronize Now"}
                    </button>
                    {connection.status !== "revoked" ? (
                      <button
                        className="btn danger-link"
                        type="button"
                        onClick={() => disconnectAccount(connection)}
                        disabled={disconnectingId === connection.id}
                      >
                        {disconnectingId === connection.id ? "Disconnecting..." : "Disconnect Account"}
                      </button>
                    ) : localConnectorReady && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => removeLocalAccess(connection.id)}
                        disabled={disconnectingId === connection.id}
                      >
                        {disconnectingId === connection.id ? "Removing..." : "Remove local connector access"}
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>}
        <form className="mt5-pairing-form" onSubmit={createPairing}>
          <label htmlFor="mt5-account-name">Trading account name</label>
          <input
            id="mt5-account-name"
            name="account_name"
            maxLength="120"
            required
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={pairingLoading || !localConnectorReady}>
            {pairingLoading ? "Connecting..." : "Connect Trading Account"}
          </button>
        </form>
        <button className="text-link" type="button" onClick={refreshConnections} disabled={connectionsLoading}>
          Refresh connection status
        </button>
      </article>
    </div>
  );
}

function mt5ErrorMessage(code) {
  const messages = {
    account_mismatch: "The active terminal account does not match the connected trading account.",
    connector_error: "The local connector could not reach JEXOVA. Check that the development server is running.",
    credential_store_unavailable: "Windows Credential Manager could not access the connector token.",
    history_unavailable: "MetaTrader 5 could not provide the requested history.",
    invalid_mt5_data: "The terminal returned data that did not pass validation.",
    mt5_package_missing: "Install the connector requirements before pairing the terminal.",
    pairing_code_expired: "The one-time pairing code expired or was already used. Try connecting again.",
    terminal_disconnected: "Open MetaTrader 5 and sign in to the account you want to connect.",
    terminal_unavailable: "The configured MetaTrader 5 terminal is not running.",
    unsupported_account_type: "Only MT5 demo and live accounts are supported.",
    unsupported_platform: "The MT5 connector requires 64-bit Windows."
  };
  return messages[code] ?? "The MT5 connection needs attention.";
}

function passwordStrength(password) {
  if (!password) return { score: 0, label: "Not entered", level: "empty" };

  const score = [
    password.length >= 8,
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;
  const label = score <= 1 ? "Weak" : score <= 2 ? "Fair" : score <= 3 ? "Good" : "Strong";

  return { score, label, level: label.toLowerCase() };
}

function parseRegistrationData(value) {
  return value ? JSON.parse(value) : {};
}

function findRegistrationCountry(value) {
  const search = String(value ?? "").trim().toLocaleLowerCase();
  if (!search) return undefined;
  return registrationCountries.find((country) =>
    country.code.toLocaleLowerCase() === search || country.name.toLocaleLowerCase() === search
  );
}

function CountryFlag({ code, countryName }) {
  const Flag = code ? countryFlags[code] : undefined;
  return Flag
    ? <span className="auth-country-flag" aria-hidden="true"><Flag title={countryName} /></span>
    : <span className="auth-country-flag auth-country-flag--globe" aria-hidden="true">{"\u{1F310}"}</span>;
}

function CountryPicker({
  id,
  countryCode,
  onChange,
  compact = false,
  invalid = false,
  describedBy
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef(null);
  const searchRef = useRef(null);
  const selectedCountry = registrationCountryByCode[countryCode];
  const filteredCountries = registrationCountries.filter((country) => {
    const searchText = `${country.name} ${country.code} +${country.callingCode}`.toLocaleLowerCase();
    return searchText.includes(query.trim().toLocaleLowerCase());
  });
  const listId = `${id}-options`;
  const searchId = `${id}-search`;

  useEffect(() => {
    if (!isOpen) return undefined;
    searchRef.current?.focus();
    function closeOnOutsideClick(event) {
      if (!pickerRef.current?.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isOpen]);

  function chooseCountry(country) {
    onChange(country.code);
    setQuery("");
    setIsOpen(false);
  }

  function handleSearchKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    } else if (event.key === "Enter" && filteredCountries.length) {
      event.preventDefault();
      chooseCountry(filteredCountries[0]);
    }
  }

  return (
    <div
      className={`auth-country-picker${compact ? " auth-country-picker--compact" : ""}`}
      ref={pickerRef}
    >
      <button
        id={id}
        className="auth-country-trigger"
        type="button"
        aria-label={compact
          ? `Phone country: ${selectedCountry?.name ?? "not selected"}`
          : `Country: ${selectedCountry?.name ?? "select a country"}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-required={!compact}
        onClick={() => {
          setQuery("");
          setIsOpen((open) => !open);
        }}
      >
        <CountryFlag code={countryCode} countryName={selectedCountry?.name ?? "Select country"} />
        <span className="auth-country-trigger-value">
          {compact
            ? selectedCountry ? `+${selectedCountry.callingCode}` : "Code"
            : selectedCountry?.name ?? "Select a country"}
        </span>
        <span className="auth-country-chevron" aria-hidden="true">v</span>
      </button>
      {isOpen && (
        <div className="auth-country-menu">
          <label className="auth-country-search-label" htmlFor={searchId}>Search countries</label>
          <input
            id={searchId}
            ref={searchRef}
            className="auth-country-search"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <ul className="auth-country-options" id={listId} role="listbox" aria-label="Countries">
            {filteredCountries.length ? filteredCountries.map((country) => (
              <li key={country.code} role="presentation">
                <button
                  type="button"
                  className="auth-country-option"
                  role="option"
                  aria-selected={country.code === countryCode}
                  onClick={() => chooseCountry(country)}
                >
                  <CountryFlag code={country.code} countryName={country.name} />
                  <span className="auth-country-option-name">{country.name}</span>
                  <span className="auth-country-option-code">+{country.callingCode}</span>
                </button>
              </li>
            )) : (
              <li className="auth-country-empty" role="presentation">No countries found.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function RegistrationScreen() {
  const root = document.getElementById("root");
  const oldValues = parseRegistrationData(root?.dataset.oldRegistration);
  const [initialRegistration] = useState(() => {
    const previousCountry = findRegistrationCountry(oldValues.country);
    const previousPhone = parsePhoneNumberFromString(
      oldValues.phone_number ?? "",
      previousCountry?.code
    );
    const countryCode = previousCountry?.code ?? previousPhone?.country;
    return {
      countryCode,
      country: countryCode ? registrationCountryByCode[countryCode].name : "",
      phone_number: previousPhone?.number ?? ""
    };
  });
  const [selectedCountryCode, setSelectedCountryCode] = useState(initialRegistration.countryCode);
  const [fields, setFields] = useState(() => ({
    first_name: oldValues.first_name ?? "",
    last_name: oldValues.last_name ?? "",
    username: oldValues.username ?? "",
    email: oldValues.email ?? "",
    password: "",
    password_confirmation: "",
    country: initialRegistration.country,
    phone_number: initialRegistration.phone_number,
    terms_accepted: false,
    privacy_accepted: false
  }));
  const [errors, setErrors] = useState(() => Object.fromEntries(
    Object.entries(parseRegistrationData(root?.dataset.registrationErrors))
      .map(([name, messages]) => [name, Array.isArray(messages) ? messages[0] : messages])
  ));
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const strength = passwordStrength(fields.password);

  useEffect(() => {
    document.title = "Create account  |  JEXOVA";
  }, []);

  function updateField(event) {
    const { name, type, checked, value } = event.target;
    setFields((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[name];
      if (name === "password" || name === "password_confirmation") {
        delete next.password;
        delete next.password_confirmation;
      }
      return next;
    });
  }

  function updateCountry(code) {
    const country = registrationCountryByCode[code];
    if (!country) return;
    const countryChanged = selectedCountryCode !== code;
    setSelectedCountryCode(code);
    setFields((current) => ({
      ...current,
      country: country.name,
      phone_number: countryChanged ? "" : current.phone_number
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next.country;
      if (countryChanged) delete next.phone_number;
      return next;
    });
  }

  function updatePhoneNumber(value) {
    const phoneNumber = value ?? "";
    const parsedPhone = phoneNumber ? parsePhoneNumberFromString(phoneNumber) : undefined;
    const phoneCountry = parsedPhone?.country
      ? registrationCountryByCode[parsedPhone.country]
      : undefined;
    if (phoneCountry) setSelectedCountryCode(phoneCountry.code);
    setFields((current) => ({
      ...current,
      phone_number: phoneNumber,
      ...(phoneCountry ? { country: phoneCountry.name } : {})
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next.phone_number;
      if (phoneCountry) delete next.country;
      return next;
    });
  }

  function handleSubmit(event) {
    const emailInput = event.currentTarget.elements.namedItem("email");
    const nextErrors = validateRegistrationIdentity(fields, emailInput?.validity.typeMismatch);
    if (!fields.first_name.trim()) nextErrors.first_name = "Enter your first name.";
    if (!fields.last_name.trim()) nextErrors.last_name = "Enter your last name.";
    if (fields.password.length < 8) nextErrors.password = "Use at least 8 characters.";
    if (!fields.password_confirmation) nextErrors.password_confirmation = "Confirm your password.";
    else if (fields.password !== fields.password_confirmation) {
      nextErrors.password_confirmation = "Passwords do not match.";
    }
    if (!selectedCountryCode) nextErrors.country = "Select your country.";
    if (fields.phone_number && !isValidPhoneNumber(fields.phone_number)) {
      nextErrors.phone_number = "Enter a valid phone number.";
    }
    if (!fields.terms_accepted) nextErrors.terms_accepted = "You must accept the Terms & Conditions.";
    if (!fields.privacy_accepted) nextErrors.privacy_accepted = "You must accept the Privacy Policy.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      event.preventDefault();
      return;
    }
  }

  function fieldError(name, id) {
    return errors[name] ? <span className="auth-field-error" id={id}>{errors[name]}</span> : null;
  }

  return (
    <main className="auth-page">
      <section className="auth-card auth-card--register" aria-labelledby="register-title">
        <a className="brand auth-brand" href="/" aria-label="JEXOVA home">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 16l5-6 4 3 7-8" /><path d="M4 20h16" /></svg>
          </span>
          <span>
            <span className="brand-name">JEXOVA</span>
            <span className="brand-tag">Personal journal</span>
          </span>
        </a>
        <div>
          <p className="panel-kicker">Start with a clear view</p>
          <h1 id="register-title">Create your account</h1>
          <p className="auth-copy">Set up your JEXOVA profile to begin journaling with intention.</p>
        </div>
        <form className="auth-form auth-form--register" method="post" action="/register" onSubmit={handleSubmit} noValidate>
          <input
            type="hidden"
            name="_token"
            value={document.querySelector('meta[name="csrf-token"]')?.content ?? ""}
          />
          {Object.keys(errors).length > 0 && (
            <p className="auth-error" role="alert">
              {errors.registration ?? "Please review the highlighted fields."}
            </p>
          )}
          <div className="auth-register-grid">
            <div className="auth-field">
              <label htmlFor="register-first-name">First name</label>
              <input
                id="register-first-name"
                name="first_name"
                type="text"
                autoComplete="given-name"
                maxLength="120"
                value={fields.first_name}
                onChange={updateField}
                aria-invalid={Boolean(errors.first_name)}
                aria-describedby={errors.first_name ? "register-first-name-error" : undefined}
                required
              />
              {fieldError("first_name", "register-first-name-error")}
            </div>
            <div className="auth-field">
              <label htmlFor="register-last-name">Last name</label>
              <input
                id="register-last-name"
                name="last_name"
                type="text"
                autoComplete="family-name"
                maxLength="120"
                value={fields.last_name}
                onChange={updateField}
                aria-invalid={Boolean(errors.last_name)}
                aria-describedby={errors.last_name ? "register-last-name-error" : undefined}
                required
              />
              {fieldError("last_name", "register-last-name-error")}
            </div>
            <div className="auth-field">
              <label htmlFor="register-username">Username</label>
              <input
                id="register-username"
                name="username"
                type="text"
                autoComplete="username"
                maxLength="60"
                value={fields.username}
                onChange={updateField}
                aria-invalid={Boolean(errors.username)}
                aria-describedby={errors.username ? "register-username-error" : undefined}
                required
              />
              {fieldError("username", "register-username-error")}
            </div>
            <div className="auth-field">
              <label htmlFor="register-email">Email address</label>
              <input
                id="register-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength="255"
                value={fields.email}
                onChange={updateField}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "register-email-error" : undefined}
                required
              />
              {fieldError("email", "register-email-error")}
            </div>
            <div className="auth-field">
              <label htmlFor="register-password">Password</label>
              <div className="auth-password-field">
                <input
                  id="register-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength="8"
                  value={fields.password}
                  onChange={updateField}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={`register-password-strength${errors.password ? " register-password-error" : ""}`}
                  required
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <div
                className={`auth-password-strength strength-${strength.level}`}
                id="register-password-strength"
                aria-live="polite"
              >
                <div
                  className="auth-strength-track"
                  role="progressbar"
                  aria-label="Password strength"
                  aria-valuemin="0"
                  aria-valuemax="5"
                  aria-valuenow={strength.score}
                >
                  <span style={{ width: `${(strength.score / 5) * 100}%` }} />
                </div>
                <span>Password strength: {strength.label}</span>
              </div>
              {fieldError("password", "register-password-error")}
            </div>
            <div className="auth-field">
              <label htmlFor="register-confirm-password">Confirm password</label>
              <div className="auth-password-field">
                <input
                  id="register-confirm-password"
                  name="password_confirmation"
                  type={showConfirmation ? "text" : "password"}
                  autoComplete="new-password"
                  minLength="8"
                  value={fields.password_confirmation}
                  onChange={updateField}
                  aria-invalid={Boolean(errors.password_confirmation)}
                  aria-describedby={errors.password_confirmation ? "register-confirm-password-error" : undefined}
                  required
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={showConfirmation ? "Hide confirmation" : "Show confirmation"}
                  aria-pressed={showConfirmation}
                  onClick={() => setShowConfirmation((visible) => !visible)}
                >
                  {showConfirmation ? "Hide" : "Show"}
                </button>
              </div>
              {fieldError("password_confirmation", "register-confirm-password-error")}
            </div>
            <div className="auth-field">
              <label htmlFor="register-country">Country</label>
              <CountryPicker
                id="register-country"
                countryCode={selectedCountryCode}
                onChange={updateCountry}
                invalid={Boolean(errors.country)}
                describedBy={errors.country ? "register-country-error" : undefined}
              />
              <input type="hidden" name="country" value={fields.country} />
              {fieldError("country", "register-country-error")}
            </div>
            <div className="auth-field">
              <label htmlFor="register-phone">Phone number <span className="auth-optional">(optional)</span></label>
              <div className="auth-phone-control">
                <CountryPicker
                  id="register-phone-country"
                  countryCode={selectedCountryCode}
                  onChange={updateCountry}
                  compact
                  invalid={Boolean(errors.phone_number)}
                  describedBy={errors.phone_number ? "register-phone-error" : undefined}
                />
                <PhoneInput
                  id="register-phone"
                  className="auth-phone-input"
                  autoComplete="tel"
                  placeholder="Enter phone number"
                  country={selectedCountryCode}
                  international={selectedCountryCode ? true : undefined}
                  value={fields.phone_number || undefined}
                  onChange={updatePhoneNumber}
                  disabled={!selectedCountryCode}
                  aria-invalid={Boolean(errors.phone_number)}
                  aria-describedby={errors.phone_number ? "register-phone-error" : undefined}
                />
              </div>
              <input type="hidden" name="phone_number" value={fields.phone_number} />
              {fieldError("phone_number", "register-phone-error")}
            </div>
          </div>
          <div className="auth-legal">
            <div className="auth-checkbox-field">
              <label htmlFor="register-terms">
                <input
                  id="register-terms"
                  name="terms_accepted"
                  type="checkbox"
                  checked={fields.terms_accepted}
                  onChange={updateField}
                  aria-invalid={Boolean(errors.terms_accepted)}
                  aria-describedby={errors.terms_accepted ? "register-terms-error" : undefined}
                  required
                />
                <span>I accept the Terms &amp; Conditions.</span>
              </label>
              {fieldError("terms_accepted", "register-terms-error")}
            </div>
            <div className="auth-checkbox-field">
              <label htmlFor="register-privacy">
                <input
                  id="register-privacy"
                  name="privacy_accepted"
                  type="checkbox"
                  checked={fields.privacy_accepted}
                  onChange={updateField}
                  aria-invalid={Boolean(errors.privacy_accepted)}
                  aria-describedby={errors.privacy_accepted ? "register-privacy-error" : undefined}
                  required
                />
                <span>I accept the Privacy Policy.</span>
              </label>
              {fieldError("privacy_accepted", "register-privacy-error")}
            </div>
          </div>
          <button className="btn btn-primary auth-submit" type="submit">Create account</button>
        </form>
        <p className="auth-switch"><a className="text-link" href="/login">Back to Sign In</a></p>
      </section>
    </main>
  );
}

function EmailVerificationNotice() {
  const root = document.getElementById("root");
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
  const status = root?.dataset.verificationStatus;
  const error = root?.dataset.verificationError;
  const validationErrors = parseRegistrationData(root?.dataset.registrationErrors);
  const oldValues = parseRegistrationData(root?.dataset.oldRegistration);
  const emailError = Array.isArray(validationErrors.email)
    ? validationErrors.email[0]
    : validationErrors.email;

  useEffect(() => {
    document.title = "Verify your email  |  JEXOVA";
  }, []);

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="verification-title">
        <a className="brand auth-brand" href="/" aria-label="JEXOVA home">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 16l5-6 4 3 7-8" /><path d="M4 20h16" /></svg>
          </span>
          <span>
            <span className="brand-name">JEXOVA</span>
            <span className="brand-tag">Personal journal</span>
          </span>
        </a>
        <div>
          <p className="panel-kicker">One more step</p>
          <h1 id="verification-title">Verify your email</h1>
          <p className="auth-copy">
            Follow the secure verification link sent to your email address before opening your journal.
          </p>
        </div>
        {status && <p className="auth-status" role="status">{status}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="auth-form" method="post" action="/email/verification-notification">
          <input type="hidden" name="_token" value={csrfToken} />
          <button className="btn btn-primary auth-submit" type="submit">Resend verification email</button>
        </form>
        <form className="auth-form" method="post" action="/email/update">
          <input type="hidden" name="_token" value={csrfToken} />
          <div className="auth-field">
            <label htmlFor="verification-email">Correct your email address</label>
            <input
              id="verification-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength="255"
              defaultValue={oldValues.email ?? ""}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "verification-email-error" : undefined}
              required
            />
            {emailError && (
              <span className="auth-field-error" id="verification-email-error">{emailError}</span>
            )}
          </div>
          <button className="btn btn-primary auth-submit" type="submit">Update email and resend verification</button>
        </form>
        <form className="logout-form" method="post" action="/logout">
          <input type="hidden" name="_token" value={csrfToken} />
          <button className="text-link" type="submit">Sign out</button>
        </form>
      </section>
    </main>
  );
}

function LoginScreen() {
  const root = document.getElementById("root");
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
  const error = root?.dataset.authError;
  const status = root?.dataset.passwordResetStatus;

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <a className="brand auth-brand" href="/" aria-label="JEXOVA home">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 16l5-6 4 3 7-8" /><path d="M4 20h16" /></svg>
          </span>
          <span>
            <span className="brand-name">JEXOVA</span>
            <span className="brand-tag">Personal journal</span>
          </span>
        </a>
        <div>
          <p className="panel-kicker">Welcome back</p>
          <h1 id="login-title">Sign in to your journal</h1>
          <p className="auth-copy">Use your email and password to continue.</p>
        </div>
        {status && <p className="auth-status" role="status">{status}</p>}
        <form className="auth-form" method="post" action="/login">
          <input type="hidden" name="_token" value={csrfToken} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            maxLength="255"
            defaultValue={root?.dataset.oldEmail ?? ""}
            required
          />
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <button className="btn auth-submit" type="submit">Sign in</button>
          <a className="text-link" href="/forgot-password">Forgot your password?</a>
        </form>
        <p className="auth-switch">
          Don't have an account? <a className="text-link" href="/register">Create Account</a>
        </p>
      </section>
    </main>
  );
}

function ForgotPasswordScreen() {
  const root = document.getElementById("root");
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
  const status = root?.dataset.passwordResetStatus;
  const error = root?.dataset.passwordResetError;

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="forgot-password-title">
        <a className="brand auth-brand" href="/login" aria-label="JEXOVA sign in">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 16l5-6 4 3 7-8" /><path d="M4 20h16" /></svg>
          </span>
          <span>
            <span className="brand-name">JEXOVA</span>
            <span className="brand-tag">Personal journal</span>
          </span>
        </a>
        <div>
          <p className="panel-kicker">Account recovery</p>
          <h1 id="forgot-password-title">Forgot your password?</h1>
          <p className="auth-copy">Enter your email and we'll send a reset link if an account exists.</p>
        </div>
        {status && <p className="auth-status" role="status">{status}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="auth-form" method="post" action="/forgot-password">
          <input type="hidden" name="_token" value={csrfToken} />
          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength="255"
            defaultValue={root?.dataset.resetEmail ?? ""}
            required
          />
          <button className="btn auth-submit" type="submit">Send reset link</button>
          <a className="text-link" href="/login">Back to sign in</a>
        </form>
      </section>
    </main>
  );
}

function ResetPasswordScreen() {
  const root = document.getElementById("root");
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
  const token = root?.dataset.resetToken ?? "";
  const queryEmail = new URLSearchParams(window.location.search).get("email") ?? "";
  const email = root?.dataset.resetEmail || queryEmail;
  const error = root?.dataset.passwordResetError;

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="reset-password-title">
        <a className="brand auth-brand" href="/login" aria-label="JEXOVA sign in">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 16l5-6 4 3 7-8" /><path d="M4 20h16" /></svg>
          </span>
          <span>
            <span className="brand-name">JEXOVA</span>
            <span className="brand-tag">Personal journal</span>
          </span>
        </a>
        <div>
          <p className="panel-kicker">Account recovery</p>
          <h1 id="reset-password-title">Choose a new password</h1>
          <p className="auth-copy">Use at least 8 characters and confirm your new password.</p>
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="auth-form" method="post" action="/reset-password">
          <input type="hidden" name="_token" value={csrfToken} />
          <input type="hidden" name="token" value={token} />
          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            name="email"
            type="email"
            autoComplete="username"
            maxLength="255"
            defaultValue={email}
            required
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength="8"
            required
          />
          <label htmlFor="new-password-confirmation">Confirm new password</label>
          <input
            id="new-password-confirmation"
            name="password_confirmation"
            type="password"
            autoComplete="new-password"
            minLength="8"
            required
          />
          <button className="btn auth-submit" type="submit">Reset password</button>
          <a className="text-link" href="/login">Back to sign in</a>
        </form>
      </section>
    </main>
  );
}

function JournalApp() {
  const [page, setPage] = useState(pageFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const titleRef = useRef(null);
  const [title, subtitle] = pages[page];

  useEffect(() => {
    function handleHashChange() {
      const nextPage = pageFromHash();
      if (!pages[window.location.hash.slice(1)]) {
        window.history.replaceState(null, "", "#dashboard");
      }
      setPage(nextPage);
      setMenuOpen(false);
      window.scrollTo(0, 0);
      window.requestAnimationFrame(() => titleRef.current?.focus());
    }

    window.addEventListener("hashchange", handleHashChange);
    if (!pages[window.location.hash.slice(1)]) {
      window.history.replaceState(null, "", "#dashboard");
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    document.title = `${title}  |  JEXOVA`;
  }, [title]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  const content = {
    dashboard: <Dashboard />,
    journal: <Journal />,
    calendar: <Calendar />,
    analytics: <Analytics />,
    strategies: <Strategies />,
    settings: <Settings />
  }[page];

  return (
    <div className="shell">
      <aside className={`sidebar${menuOpen ? " is-open" : ""}`} id="sidebar">
        <a className="brand" href="#dashboard" onClick={() => setMenuOpen(false)}>
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 16l5-6 4 3 7-8" /><path d="M4 20h16" /></svg>
          </span>
          <span>
            <span className="brand-name">JEXOVA</span>
            <span className="brand-tag">Personal journal</span>
          </span>
        </a>
        <nav className="nav" aria-label="Primary">
          <p className="nav-label">Menu</p>
          {navigation.map((item) => (
            <a
              className="nav-link"
              href={`#${item.name}`}
              data-page={item.name}
              aria-current={page === item.name ? "page" : undefined}
              key={item.name}
              onClick={() => setMenuOpen(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">{item.icon}</svg>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
            <strong>Your journal</strong>
            <span>Database-backed  |  MT5 read-only</span>
        </div>
      </aside>
      <button
        className={`backdrop${menuOpen ? " is-visible" : ""}`}
        id="backdrop"
        type="button"
        aria-label="Close navigation"
        onClick={() => setMenuOpen(false)}
      />
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn"
              id="menu-toggle"
              type="button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="sidebar"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <div>
              <h1 id="page-title" tabIndex="-1" ref={titleRef}>{title}</h1>
              <p id="page-subtitle">{subtitle}</p>
            </div>
          </div>
          <div className="topbar-right">
            <div
              className="sync-pill"
              title="Journal, dashboard, analytics, and strategy data are loaded from your JEXOVA database."
            >
              <span className="dot" aria-hidden="true" />
              Database-backed
            </div>
            <form className="logout-form" method="post" action="/logout">
              <input
                type="hidden"
                name="_token"
                value={document.querySelector('meta[name="csrf-token"]')?.content ?? ""}
              />
              <button className="btn logout-button" type="submit">Log out</button>
            </form>
          </div>
        </header>
        <main className="content" id="view">{content}</main>
      </div>
    </div>
  );
}

function App() {
  const authenticated = document.getElementById("root")?.dataset.authenticated === "true";
  const path = window.location.pathname.replace(/\/+$/, "") || "/";

  if (path === "/email/verify") return <EmailVerificationNotice />;
  if (path === "/forgot-password") return <ForgotPasswordScreen />;
  if (path.startsWith("/reset-password/")) return <ResetPasswordScreen />;
  if (authenticated) return <JournalApp />;
  return path === "/register" ? <RegistrationScreen /> : <LoginScreen />;
}

export default App;
