/*
  Screen controller.

  Flow:
  1. Ask EdgeLedgerApi for the snapshot (sample data today, Laravel later).
  2. Draw the screen that matches the URL hash (#dashboard, #journal, ...).
  3. Listen for navigation, search, and the calendar inside the page.

  Adding a backend should not require rewriting these screens if the JSON
  keeps the same field names.
*/
(function () {
  const format = window.EdgeLedgerFormat;
  const snapshot = window.EdgeLedgerApi.getSnapshot();
  const view = document.querySelector("#view");
  const title = document.querySelector("#page-title");
  const subtitle = document.querySelector("#page-subtitle");
  const equityValue = document.querySelector("#equity-value");
  const sidebar = document.querySelector("#sidebar");
  const menuButton = document.querySelector("#menu-toggle");
  const backdrop = document.querySelector("#backdrop");

  const pages = {
    dashboard: ["Dashboard", "Performance overview"],
    journal: ["Trade Journal", "Closed and open trades"],
    calendar: ["Calendar", "Daily result by session date"],
    analytics: ["Analytics", "Where the results came from"],
    strategies: ["Strategies", "Sample playbooks in this journal"],
    settings: ["Settings", "Account, display, and future connections"]
  };

  const state = {
    page: "dashboard",
    month: latestClosedMonth(),
    selectedDate: null
  };

  let unmountChart = function () {};

  equityValue.textContent = format.money(snapshot.account.equity);

  function esc(value) {
    return format.escapeHtml(value == null ? "" : value);
  }

  function pageFromHash() {
    const name = location.hash.replace("#", "");
    return pages[name] ? name : "dashboard";
  }

  function closeMenu() {
    sidebar.classList.remove("is-open");
    backdrop.classList.remove("is-visible");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
  }

  function openMenu() {
    sidebar.classList.add("is-open");
    backdrop.classList.add("is-visible");
    menuButton.setAttribute("aria-expanded", "true");
    menuButton.setAttribute("aria-label", "Close navigation");
  }

  function render(resetScroll) {
    unmountChart();
    state.page = pageFromHash();
    const heading = pages[state.page];
    title.textContent = heading[0];
    subtitle.textContent = heading[1];
    document.title = heading[0] + " · EdgeLedger";

    document.querySelectorAll(".nav-link").forEach(function (link) {
      if (link.dataset.page === state.page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    view.innerHTML = screens[state.page]();
    if (state.page === "dashboard") {
      unmountChart = window.EdgeLedgerChart.mount(
        document.querySelector("#equity-chart"),
        snapshot.equity
      );
    }
    if (state.page === "journal") paintJournal();
    if (resetScroll) {
      window.scrollTo(0, 0);
      title.focus();
    }
  }

  function tradeRow(row) {
    const when = row.closedAt || row.openedAt;
    const rValue = row.rMultiple == null ? "—" : (row.rMultiple > 0 ? "+" : "") + row.rMultiple.toFixed(1) + "R";
    return (
      "<tr>" +
        "<td><span class=\"symbol\">" + esc(row.symbol) + "</span><div class=\"muted\">" + esc(row.id) + "</div></td>" +
        "<td>" + esc(format.formatDate(when, false)) + "<div class=\"muted\">" + esc(format.formatTime(when)) + "</div></td>" +
        "<td><span class=\"badge badge-" + esc(row.side) + "\">" + esc(row.side) + "</span></td>" +
        "<td>" + esc(row.strategy) + "<div class=\"muted\">" + esc(row.session) + "</div></td>" +
        "<td class=\"num\">" + esc(format.formatPrice(row.symbol, row.entry)) + "</td>" +
        "<td class=\"num\">" + esc(format.formatPrice(row.symbol, row.exit)) + "</td>" +
        "<td class=\"num\">" + esc(rValue) + "</td>" +
        "<td class=\"num " + format.pnlClass(row.pnl) + "\">" + esc(format.money(row.pnl, { sign: true })) + "</td>" +
        "<td><span class=\"badge badge-" + esc(row.status) + "\">" + esc(row.status) + "</span></td>" +
      "</tr>"
    );
  }

  function table(rows) {
    const body = rows.length
      ? rows.map(tradeRow).join("")
      : "<tr><td class=\"empty\" colspan=\"9\">No trades match this view.</td></tr>";
    return (
      "<div class=\"table-scroll\"><table>" +
        "<thead><tr>" +
          "<th>Symbol</th><th>When</th><th>Side</th><th>Strategy</th>" +
          "<th class=\"num\">Entry</th><th class=\"num\">Exit</th><th class=\"num\">R</th>" +
          "<th class=\"num\">P&L</th><th>Status</th>" +
        "</tr></thead><tbody>" + body + "</tbody></table></div>"
    );
  }

  const screens = {
    dashboard: function () {
      const summary = snapshot.summary;
      const account = snapshot.account;
      const best = summary.best;
      const worst = summary.worst;
      return (
        "<p class=\"intro\">Showing the sample journal shipped with this prototype. " +
          summary.closedCount + " closed trades, from " +
          esc(format.formatDate(equityStart(snapshot.equity))) + " to " +
          esc(format.formatDate(equityEnd(snapshot.equity))) + ".</p>" +
        "<section class=\"stat-grid\">" +
          stat("Net P&L", format.money(summary.netPnl, { sign: true }), format.pnlClass(summary.netPnl),
            format.percent(summary.returnFraction) + " from the " + format.money(account.startingBalance) + " start") +
          stat("Win rate", format.percent(summary.winRate), "",
            summary.wins + " wins · " + summary.losses + " losses") +
          stat("Profit factor", summary.profitFactor == null ? "—" : summary.profitFactor.toFixed(2), "", "Gross profit divided by gross loss") +
          stat("Max drawdown", "−" + format.percent(summary.maxDrawdownFraction), "pnl-neg",
            format.money(summary.maxDrawdownAmount) + " from the equity peak") +
        "</section>" +
        "<section class=\"dash-grid\">" +
          "<article class=\"card\">" +
            "<div class=\"panel-head\"><h2>Equity curve</h2><span>Closed trades, sample account</span></div>" +
            "<div class=\"chart-wrap\" id=\"equity-chart\">" +
              "<canvas aria-label=\"Equity curve from the sample journal\" role=\"img\"></canvas>" +
              "<div class=\"chart-tip\" hidden></div>" +
            "</div>" +
          "</article>" +
          "<article class=\"card\">" +
            "<div class=\"panel-head\"><h2>Period breakdown</h2></div>" +
            "<dl class=\"breakdown\">" +
              row("Gross profit", format.money(summary.grossProfit, { sign: true }), "pnl-pos") +
              row("Gross loss", format.money(-summary.grossLoss, { sign: true }), "pnl-neg") +
              row("Average winner", format.money(summary.averageWin, { sign: true }), "pnl-pos") +
              row("Average loser", format.money(summary.averageLoss, { sign: true }), "pnl-neg") +
              row("Expectancy", (summary.averageR > 0 ? "+" : "") + summary.averageR.toFixed(2) + "R", format.pnlClass(summary.averageR)) +
              row("Best trade", best ? best.symbol + " " + format.money(best.pnl, { sign: true }) : "—", best ? "pnl-pos" : "") +
              row("Worst trade", worst ? worst.symbol + " " + format.money(worst.pnl, { sign: true }) : "—", worst ? "pnl-neg" : "") +
            "</dl>" +
            (summary.openCount
              ? "<p class=\"note\">Equity in the header includes " + format.money(summary.openPnl, { sign: true }) + " unrealized on " + summary.openCount + " open " + (summary.openCount === 1 ? "trade" : "trades") + ".</p>"
              : "") +
          "</article>" +
        "</section>" +
        "<section class=\"card stack\">" +
          "<div class=\"panel-head\"><h2>Recent trades</h2><a class=\"text-link\" href=\"#journal\">Open journal</a></div>" +
          table(snapshot.trades.slice(0, 6)) +
        "</section>"
      );
    },

    journal: function () {
      return (
        "<article class=\"card\">" +
          "<div class=\"toolbar\">" +
            "<input id=\"journal-search\" type=\"search\" placeholder=\"Search symbol, strategy, or ticket\" aria-label=\"Search trades\">" +
            "<select id=\"journal-filter\" aria-label=\"Filter trades\">" +
              "<option value=\"all\">All trades</option>" +
              "<option value=\"open\">Open</option>" +
              "<option value=\"closed\">Closed</option>" +
              "<option value=\"long\">Long</option>" +
              "<option value=\"short\">Short</option>" +
            "</select>" +
          "</div>" +
          "<p class=\"hint\" id=\"journal-count\"></p>" +
          "<div id=\"journal-table\"></div>" +
        "</article>"
      );
    },

    calendar: function () {
      const monthDate = new Date(state.month.year, state.month.month, 1);
      const label = monthDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      const bounds = monthBounds();
      const atStart = sameMonth(state.month, bounds.start);
      const atEnd = sameMonth(state.month, bounds.end);
      return (
        "<div class=\"cal-nav\">" +
          "<button type=\"button\" class=\"btn\" data-cal-nav=\"-1\"" + (atStart ? " disabled" : "") + ">Previous</button>" +
          "<h2>" + esc(label) + "</h2>" +
          "<button type=\"button\" class=\"btn\" data-cal-nav=\"1\"" + (atEnd ? " disabled" : "") + ">Next</button>" +
        "</div>" +
        "<div class=\"cal-grid\">" +
          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(function (day) {
            return "<div class=\"cal-dow\">" + day + "</div>";
          }).join("") +
          calendarCells() +
        "</div>" +
        "<section class=\"card stack\" id=\"day-detail\">" + dayDetail() + "</section>"
      );
    },

    analytics: function () {
      const summary = snapshot.summary;
      return (
        "<p class=\"intro\">These breakdowns are calculated from the closed sample trades.</p>" +
        "<section class=\"split\">" +
          "<article class=\"card\">" +
            "<div class=\"panel-head\"><h2>By strategy</h2><span>Win rate</span></div>" +
            "<div class=\"bar-list\">" + snapshot.strategies.map(function (item) {
              return (
                "<div>" +
                  "<div class=\"bar-top\"><span>" + esc(item.name) + "</span><span class=\"" + format.pnlClass(item.netPnl) + "\">" +
                    esc(format.money(item.netPnl, { sign: true })) + "</span></div>" +
                  "<div class=\"bar-track\"><div class=\"bar-fill\" style=\"width:" + Math.round(item.winRate * 100) + "%\"></div></div>" +
                  "<p class=\"hint\">" + esc(format.percent(item.winRate)) + " · " + item.trades + " trades · " +
                    (item.averageR > 0 ? "+" : "") + item.averageR.toFixed(2) + "R</p>" +
                "</div>"
              );
            }).join("") + "</div>" +
          "</article>" +
          "<article class=\"card\">" +
            "<div class=\"panel-head\"><h2>By session</h2></div>" +
            "<div class=\"bar-list\">" + snapshot.sessions.map(function (item) {
              return (
                "<div>" +
                  "<div class=\"bar-top\"><span>" + esc(item.name) + "</span><span>" + item.trades + " trades</span></div>" +
                  "<div class=\"bar-track\"><div class=\"bar-fill\" style=\"width:" + Math.round(item.winRate * 100) + "%\"></div></div>" +
                  "<p class=\"hint " + format.pnlClass(item.netPnl) + "\">" + esc(format.money(item.netPnl, { sign: true })) +
                    " · " + esc(format.percent(item.winRate)) + " win rate</p>" +
                "</div>"
              );
            }).join("") + "</div>" +
          "</article>" +
        "</section>" +
        "<section class=\"card stack\">" +
          "<div class=\"panel-head\"><h2>Long versus short</h2><span>" + summary.closedCount + " closed trades</span></div>" +
          "<div class=\"side-grid\">" + snapshot.sides.map(function (side) {
            return (
              "<div class=\"mini-stat\">" +
                "<span class=\"badge badge-" + side.name + "\">" + esc(side.name) + "</span>" +
                "<strong class=\"" + format.pnlClass(side.netPnl) + "\">" + esc(format.money(side.netPnl, { sign: true })) + "</strong>" +
                "<span>" + esc(format.percent(side.winRate)) + " win rate · " + side.trades + " trades</span>" +
              "</div>"
            );
          }).join("") + "</div>" +
        "</section>"
      );
    },

    strategies: function () {
      return (
        "<p class=\"intro\">Three sample playbooks. Rules here are notes for the journal, not a live signal service.</p>" +
        "<div class=\"strategy-grid\">" + snapshot.strategies.map(function (item) {
          return (
            "<article class=\"card strategy-card\">" +
              "<span class=\"panel-kicker\">Playbook</span>" +
              "<h3>" + esc(item.name) + "</h3>" +
              "<p>" + esc(item.note) + "</p>" +
              "<div class=\"meta-row\"><span>" + item.trades + " trades</span><span>" + esc(format.percent(item.winRate)) + "</span></div>" +
              "<div class=\"meta-row\"><span>Net</span><span class=\"" + format.pnlClass(item.netPnl) + "\">" +
                esc(format.money(item.netPnl, { sign: true })) + "</span></div>" +
            "</article>"
          );
        }).join("") + "</div>"
      );
    },

    settings: function () {
      const account = snapshot.account;
      return (
        "<div class=\"settings-grid\">" +
          "<article class=\"card\">" +
            "<div class=\"panel-head\"><h2>Journal</h2></div>" +
            "<dl class=\"settings\">" +
              "<div><dt>Account</dt><dd>" + esc(account.name) + "</dd></div>" +
              "<div><dt>Base currency</dt><dd>" + esc(account.currency) + "</dd></div>" +
              "<div><dt>Starting balance</dt><dd>" + esc(format.money(account.startingBalance)) + "</dd></div>" +
              "<div><dt>Storage</dt><dd>Bundled sample data</dd></div>" +
            "</dl>" +
          "</article>" +
          "<article class=\"card\">" +
            "<div class=\"panel-head\"><h2>Appearance</h2></div>" +
            "<dl class=\"settings\">" +
              "<div><dt>Theme</dt><dd>Dark</dd></div>" +
              "<div><dt>Numbers</dt><dd>USD, two decimals</dd></div>" +
            "</dl>" +
          "</article>" +
          "<article class=\"card mt5-card\">" +
            "<div>" +
              "<h2>MetaTrader 5</h2>" +
              "<p>Not connected. A later Laravel service can import MT5 history into PostgreSQL and return it in the same snapshot this screen already uses.</p>" +
            "</div>" +
            "<button type=\"button\" class=\"btn\" disabled>Connect later</button>" +
          "</article>" +
        "</div>"
      );
    }
  };

  function stat(label, value, valueClass, meta) {
    return (
      "<article class=\"stat\">" +
        "<div class=\"stat-top\"><span class=\"stat-label\">" + esc(label) + "</span></div>" +
        "<p class=\"stat-value " + valueClass + "\">" + esc(value) + "</p>" +
        "<p class=\"stat-meta\">" + esc(meta) + "</p>" +
      "</article>"
    );
  }

  function row(label, value, valueClass) {
    return "<div><dt>" + esc(label) + "</dt><dd class=\"" + valueClass + "\">" + esc(value) + "</dd></div>";
  }

  function filteredTrades() {
    const query = (document.querySelector("#journal-search").value || "").trim().toLowerCase();
    const filter = document.querySelector("#journal-filter").value;
    return snapshot.trades.filter(function (rowItem) {
      const matchesFilter = filter === "all" || rowItem.status === filter || rowItem.side === filter;
      const haystack = (rowItem.symbol + " " + rowItem.strategy + " " + rowItem.id).toLowerCase();
      return matchesFilter && (!query || haystack.indexOf(query) !== -1);
    });
  }

  function paintJournal() {
    const rows = filteredTrades();
    document.querySelector("#journal-table").innerHTML = table(rows);
    document.querySelector("#journal-count").textContent = "Showing " + rows.length + " of " + snapshot.trades.length + " trades";
  }

  function monthKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function closedTrades() {
    return snapshot.trades.filter(function (rowItem) {
      return rowItem.closedAt;
    });
  }

  function latestClosedMonth() {
    const rows = closedTrades();
    if (!rows.length) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() };
    }
    const end = new Date(Math.max.apply(null, rows.map(function (rowItem) {
      return new Date(rowItem.closedAt).getTime();
    })));
    return { year: end.getFullYear(), month: end.getMonth() };
  }

  function equityStart(points) {
    if (!points.length) return new Date().toISOString();
    return points.length > 1 ? points[1].at : points[0].at;
  }

  function equityEnd(points) {
    if (!points.length) return new Date().toISOString();
    return points[points.length - 1].at;
  }

  function monthBounds() {
    const rows = closedTrades();
    if (!rows.length) {
      const now = new Date();
      const month = { year: now.getFullYear(), month: now.getMonth() };
      return { start: month, end: month };
    }
    const stamps = rows.map(function (rowItem) {
      return new Date(rowItem.closedAt).getTime();
    });
    const start = new Date(Math.min.apply(null, stamps));
    const end = new Date(Math.max.apply(null, stamps));
    return {
      start: { year: start.getFullYear(), month: start.getMonth() },
      end: { year: end.getFullYear(), month: end.getMonth() }
    };
  }

  function sameMonth(a, b) {
    return a.year === b.year && a.month === b.month;
  }

  function tradesOn(key) {
    return closedTrades().filter(function (rowItem) {
      return rowItem.closedAt.slice(0, 10) === key;
    });
  }

  function calendarCells() {
    const first = new Date(state.month.year, state.month.month, 1);
    const days = new Date(state.month.year, state.month.month + 1, 0).getDate();
    let html = "";
    for (let blank = 0; blank < first.getDay(); blank += 1) html += "<div class=\"cal-pad\"></div>";

    const todayKey = monthKey(new Date());
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(state.month.year, state.month.month, day);
      const key = monthKey(date);
      const rows = tradesOn(key);
      const net = rows.reduce(function (total, rowItem) { return total + rowItem.pnl; }, 0);
      const classes = ["cal-day"];
      if (rows.length && net > 0) classes.push("has-trades", "is-pos");
      if (rows.length && net < 0) classes.push("has-trades", "is-neg");
      if (rows.length && net === 0) classes.push("has-trades");
      if (key === todayKey) classes.push("is-today");
      if (key === state.selectedDate) classes.push("is-selected");
      html += "<button type=\"button\" class=\"" + classes.join(" ") + "\" data-date=\"" + key + "\">" +
        "<span class=\"cal-num\">" + day + "</span>" +
        (rows.length
          ? "<span class=\"cal-pnl " + format.pnlClass(net) + "\">" + esc(format.money(net, { sign: true })) + "</span>" +
            "<span class=\"cal-count\">" + rows.length + (rows.length === 1 ? " trade" : " trades") + "</span>"
          : "") +
        "</button>";
    }
    return html;
  }

  function dayDetail() {
    if (!state.selectedDate) {
      return "<h2>Day detail</h2><p class=\"note\">Select a highlighted day to list its trades.</p>";
    }
    const rows = tradesOn(state.selectedDate);
    return "<div class=\"panel-head\"><h2>" + esc(format.formatDate(state.selectedDate + "T12:00:00")) + "</h2><span>" +
      rows.length + (rows.length === 1 ? " trade" : " trades") + "</span></div>" + table(rows);
  }

  view.addEventListener("input", function (event) {
    if (event.target.id === "journal-search" || event.target.id === "journal-filter") paintJournal();
  });

  view.addEventListener("change", function (event) {
    if (event.target.id === "journal-filter") paintJournal();
  });

  view.addEventListener("click", function (event) {
    const shift = event.target.closest("[data-cal-nav]");
    if (shift) {
      const bounds = monthBounds();
      const next = new Date(state.month.year, state.month.month + Number(shift.dataset.calNav), 1);
      const candidate = { year: next.getFullYear(), month: next.getMonth() };
      const afterStart = candidate.year > bounds.start.year || (candidate.year === bounds.start.year && candidate.month >= bounds.start.month);
      const beforeEnd = candidate.year < bounds.end.year || (candidate.year === bounds.end.year && candidate.month <= bounds.end.month);
      if (afterStart && beforeEnd) {
        state.month = candidate;
        state.selectedDate = null;
        render(false);
      }
    }

    const day = event.target.closest("[data-date]");
    if (day) {
      state.selectedDate = state.selectedDate === day.dataset.date ? null : day.dataset.date;
      render(false);
    }
  });

  menuButton.addEventListener("click", function () {
    if (sidebar.classList.contains("is-open")) closeMenu();
    else openMenu();
  });
  backdrop.addEventListener("click", closeMenu);
  document.querySelector(".nav").addEventListener("click", function (event) {
    if (event.target.closest(".nav-link")) closeMenu();
  });
  document.querySelector(".brand").addEventListener("click", closeMenu);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMenu();
  });

  window.addEventListener("hashchange", function () {
    closeMenu();
    render(true);
  });

  if (!pages[location.hash.replace("#", "")]) {
    history.replaceState(null, "", "#dashboard");
  }
  render(false);
})();
