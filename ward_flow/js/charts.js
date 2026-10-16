/* Tiny SVG chart helpers (no libraries, works offline). Hover text lives in data-tip attributes. */
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nice = (lo, hi, n = 4) => {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, t = [];
    for (let v = a; v <= b + 1e-9; v += step) t.push(+v.toFixed(6));
    return t;
  };

  /* line chart with optional band, forecast divider and per-column tooltip */
  function line(o) {
    const W = o.w || 1000, H = o.h || 300, L = 38, R = 12, T = 12, B = 26, n = o.labels.length;
    let lo = o.yMin ?? Math.min(...o.series.flatMap(s => s.vals), ...(o.band ? o.band.lo : [Infinity]));
    let hi = o.yMax ?? Math.max(...o.series.flatMap(s => s.vals), ...(o.band ? o.band.hi : [-Infinity]));
    const ticks = nice(lo, hi, 4); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const x = i => L + (W - L - R) * (n === 1 ? .5 : i / (n - 1)), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "Line chart")}">`;
    ticks.forEach(t => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${o.fmt ? o.fmt(t) : t}</text>`; });
    const every = o.xEvery || Math.ceil(n / 7);
    o.labels.forEach((l, i) => { if (i % every === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
    if (o.split != null) s += `<rect x="${x(o.split) - 3}" y="${T}" width="${W - R - x(o.split) + 3}" height="${H - T - B}" fill="var(--panel-2)" opacity=".7"/><text x="${x(o.split) + 6}" y="${T + 11}" class="lbl">${esc(o.splitLabel || "forecast")}</text>`;
    if (o.band) {
      let d = ""; for (let i = o.band.from || 0; i < n; i++) d += (d ? "L" : "M") + x(i) + " " + y(o.band.hi[i]);
      for (let i = n - 1; i >= (o.band.from || 0); i--) d += "L" + x(i) + " " + y(o.band.lo[i]);
      s += `<path d="${d}Z" fill="var(--accent)" opacity=".16"/>`;
    }
    o.series.forEach(se => {
      let d = ""; se.vals.forEach((v, i) => { if (v == null) return; d += (d ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); });
      s += `<path d="${d}" fill="none" stroke="${se.color || "var(--accent)"}" stroke-width="${se.width || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    if (o.hline) o.hline.forEach(h => { s += `<line x1="${L}" x2="${W - R}" y1="${y(h.v)}" y2="${y(h.v)}" stroke="${h.color || "var(--ink)"}" stroke-dasharray="4 4"/><text x="${W - R}" y="${y(h.v) - 4}" text-anchor="end" class="lbl">${esc(h.label)}</text>`; });
    const cw = (W - L - R) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) {
      const tip = `<b>${esc(o.tipLabels ? o.tipLabels[i] : o.labels[i])}</b>` + o.series.map(se => se.vals[i] == null ? "" : `<br>${esc(se.name)}: ${o.tipFmt ? o.tipFmt(se.vals[i]) : se.vals[i]}`).join("") + (o.band && i >= (o.band.from || 0) ? `<br>Likely range: ${o.tipFmt ? o.tipFmt(o.band.lo[i]) : o.band.lo[i]} to ${o.tipFmt ? o.tipFmt(o.band.hi[i]) : o.band.hi[i]}` : "");
      s += `<rect class="hit" x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${H - T - B}" data-tip="${esc(tip)}"/>`;
    }
    return s + "</svg>";
  }

  function spark(vals, o = {}) {
    const W = o.w || 180, H = o.h || 40, p = 3; if (!vals.length) return "";
    const lo = Math.min(...vals, o.zero ?? Infinity), hi = Math.max(...vals, o.zero ?? -Infinity);
    const x = i => p + (W - 2 * p) * i / Math.max(1, vals.length - 1), y = v => p + (H - 2 * p) * (1 - (v - lo) / (hi - lo || 1));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(o.aria || "Trend")}" style="display:block;overflow:visible">`;
    if (o.zero != null) s += `<line x1="0" x2="${W}" y1="${y(o.zero)}" y2="${y(o.zero)}" stroke="var(--line)" stroke-dasharray="3 3"/>`;
    s += `<path d="${vals.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("")}" fill="none" stroke="${o.color || "var(--accent)"}" stroke-width="2" stroke-linejoin="round"/>`;
    const li = vals.length - 1; s += `<circle cx="${x(li)}" cy="${y(vals[li])}" r="3.5" fill="${o.color || "var(--accent)"}" stroke="var(--panel)" stroke-width="2"/>`;
    return s + "</svg>";
  }

  /* scatter: points [{x,y,label,tip,color}] */
  function scatter(o) {
    const W = o.w || 1000, H = o.h || 340, L = 64, R = 16, T = 12, B = 38;
    const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y);
    const x0 = o.xMin ?? Math.min(...xs), x1 = o.xMax ?? Math.max(...xs), y1 = Math.max(...ys) * 1.12 || 1;
    const X = v => L + (W - L - R) * (v - x0) / (x1 - x0 || 1), Y = v => T + (H - T - B) * (1 - v / y1);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "Scatter chart")}">`;
    nice(0, y1, 4).forEach(t => { if (t <= y1) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${o.fmtY ? o.fmtY(t) : t}</text>`; });
    (o.xTicks || []).forEach(t => { s += `<text x="${X(t)}" y="${H - 20}" text-anchor="middle">${o.fmtX ? o.fmtX(t) : t}</text>`; });
    s += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${esc(o.xTitle || "")}</text><text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(o.yTitle || "")}</text>`;
    o.pts.forEach(p => { s += `<g data-tip="${esc(p.tip)}"><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r || 11}" fill="${p.color}" stroke="var(--panel)" stroke-width="2"/><text x="${X(p.x)}" y="${Y(p.y) + 4}" text-anchor="middle" style="fill:#fff;font-weight:700;font-size:11px">${esc(p.label)}</text></g>`; });
    return s + "</svg>";
  }

  /* vertical bars: bars [{label, a, b?}] two series (b optional) */
  function bars(o) {
    const W = o.w || 520, H = o.h || 220, L = 40, R = 8, T = 10, B = 30, n = o.bars.length;
    const ticks = nice(0, Math.max(...o.bars.flatMap(b => [b.a, b.b ?? 0]), o.yMax || 0), 4), top = ticks[ticks.length - 1];
    const Y = v => T + (H - T - B) * (1 - v / top), bw = (W - L - R) / n;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "Bar chart")}">`;
    ticks.forEach(t => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${o.fmt ? o.fmt(t) : t}</text>`; });
    o.bars.forEach((b, i) => {
      const x = L + i * bw, two = b.b != null, w = (bw - 14) / (two ? 2 : 1);
      s += `<rect x="${x + 7}" y="${Y(b.a)}" width="${w - (two ? 1 : 0)}" height="${Math.max(0, Y(0) - Y(b.a))}" rx="3" fill="${o.colorA || "var(--accent)"}"/>`;
      if (two) s += `<rect x="${x + 7 + w + 1}" y="${Y(b.b)}" width="${w - 1}" height="${Math.max(0, Y(0) - Y(b.b))}" rx="3" fill="${o.colorB || "var(--stage-wait)"}"/>`;
      s += `<text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle">${esc(b.label)}</text><rect class="hit" x="${x}" y="${T}" width="${bw}" height="${H - T - B}" data-tip="${esc(b.tip || "")}"/>`;
    });
    return s + "</svg>";
  }
  window.Charts = { line, spark, scatter, bars, esc, nice };
})();
