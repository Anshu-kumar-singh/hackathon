/* Ward Flow engine: all numbers on the site come from here.
   Pure functions over window.FW (built by pipeline/build_data.py). No network, no API keys. */
(function () {
  const D = window.FW;
  const N = D.meta.days, ND = D.depts.length, NE = D.meta.n_enc;
  const E = D.enc, T = D.tests;
  const WIN = 14, BASE = 56;            // recent window and "normal" baseline, in days
  const FIRST_DAY = WIN + BASE - 1;     // first day with a full baseline

  // ---------- settings (editable in the UI; assumptions, not facts from the data) ----------
  const DEFAULTS = { target: [20, 35, 60, 90], sla: [60, 120], watch: 2.5, alert: 3.5 };
  const S = JSON.parse(JSON.stringify(DEFAULTS));
  try { const saved = JSON.parse(localStorage.getItem("wardflow.settings") || "null"); if (saved) Object.assign(S, saved); } catch (e) {}
  function saveSettings() { try { localStorage.setItem("wardflow.settings", JSON.stringify(S)); } catch (e) {} }

  // ---------- tree model inference (same maths as scikit-learn) ----------
  function evalTrees(m, x) {
    let s = m.init;
    for (const t of m.trees) {
      let i = 0;
      while (t.l[i] !== -1) i = x[t.f[i]] <= t.t[i] ? t.l[i] : t.r[i];
      s += m.lr * t.v[i];
    }
    return s;
  }
  function predictAll(x) {
    const M = D.models;
    const mean = evalTrees(M.mean, x);
    let lo = Math.min(evalTrees(M.lo, x), mean), hi = Math.max(evalTrees(M.hi, x), mean);
    const raw = evalTrees(M.long, x);
    return { mean, lo: Math.max(0, lo), hi, pLong: 1 / (1 + Math.exp(-raw)) };
  }
  function makeX(o) {   // o: {tri, dept, vis, hour, dow, age, chr, qd, qa}
    const x = new Array(23).fill(0);
    x[0] = o.tri; x[1 + o.dept] = 1; x[13 + o.vis] = 1;
    x[17] = o.hour; x[18] = o.dow; x[19] = o.age; x[20] = o.chr; x[21] = o.qd; x[22] = o.qa;
    return x;
  }
  const GROUPS = [
    ["Triage level", [0]], ["Department", Array.from({ length: 12 }, (_, i) => 1 + i)], ["Visit type", [13, 14, 15, 16]],
    ["Hour of arrival", [17]], ["Day of week", [18]], ["Age", [19]], ["Chronic condition", [20]],
    ["Patients already waiting", [21, 22]]];
  function explainPrediction(x) {
    // what-if effect: swap one factor at a time for typical values from the data, see how the estimate moves
    const base = predictAll(x), bg = D.background, out = [];
    let avg = 0; bg.forEach(r => avg += predictAll(r).mean); avg /= bg.length;
    for (const [name, cols] of GROUPS) {
      let s = 0;
      for (const r of bg) { const z = x.slice(); cols.forEach(c => z[c] = r[c]); s += predictAll(z).mean; }
      out.push({ name, effect: base.mean - s / bg.length });
    }
    return { base, typical: avg, factors: out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)) };
  }
  const PRED = new Array(NE);  // per-encounter model estimates (used for forecast of long waits)
  for (let i = 0; i < NE; i++) {
    PRED[i] = predictAll(makeX({ tri: E.tri[i], dept: E.d[i], vis: E.vis[i], hour: Math.floor(E.min[i] / 60), dow: (new Date(2025, 0, 1 + E.day[i]).getDay() + 6) % 7, age: E.age[i], chr: E.chr[i], qd: E.qd[i], qa: E.qa[i] }));
  }

  // ---------- per-department per-day tables with prefix sums ----------
  let P;  // prefix sums, rebuilt when targets change
  function build() {
    const mk = () => Array.from({ length: ND }, () => new Float64Array(N + 1));
    P = { cnt: mk(), ex: mk(), wait: mk(), svc: mk(), lag: mk(), breach: mk(), over: mk(), lbc: mk(), long: mk(), tgt: mk(), tri: [0, 1, 2, 3].map(() => Array.from({ length: ND }, () => new Float64Array(N + 1))) };
    const day = Array.from({ length: ND }, () => ({}));
    const add = (k, d, dy, v) => { (day[d][k] || (day[d][k] = new Float64Array(N)))[dy] += v; };
    for (let i = 0; i < NE; i++) {
      const d = E.d[i], dy = E.day[i], tg = S.target[E.tri[i]], w = E.wait[i];
      add("cnt", d, dy, 1); add("ex", d, dy, w - D.triMean[E.tri[i]]); add("wait", d, dy, w); add("svc", d, dy, E.svc[i]); add("lag", d, dy, E.lag[i]);
      add("breach", d, dy, w > tg ? 1 : 0); add("over", d, dy, w > tg ? w - tg : 0); add("lbc", d, dy, E.out[i] === 3 ? 1 : 0); add("long", d, dy, w >= 60 ? 1 : 0); add("tgt", d, dy, tg);
    }
    for (let d = 0; d < ND; d++) for (const k of ["cnt", "ex", "wait", "svc", "lag", "breach", "over", "lbc", "long", "tgt"]) {
      const a = day[d][k] || new Float64Array(N); for (let i = 0; i < N; i++) P[k][d][i + 1] = P[k][d][i] + a[i];
    }
    computeZ();
  }
  const sum = (k, d, a, b) => P[k][d][Math.min(N, b)] - P[k][d][Math.max(0, a)];   // days [a,b)
  function win(d, end, len) {                    // stats for days (end-len, end]
    const a = end - len + 1, b = end + 1, n = sum("cnt", d, a, b);
    const r = { n, a, b, ex: n ? sum("ex", d, a, b) / n : 0, wait: n ? sum("wait", d, a, b) / n : 0, svc: n ? sum("svc", d, a, b) / n : 0, lag: n ? sum("lag", d, a, b) / n : 0,
      breach: n ? sum("breach", d, a, b) / n : 0, long: n ? sum("long", d, a, b) / n : 0, lbc: n ? sum("lbc", d, a, b) / n : 0, lbcN: sum("lbc", d, a, b), breachN: sum("breach", d, a, b), over: sum("over", d, a, b), tgt: n ? sum("tgt", d, a, b) / n : 0 };
    r.overshoot = r.breachN ? r.over / r.breachN : 0;
    return r;
  }
  function hosp(end, len) {
    const a = end - len + 1, b = end + 1; let n = 0, w = 0, br = 0, lg = 0, lb = 0, ex = 0;
    for (let d = 0; d < ND; d++) { n += sum("cnt", d, a, b); w += sum("wait", d, a, b); br += sum("breach", d, a, b); lg += sum("long", d, a, b); lb += sum("lbc", d, a, b); ex += sum("ex", d, a, b); }
    return { n, wait: n ? w / n : 0, within: n ? 1 - br / n : 0, long: n ? lg / n : 0, lbc: n ? lb / n : 0, ex: n ? ex / n : 0 };
  }

  // ---------- alert signals: how far is "now" from this department's own normal? ----------
  const SIG = [
    { key: "wait", name: "Waiting longer than usual", unit: "min" },
    { key: "vol", name: "More patients than usual", unit: "visits" },
    { key: "breach", name: "More patients over their wait target", unit: "%" },
    { key: "lbc", name: "More patients leaving before care", unit: "patients" }];
  let Z;
  function signal(d, end) {
    const w = win(d, end, WIN), b = win(d, end - WIN, BASE), out = [];
    const sd = D.triSd;
    // 1) wait vs triage-adjusted normal
    let z = (w.n >= 8 && b.n >= 30) ? (w.ex - b.ex) / (sd * Math.sqrt(1 / w.n + 1 / b.n)) : 0;
    out.push({ z, obs: w.wait, base: w.wait - (w.ex - b.ex), delta: w.ex - b.ex, w, b });
    // 2) volume
    const expN = b.n / BASE * WIN; z = expN > 3 ? (w.n - expN) / Math.sqrt(expN * (1 + WIN / BASE)) : 0;
    out.push({ z, obs: w.n, base: expN, delta: w.n - expN, w, b });
    // 3) share over target (two-proportion z)
    const pp = (w.breachN + b.breachN) / Math.max(1, w.n + b.n);
    z = (w.n >= 8 && b.n >= 30 && pp > 0 && pp < 1) ? (w.breach - b.breach) / Math.sqrt(pp * (1 - pp) * (1 / w.n + 1 / b.n)) : 0;
    out.push({ z, obs: w.breach, base: b.breach, delta: w.breach - b.breach, w, b });
    // 4) walk-outs
    const expL = b.lbcN / BASE * WIN; z = (w.lbcN >= 3 && expL > 0.5) ? (w.lbcN - expL) / Math.sqrt(expL * (1 + WIN / BASE)) : 0;
    out.push({ z, obs: w.lbcN, base: expL, delta: w.lbcN - expL, w, b });
    return out;
  }
  function computeZ() {
    Z = Array.from({ length: ND }, () => new Array(N).fill(null));
    for (let d = 0; d < ND; d++) for (let t = FIRST_DAY; t < N; t++) Z[d][t] = signal(d, t);
  }
  const level = z => z >= S.alert ? 2 : z >= S.watch ? 1 : 0;
  function deptStatus(d, t) {
    const s = Z[d][t]; let m = 0, k = 0; s.forEach((x, i) => { if (x.z > m) { m = x.z; k = i; } });
    return { z: m, lead: k, level: level(m), signals: s };
  }
  function skyline() {         // number of departments on alert/watch on each day (drawn above the date slider)
    const r = []; for (let t = FIRST_DAY; t < N; t++) { let a = 0, w = 0; for (let d = 0; d < ND; d++) { const l = deptStatus(d, t).level; if (l === 2) a++; else if (l === 1) w++; } r.push({ t, a, w }); }
    return r;
  }
  function alertNoise() {      // how often does this threshold fire on the whole year?
    let days = 0, fired = 0, total = 0;
    for (let t = FIRST_DAY; t < N; t++) { days++; let any = 0; for (let d = 0; d < ND; d++) if (deptStatus(d, t).level > 0) { any++; } fired += any > 0 ? 1 : 0; total += any; }
    return { days, fired, perWeek: total / days * 7 };
  }

  // ---------- diagnostic tests ----------
  const TTN = D.testTypes.length;
  const tdays = new Int32Array(T.day), ttat = T.tat;
  function pct(arr, p) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); }
  function testsIn(a, b, tt, pr) { const r = []; for (let i = 0; i < tdays.length; i++) if (tdays[i] >= a && tdays[i] < b && (tt == null || T.tt[i] === tt) && (pr == null || T.pr[i] === pr)) r.push(i); return r; }
  function testStats(end, len, tt, pr) {
    const idx = testsIn(end - len + 1, end + 1, tt, pr), v = idx.map(i => ttat[i]);
    const br = idx.filter(i => ttat[i] > S.sla[T.pr[i]]);
    return { n: idx.length, median: pct(v, .5), p90: pct(v, .9), mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, breach: idx.length ? br.length / idx.length : 0, breachN: br.length, over: br.reduce((s, i) => s + ttat[i] - S.sla[T.pr[i]], 0) };
  }
  function testSignal(tt, end) {
    const w = testStats(end, 28, tt), b = testStats(end - 28, Math.max(28, end - 28), tt);   // everything before the window as the baseline
    const pp = (w.breachN + b.breachN) / Math.max(1, w.n + b.n);
    const z = (w.n >= 15 && b.n >= 30 && pp > 0 && pp < 1) ? (w.breach - b.breach) / Math.sqrt(pp * (1 - pp) * (1 / w.n + 1 / b.n)) : 0;
    return { z, w, b };
  }
  function priorityCheck(end) {    // are urgent tests actually faster? (Welch difference of means)
    const u = testsIn(0, end + 1, null, 0).map(i => ttat[i]), r = testsIn(0, end + 1, null, 1).map(i => ttat[i]);
    const m = a => a.reduce((x, y) => x + y, 0) / a.length, v = a => { const mu = m(a); return a.reduce((x, y) => x + (y - mu) ** 2, 0) / (a.length - 1); };
    const diff = m(r) - m(u), se = Math.sqrt(v(u) / u.length + v(r) / r.length);
    return { urgentMedian: pct(u, .5), routineMedian: pct(r, .5), urgentMean: m(u), routineMean: m(r), diff, lo: diff - 1.96 * se, hi: diff + 1.96 * se, nU: u.length, nR: r.length };
  }

  // ---------- statistics helpers ----------
  const phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

  // ---------- the "look at this first" queue ----------
  function queue(t, all) {
    const items = [];
    const lab = ["Wait times", "Patient volume", "Over-target waits", "Walk-outs"];
    for (let d = 0; d < ND; d++) {
      const dep = D.depts[d], s = Z[d][t]; if (!s) continue;
      const dm = s[0].w.wait || 50;
      s.forEach((x, k) => {
        if (x.z < 1.5) return;
        let impact = 0, headline = "", rows = [], checks = [];
        if (k === 0) {
          impact = x.w.n * Math.max(0, x.delta);
          headline = `Patients wait ${x.delta.toFixed(0)} min longer than usual once triage mix is accounted for`;
          rows = [["Average wait, last 14 days", fm(x.w.wait) + " min", "Same triage mix at normal pace: " + fm(x.base) + " min"], ["Wait above what triage explains", sgn(x.w.ex), "Normal for this department: " + sgn(x.b.ex)]];
          checks = ["Was the department short of staff or beds in this window?", "Did a block of slow cases (long services) hold up the queue?", "Are Low-triage patients being left waiting while higher-triage cases are seen?"];
        } else if (k === 1) {
          impact = Math.max(0, x.delta) * dm;
          headline = `${x.obs.toFixed(0)} visits in 14 days against about ${x.base.toFixed(0)} expected`;
          rows = [["Visits, last 14 days", fm(x.obs), "Expected from the previous 8 weeks: " + fm(x.base)], ["Visits per staff member per day", (x.obs / WIN / dep.staff).toFixed(2), "Staff on record: " + dep.staff]];
          checks = ["Is the surge from one visit type (walk-in, emergency) or spread evenly?", "Can staff be borrowed from a quiet department for the next few days?"];
        } else if (k === 2) {
          impact = Math.max(0, x.delta) * x.w.n * (x.w.overshoot || 15);
          headline = `${(x.obs * 100).toFixed(0)}% of patients waited past their triage target, up from ${(x.base * 100).toFixed(0)}%`;
          rows = [["Over target, last 14 days", (x.obs * 100).toFixed(0) + "%", "Normal for this department: " + (x.base * 100).toFixed(0) + "%"], ["Typical overshoot", fm(x.w.overshoot) + " min", "Across " + x.w.breachN + " patients"]];
          checks = ["Which triage level is slipping past its target most?", "Are the targets in Settings right for this department?"];
        } else {
          impact = Math.max(0, x.delta) * dm;
          headline = `${x.obs.toFixed(0)} patients left before being seen, about ${x.base.toFixed(1)} expected`;
          rows = [["Left before care, last 14 days", fm(x.obs), "Expected: " + x.base.toFixed(1)], ["Share of visits", (x.w.lbc * 100).toFixed(1) + "%", "Normal: " + (x.b.lbc * 100).toFixed(1) + "%"]];
          checks = ["Do these patients cluster at a certain hour, or after a certain wait?", "Could a quick check-in call to waiting patients reduce walk-outs?"];
        }
        items.push({ kind: "dept", dept: d, name: dep.name, what: lab[k], sig: k, z: x.z, impact, conf: phi(x.z), headline, rows, checks, spark: d });
      });
    }
    for (let tt = 0; tt < TTN; tt++) {
      const s = testSignal(tt, t); if (s.z < 1.5) continue;
      const impact = Math.max(0, s.w.breach - s.b.breach) * s.w.n * (s.w.over / Math.max(1, s.w.breachN));
      items.push({ kind: "test", test: tt, name: D.testTypes[tt], what: "Test turnaround", z: s.z, impact, conf: phi(s.z),
        headline: `${(s.w.breach * 100).toFixed(0)}% of ${D.testTypes[tt]} results were slower than the allowed time, up from ${(s.b.breach * 100).toFixed(0)}%`,
        rows: [["Median turnaround, last 28 days", fm(s.w.median) + " min", "Earlier: " + fm(s.b.median) + " min"], ["Slower than allowed", (s.w.breach * 100).toFixed(0) + "%", "Earlier: " + (s.b.breach * 100).toFixed(0) + "%"]],
        checks: ["Is one shift or one machine behind the slow results?", "Are urgent requests queueing behind routine ones?"] });
    }
    items.forEach(i => i.score = i.impact * i.conf);
    items.sort((a, b) => b.score - a.score); return all ? items : items.slice(0, 10);
  }

  // ---------- forecast ----------
  function hospDaily(a, b) { const r = []; for (let t = a; t < b; t++) { let c = 0; for (let d = 0; d < ND; d++) c += sum("cnt", d, t, t + 1); r.push(c); } return r; }
  function forecast(t, H = 14) {
    const hist = hospDaily(0, t + 1), m = hist.slice(-BASE).reduce((a, b) => a + b, 0) / BASE;
    const res = [];
    for (let o = 70; o + H <= t + 1; o += 7) { const mu = hist.slice(o - BASE, o).reduce((a, b) => a + b, 0) / BASE; for (let j = 0; j < H; j++) res.push(hist[o + j] - mu); }
    const q10 = res.length > 30 ? pct(res, .1) : -1.28 * Math.sqrt(m), q90 = res.length > 30 ? pct(res, .9) : 1.28 * Math.sqrt(m);
    const depts = [];
    for (let d = 0; d < ND; d++) {
      const lam = sum("cnt", d, t - BASE + 1, t + 1) / BASE, prev = sum("cnt", d, t - WIN + 1, t + 1) / WIN;
      const idx = []; for (let i = 0; i < NE; i++) if (E.d[i] === d && E.day[i] > t - BASE && E.day[i] <= t) idx.push(i);
      const pl = idx.length ? idx.reduce((s, i) => s + PRED[i].pLong, 0) / idx.length : 0, mw = idx.length ? idx.reduce((s, i) => s + PRED[i].mean, 0) / idx.length : 0;
      depts.push({ d, name: D.depts[d].name, lam, visits: lam * H, expLong: lam * H * pl, pLong: pl, wait: mw, perStaff: lam / D.depts[d].staff, trend: prev / Math.max(lam, 0.01) - 1 });
    }
    return { hist, mean: m, q10, q90, depts: depts.sort((a, b) => b.expLong - a.expLong), H };
  }

  // ---------- longest waits ("forgotten patients") ----------
  function longestWaits(t, days = 3, n = 8) {
    const r = [];
    for (let i = 0; i < NE; i++) if (E.day[i] > t - days && E.day[i] <= t) { const tg = S.target[E.tri[i]]; r.push({ i, over: E.wait[i] - tg, ratio: E.wait[i] / tg }); }
    return r.sort((a, b) => b.ratio - a.ratio).slice(0, n).map(o => ({ id: E.id[o.i], dept: D.depts[E.d[o.i]].name, tri: D.tri[E.tri[o.i]], wait: E.wait[o.i], target: S.target[E.tri[o.i]], hour: E.min[o.i], day: E.day[o.i], out: D.outcomes[E.out[o.i]] }));
  }

  const fm = v => (Math.round(v * 10) / 10).toString().replace(/\.0$/, "");
  const sgn = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + " min";

  window.Engine = { D, S, DEFAULTS, saveSettings, build, WIN, BASE, FIRST_DAY, N, ND, win, hosp, deptStatus, skyline, alertNoise, SIG, testStats, testSignal, priorityCheck, queue, forecast, longestWaits, predictAll, makeX, explainPrediction, evalTrees, sum, pct, phi, fm, sgn, level };
  build();
})();
