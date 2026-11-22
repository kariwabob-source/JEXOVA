/*
  Sample journal used by the prototype.

  The shape of `snapshot` is the draft contract for a future API.
  When the backend exists, replace getSnapshot() with a request that returns
  this same structure.
  The screens do not need to know whether the numbers came from this file,
  from MT5, or from the database.
*/
const STARTING_BALANCE = 25000;

const strategyNotes = {
    "Opening Range Breakout": "Trade a break of the opening range only when momentum confirms the move.",
    "London Reversal": "Fade an early London extreme back toward the prior session range.",
    "Trend Pullback": "Enter with the higher-timeframe trend after a shallow pullback."
  };

const trades = [
    trade("T-1042", "EURUSD", "long", "Opening Range Breakout", "London", "2026-10-16T08:12:00", "2026-10-16T11:05:00", 1.08342, 1.0861, 1, 180, 1.2),
    trade("T-1043", "GBPUSD", "short", "London Reversal", "London", "2026-10-17T09:02:00", "2026-10-17T10:40:00", 1.3288, 1.3304, 0.8, -95, -0.6),
    trade("T-1044", "XAUUSD", "long", "Trend Pullback", "New York", "2026-10-20T14:15:00", "2026-10-20T16:45:00", 2684.2, 2698.4, 0.3, 420, 1.8),
    trade("T-1045", "NAS100", "short", "Opening Range Breakout", "New York", "2026-10-21T15:05:00", "2026-10-21T15:50:00", 20110, 20185, 0.5, -500, -1),
    trade("T-1046", "EURUSD", "long", "Trend Pullback", "London", "2026-10-22T08:40:00", "2026-10-22T12:10:00", 1.0871, 1.0896, 1.2, 260, 1.1),
    trade("T-1047", "GBPJPY", "long", "London Reversal", "London", "2026-10-23T07:55:00", "2026-10-23T09:30:00", 197.42, 197.78, 0.7, 140, 0.8),
    trade("T-1048", "XAUUSD", "short", "Opening Range Breakout", "London", "2026-10-27T08:20:00", "2026-10-27T09:10:00", 2712.5, 2718.1, 0.2, -150, -0.7),
    trade("T-1049", "US30", "long", "Trend Pullback", "New York", "2026-10-28T15:35:00", "2026-10-28T18:05:00", 47240, 47410, 0.5, 510, 2.1),
    trade("T-1050", "EURUSD", "short", "London Reversal", "London", "2026-10-29T09:15:00", "2026-10-29T11:00:00", 1.0924, 1.0911, 1, 95, 0.5),
    trade("T-1051", "NAS100", "long", "Opening Range Breakout", "New York", "2026-10-30T14:50:00", "2026-10-30T16:05:00", 20340, 20195, 1, -900, -1),
    trade("T-1052", "GBPUSD", "long", "Trend Pullback", "London", "2026-11-03T08:25:00", "2026-11-03T13:15:00", 1.3142, 1.3174, 0.9, 275, 1.3),
    trade("T-1053", "XAUUSD", "long", "Opening Range Breakout", "London", "2026-11-04T08:05:00", "2026-11-04T12:40:00", 2722.8, 2746.1, 0.4, 640, 2.4),
    trade("T-1054", "EURJPY", "short", "London Reversal", "Asia", "2026-11-05T01:20:00", "2026-11-05T03:05:00", 176.85, 177.12, 0.6, -110, -0.5),
    trade("T-1055", "US30", "short", "Trend Pullback", "New York", "2026-11-06T15:10:00", "2026-11-06T17:25:00", 47680, 47490, 0.4, 390, 1.6),
    trade("T-1056", "EURUSD", "long", "Opening Range Breakout", "London", "2026-11-09T08:18:00", "2026-11-09T10:02:00", 1.0948, 1.0961, 0.8, 120, 0.6),
    trade("T-1057", "GBPUSD", "short", "London Reversal", "London", "2026-11-10T09:40:00", "2026-11-10T11:15:00", 1.3222, 1.3251, 1, -260, -0.9),
    trade("T-1058", "NAS100", "long", "Trend Pullback", "New York", "2026-11-11T15:22:00", "2026-11-11T18:10:00", 20480, 20615, 0.6, 455, 1.9),
    trade("T-1059", "XAUUSD", "short", "Opening Range Breakout", "London", "2026-11-12T08:11:00", "2026-11-12T11:48:00", 2754.2, 2744.6, 0.25, 210, 0.9),
    trade("T-1060", "EURUSD", "long", "London Reversal", "London", "2026-11-13T08:06:00", "2026-11-13T09:22:00", 1.0972, 1.0964, 1, -75, -0.4),
    trade("T-1061", "US30", "long", "Trend Pullback", "New York", "2026-11-13T15:10:00", null, 47842.5, null, 0.4, 85, null, "open")
  ];

function trade(id, symbol, side, strategy, session, openedAt, closedAt, entry, exit, lots, pnl, rMultiple, status) {
    return {
      id: id,
      symbol: symbol,
      side: side,
      strategy: strategy,
      session: session,
      openedAt: openedAt,
      closedAt: closedAt,
      entry: entry,
      exit: exit,
      lots: lots,
      pnl: pnl,
      rMultiple: rMultiple,
      status: status || "closed"
    };
  }

function sum(rows, field) {
    return rows.reduce(function (total, row) {
      const amount = Number(row[field]);
      return total + (Number.isFinite(amount) ? amount : 0);
    }, 0);
  }

function buildSnapshot() {
    const closed = trades.filter(function (row) {
      return row.status === "closed";
    });
    const open = trades.filter(function (row) {
      return row.status === "open";
    });
    const wins = closed.filter(function (row) {
      return row.pnl > 0;
    });
    const losses = closed.filter(function (row) {
      return row.pnl < 0;
    });
    const grossProfit = sum(wins, "pnl");
    const grossLoss = Math.abs(sum(losses, "pnl"));
    const netPnl = sum(closed, "pnl");
    const openPnl = sum(open, "pnl");

    const ordered = closed.slice().sort(function (a, b) {
      return new Date(a.closedAt) - new Date(b.closedAt);
    });

    const equity = [{
      at: "2026-10-15T16:00:00",
      equity: STARTING_BALANCE,
      title: "Starting balance",
      pnl: null
    }];

    let running = STARTING_BALANCE;
    let peak = STARTING_BALANCE;
    let maxDrawdownAmount = 0;
    let maxDrawdownFraction = 0;

    ordered.forEach(function (row) {
      running += row.pnl;
      if (running > peak) peak = running;
      const drawdown = peak - running;
      if (drawdown > maxDrawdownAmount) {
        maxDrawdownAmount = drawdown;
        maxDrawdownFraction = peak ? drawdown / peak : 0;
      }
      equity.push({
        at: row.closedAt,
        equity: running,
        title: row.symbol + " · " + row.side,
        pnl: row.pnl
      });
    });

    const recent = trades.slice().sort(function (a, b) {
      return new Date(b.closedAt || b.openedAt) - new Date(a.closedAt || a.openedAt);
    });

    return {
      account: {
        name: "Sample account",
        platform: "MT5",
        currency: "USD",
        startingBalance: STARTING_BALANCE,
        equity: STARTING_BALANCE + netPnl + openPnl
      },
      trades: recent,
      equity: equity,
      summary: {
        netPnl: netPnl,
        openPnl: openPnl,
        grossProfit: grossProfit,
        grossLoss: grossLoss,
        winRate: closed.length ? wins.length / closed.length : 0,
        wins: wins.length,
        losses: losses.length,
        closedCount: closed.length,
        openCount: open.length,
        profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
        averageWin: wins.length ? grossProfit / wins.length : 0,
        averageLoss: losses.length ? -(grossLoss / losses.length) : 0,
        averageR: closed.length ? sum(closed, "rMultiple") / closed.length : 0,
        maxDrawdownAmount: maxDrawdownAmount,
        maxDrawdownFraction: maxDrawdownFraction,
        best: wins.slice().sort(function (a, b) { return b.pnl - a.pnl; })[0] || null,
        worst: losses.slice().sort(function (a, b) { return a.pnl - b.pnl; })[0] || null,
        returnFraction: netPnl / STARTING_BALANCE
      },
      strategies: groupBy(closed, "strategy").map(function (group) {
        return {
          name: group.name,
          note: strategyNotes[group.name] || "",
          trades: group.rows.length,
          wins: group.rows.filter(function (row) { return row.pnl > 0; }).length,
          winRate: group.rows.filter(function (row) { return row.pnl > 0; }).length / group.rows.length,
          netPnl: sum(group.rows, "pnl"),
          averageR: sum(group.rows, "rMultiple") / group.rows.length
        };
      }).sort(function (a, b) { return b.netPnl - a.netPnl; }),
      sessions: ["Asia", "London", "New York"].map(function (name) {
        const rows = closed.filter(function (row) { return row.session === name; });
        const sessionWins = rows.filter(function (row) { return row.pnl > 0; }).length;
        return {
          name: name,
          trades: rows.length,
          winRate: rows.length ? sessionWins / rows.length : 0,
          netPnl: sum(rows, "pnl")
        };
      }),
      sides: ["long", "short"].map(function (side) {
        const rows = closed.filter(function (row) { return row.side === side; });
        const sideWins = rows.filter(function (row) { return row.pnl > 0; }).length;
        return {
          name: side,
          trades: rows.length,
          winRate: rows.length ? sideWins / rows.length : 0,
          netPnl: sum(rows, "pnl")
        };
      })
    };
  }

function groupBy(rows, field) {
    const groups = [];
    rows.forEach(function (row) {
      let group = groups.find(function (item) { return item.name === row[field]; });
      if (!group) {
        group = { name: row[field], rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    });
    return groups;
  }

export function getSnapshot() {
  return buildSnapshot();
}
