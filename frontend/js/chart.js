/*
  Equity curve drawn on a canvas element.

  No chart library is required. Pass the equity array from the snapshot:
  [{ at, equity, title, pnl }, ...]
*/
import { compactMoney, escapeHtml, formatDate, money } from "./format.js";

export function mount(container, points) {
    const canvas = container.querySelector("canvas");
    const tip = container.querySelector(".chart-tip");
    if (!canvas || !points || points.length < 2) return function () {};

    const state = { hover: -1 };
    const context = canvas.getContext("2d");

    function layout() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const width = rect.width;
      const height = rect.height;
      const pad = { left: 54, right: 12, top: 16, bottom: 28 };
      const plotWidth = Math.max(1, width - pad.left - pad.right);
      const plotHeight = Math.max(1, height - pad.top - pad.bottom);
      const values = points.map(function (point) { return point.equity; });
      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      const span = max - min || 1;
      const yMin = min - span * 0.16;
      const yMax = max + span * 0.16;

      return {
        width: width,
        height: height,
        pad: pad,
        plotWidth: plotWidth,
        plotHeight: plotHeight,
        yMin: yMin,
        yMax: yMax,
        x: function (index) {
          return pad.left + (index / (points.length - 1)) * plotWidth;
        },
        y: function (value) {
          return pad.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
        }
      };
    }

    function draw() {
      const box = layout();
      const ctx = context;
      ctx.clearRect(0, 0, box.width, box.height);

      ctx.font = "12px IBM Plex Mono, Consolas, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 1;

      for (let tick = 0; tick < 4; tick += 1) {
        const value = box.yMin + ((box.yMax - box.yMin) * (3 - tick)) / 3;
        const y = box.y(value);
        ctx.strokeStyle = "rgba(243, 239, 230, 0.08)";
        ctx.beginPath();
        ctx.moveTo(box.pad.left, y);
        ctx.lineTo(box.width - box.pad.right, y);
        ctx.stroke();
        ctx.fillStyle = "#727c8e";
        ctx.fillText(compactMoney(value), box.pad.left - 8, y);
      }

      const bottom = box.pad.top + box.plotHeight;
      const gradient = ctx.createLinearGradient(0, box.pad.top, 0, bottom);
      gradient.addColorStop(0, "rgba(224, 177, 90, 0.28)");
      gradient.addColorStop(1, "rgba(224, 177, 90, 0)");

      ctx.beginPath();
      points.forEach(function (point, index) {
        const x = box.x(index);
        const y = box.y(point.equity);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(box.x(points.length - 1), bottom);
      ctx.lineTo(box.x(0), bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      points.forEach(function (point, index) {
        const x = box.x(index);
        const y = box.y(point.equity);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "#e0b15a";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(224, 177, 90, 0.35)";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const active = state.hover >= 0 ? state.hover : points.length - 1;
      if (state.hover >= 0) {
        ctx.strokeStyle = "rgba(243, 239, 230, 0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(box.x(active), box.pad.top);
        ctx.lineTo(box.x(active), bottom);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.fillStyle = "#f4f0e8";
      ctx.strokeStyle = "#e0b15a";
      ctx.lineWidth = 2;
      ctx.arc(box.x(active), box.y(points[active].equity), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#727c8e";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const labelIndexes = box.width < 520
        ? [0, points.length - 1]
        : [0, Math.floor((points.length - 1) / 2), points.length - 1];
      labelIndexes.forEach(function (index) {
        ctx.fillText(formatDate(points[index].at, false), box.x(index), bottom + 8);
      });
    }

    function nearest(event) {
      const bounds = canvas.getBoundingClientRect();
      const box = layout();
      const x = event.clientX - bounds.left;
      if (x < box.pad.left || x > box.width - box.pad.right) return -1;
      let best = 0;
      let bestDistance = Infinity;
      points.forEach(function (_, index) {
        const distance = Math.abs(box.x(index) - x);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      return best;
    }

    function showTip(index, event) {
      const point = points[index];
      const bounds = container.getBoundingClientRect();
      const pnl = point.pnl == null
        ? "Balance before these trades"
        : money(point.pnl, { sign: true });
      tip.hidden = false;
      tip.innerHTML = "<strong>" + escapeHtml(point.title) + "</strong>" +
        "<span>" + escapeHtml(formatDate(point.at)) + " · " + escapeHtml(pnl) + "</span>" +
        "<span>Equity " + escapeHtml(money(point.equity)) + "</span>";
      const left = event.clientX - bounds.left;
      tip.style.left = Math.max(70, Math.min(left, bounds.width - 70)) + "px";
      tip.style.top = (event.clientY - bounds.top) + "px";
    }

    function onMove(event) {
      const index = nearest(event);
      state.hover = index;
      draw();
      if (index >= 0) showTip(index, event);
      else tip.hidden = true;
    }

    function onLeave() {
      state.hover = -1;
      tip.hidden = true;
      draw();
    }

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const observer = new ResizeObserver(function () {
      draw();
    });
    observer.observe(container);
    draw();

    return function () {
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
}
