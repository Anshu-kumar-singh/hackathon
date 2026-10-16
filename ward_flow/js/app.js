/* Ward Flow - pages and interaction. Everything renders from Engine (js/engine.js). */
(function () {
  const E = window.Engine, D = E.D, S = E.S, C = window.Charts, esc = C.esc, fm = E.fm;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dt = t => new Date(2025, 0, 1 + t);
  const dShort = t => { const d = dt(t); return d.getDate() + " " + MON[d.getMonth()]; };
  const dLong = t => { const d = dt(t); return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); };
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const pc = (v, d = 0) => (v * 100).toFixed(d) + "%";
  const signed = (v, d = 1, u = "") => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + u;
  const LEAD = ["waiting longer than usual", "busier than usual", "more patients past their wait target", "more patients leaving before care"];
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const st = { view: "now", t: E.N - 1, playing: null };
  const ICON = {
    now: '<path d="M3 12h4l2-6 4 12 2-6h6"/>', alerts: '<path d="M12 3 2.5 20h19L12 3zM12 10v5M12 17.5v.5"/>', first: '<path d="M4 6h16M4 12h11M4 18h6"/>',
    forecast: '<path d="M3 17l5-6 4 3 5-8 4 4M3 21h18"/>', tests: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>', predict: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    model: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>', targets: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>'
  };
  const NAV = [["now", "Today's board"], ["alerts", "Alerts"], ["first", "Look at first"], ["forecast", "Forecast"], ["tests", "Test turnaround"], ["predict", "Predict a wait"], ["model", "Model and data"], ["targets", "Targets"]];

  /* ---------- shell ---------- */
  function shell() {
    $("#app").innerHTML = `
    <div class="shell">
      <aside class="rail">
        <div class="brand"><svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="9" fill="#fff"/><path d="M5 18h6l3-8 5 15 3-9 2 2h5" fill="none" stroke="#0A7C86" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>Ward Flow</b><span>Hospital patient flow</span></div></div>
        <nav class="nav" aria-label="Pages">${NAV.map(([k, l]) => `<button data-nav="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>${l}<span class="badge" id="b-${k}" hidden></span></button>`).join("")}</nav>
        <div class="foot"><b>Synthetic data.</b> Built on 8,000 simulated visits from 2025. Not for clinical decisions.</div>
      </aside>
      <div class="main">
        <header class="topbar"><div class="row">
          <button class="play" id="play" aria-label="Replay the year" data-tip="Replay the year day by day"><svg width="14" height="14" viewBox="0 0 14 14"><path id="playicon" d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg></button>
          <div class="asof" aria-live="polite"><span id="asof"></span><small>Looking back 14 days</small></div>
          <div class="timeline"><div id="sky" style="padding:0 8px"></div><input type="range" id="day" aria-label="Choose the date to look at" min="${E.FIRST_DAY}" max="${E.N - 1}" value="${st.t}"><div class="months">${MON.slice(2).map(m => `<span>${m}</span>`).join("")}</div></div>
          <span class="hint">Red and amber bars mark days with alerts</span>
        </div></header>
        <main class="content" id="view" tabindex="-1"></main>
      </div>
    </div>
    <div class="scrim" id="scrim"></div><aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="Why this appears"></aside><div id="tip" role="tooltip"></div>`;
    $$("[data-nav]").forEach(b => b.addEventListener("click", () => go(b.dataset.nav)));
    $("#day").addEventListener("input", e => { st.t = +e.target.value; render(); });
    $("#play").addEventListener("click", togglePlay);
    $("#scrim").addEventListener("click", closeWhy);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeWhy(); });
    // tooltip
    const tip = $("#tip");
    document.addEventListener("mouseover", e => { const el = e.target.closest("[data-tip]"); if (!el) { tip.style.opacity = 0; return; } tip.innerHTML = el.dataset.tip; tip.style.opacity = 1; });
    document.addEventListener("mousemove", e => { if (tip.style.opacity === "0") return; const w = tip.offsetWidth; tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + "px"; tip.style.top = (e.clientY + 16) + "px"; });
    document.addEventListener("focusin", e => { const el = e.target.closest("[data-tip]"); if (el) { const r = el.getBoundingClientRect(); tip.innerHTML = el.dataset.tip; tip.style.opacity = 1; tip.style.left = r.left + "px"; tip.style.top = r.bottom + 6 + "px"; } });
    document.addEventListener("focusout", () => { tip.style.opacity = 0; });
  }
  function go(v) { st.view = v; history.replaceState(null, "", "#/" + v); render(); $("#view").scrollIntoView({ block: "start" }); window.scrollTo(0, 0); }
  function togglePlay() {
    if (st.playing) { clearInterval(st.playing); st.playing = null; $("#playicon").setAttribute("d", "M3 1.5v11l9-5.5z"); return; }
    if (st.t >= E.N - 1) st.t = E.FIRST_DAY;
    $("#playicon").setAttribute("d", "M2.5 1.5h3.2v11H2.5zM8.3 1.5h3.2v11H8.3z");
    st.playing = setInterval(() => { if (st.t >= E.N - 1) { togglePlay(); return; } st.t++; render(); }, 220);
  }
  function skyline() {
    const sk = E.skyline(), W = sk.length, H = 30, mx = Math.max(3, ...sk.map(s => s.a + s.w));
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`;
    sk.forEach((d, i) => { const n = d.a + d.w, h = n ? Math.max(3, H * n / mx) : 1.5; s += `<rect x="${i}" width="1.05" y="${H - h}" height="${h}" class="${d.a ? "sky-a" : d.w ? "sky-w" : "sky-n"}"/>`; });
    $("#sky").innerHTML = s + "</svg>";
  }

  /* ---------- drawer: "why is this here?" ---------- */
  function openWhy(it) {
    const t = st.t, dr = $("#drawer");
    const isDept = it.kind === "dept", st_ = isDept ? E.deptStatus(it.dept, t) : null;
    const lvl = it.z >= S.alert ? 2 : it.z >= S.watch ? 1 : 0;
    const chance = Math.max(1, Math.round((1 - it.conf) * 1000));
    let h = `<button class="btn ghost x" id="closeWhy">Close</button><span class="tag l${lvl}">${["Within normal range", "Keep an eye on this", "Needs attention"][lvl]}</span>
      <h2>${esc(it.name)}: ${esc(it.what.toLowerCase())}</h2><p class="why">${esc(it.headline)}.</p>
      <h3>What the data shows</h3>${it.rows.map(r => `<div class="kv"><span>${esc(r[0])}</span><b>${esc(r[1])}</b><span class="s">${esc(r[2])}</span></div>`).join("")}`;
    if (isDept) {
      const ex = []; for (let d = t - 59; d <= t; d++) ex.push(E.win(it.dept, d, 14).wait);
      h += `<h3>Average wait over the last 60 days</h3>${C.spark(ex, { w: 440, h: 56, aria: "Average wait trend" })}<p class="why" style="font-size:13px">Each point is the average wait over the 14 days up to that date.</p>
      <h3>All four signals for this department</h3>${st_.signals.map((x, k) => `<div class="zrow ${k === it.sig ? "lead" : ""}"><span>${E.SIG[k].name}</span><div class="track"><div class="f ${x.z >= S.watch ? "over" : ""}" style="width:${Math.min(100, Math.max(0, x.z) / 5 * 100)}%"></div><div class="tk" style="left:${S.watch / 5 * 100}%" data-tip="Watch level"></div></div><span>${x.z.toFixed(1)}</span></div>`).join("")}
      <p class="why" style="font-size:12.5px">Bars show how far from normal each signal is. The black mark is the watch level.</p>`;
      const pts = E.longestWaits(t, 14, 400).filter(x => x.dept === it.name).slice(0, 5);
      if (pts.length) h += `<h3>Longest waits here, last 14 days</h3><table><tbody>${pts.map(p => `<tr><td>${p.id}</td><td><span class="tag ${p.tri}">${p.tri}</span></td><td class="r"><b>${p.wait} min</b> <span class="why">(target ${p.target})</span></td></tr>`).join("")}</tbody></table>`;
    }
    h += `<h3>How sure are we?</h3><p>About ${chance} in 1,000 chance this is ordinary ups and downs. Signal strength: ${it.z.toFixed(1)} standard deviations from normal.</p>
      <h3>What it would cost</h3><p>Roughly ${Math.round(it.impact).toLocaleString()} extra patient-minutes of waiting. Priority score ${Math.round(it.score || it.impact * it.conf).toLocaleString()} (cost × certainty).</p>
      <h3>What to look at first</h3><ul>${it.checks.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
      <p class="note">"Normal" means this department's own previous 8 weeks, adjusted for how many urgent patients arrived. Wait targets are assumptions you can change under Targets. The data is simulated, so treat flagged items as prompts to check, not as proof.</p>`;
    dr.innerHTML = h; dr.classList.add("on"); $("#scrim").classList.add("on"); $("#closeWhy").addEventListener("click", closeWhy); $("#closeWhy").focus();
  }
  function closeWhy() { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); }
  const whyBind = () => $$("[data-why]").forEach(b => b.addEventListener("click", () => { const [d, k] = b.dataset.why.split("-").map(Number); const it = E.queue(st.t, true).find(x => x.kind === "dept" && x.dept === d && x.sig === k); if (it) openWhy(it); else openWhyBlank(d); }));
  function openWhyBlank(d) { openWhy({ kind: "dept", dept: d, sig: 0, name: D.depts[d].name, what: "Within normal range", z: 0, conf: .5, impact: 0, headline: "Nothing here is outside its normal range on this date", rows: [], checks: ["Nothing needs checking. Drag the date to a day with an alert to see how the explanation reads."] }); }

  /* ---------- views ---------- */
  function viewNow() {
    const t = st.t, H = E.hosp(t, 14), B = E.hosp(t - 14, 56), expN = B.n / 56 * 14;
    const rows = D.depts.map((dep, i) => ({ i, dep, w: E.win(i, t, 14), s: E.deptStatus(i, t) })).sort((a, b) => b.s.z - a.s.z);
    const al = rows.filter(r => r.s.level === 2), wa = rows.filter(r => r.s.level === 1);
    let lede, cls;
    if (al.length) { cls = "alert"; lede = al.length === 1 ? `${al[0].dep.name} needs attention: ${LEAD[al[0].s.lead]}` : `${al.length} departments need attention, led by ${al[0].dep.name}`; }
    else if (wa.length) { cls = "watch"; lede = wa.length === 1 ? `${wa[0].dep.name} is worth watching: ${LEAD[wa[0].s.lead]}` : `${wa.length} departments are worth watching, led by ${wa[0].dep.name}`; }
    else { cls = "ok"; lede = "Every department is within its normal range"; }
    const mx = Math.max(...rows.map(r => r.w.wait + r.w.svc + r.w.lag));
    const dl = (a, b, u, d = 1) => `<span>${signed(a - b, d, u)} vs normal</span>`;
    // weekly heat
    const wk = [], last = t; for (let k = 11; k >= 0; k--) wk.push(last - 7 * k);
    const heatRows = D.depts.map((dep, i) => { const norm = E.win(i, t, t + 1).ex; return { dep, cells: wk.map(e => { const w = E.win(i, e, 7); return { v: w.n ? w.ex - norm : null, n: w.n, wait: w.wait, e }; }) }; });
    const cell = c => { if (c.v == null) return `<div class="c" style="background:var(--panel-2)"></div>`; const p = Math.min(100, Math.abs(c.v) / 14 * 100); return `<div class="c" style="background:color-mix(in srgb, var(${c.v > 0 ? "--warm" : "--cool"}) ${p}%, var(--neutral))" data-tip="<b>Week ending ${dShort(c.e)}</b><br>${c.n} visits, average wait ${fm(c.wait)} min<br>${signed(c.v, 1, " min")} against this department's norm"></div>`; };
    // triage
    const tri = [0, 1, 2, 3].map(k => { let n = 0, w = 0; for (let i = 0; i < D.meta.n_enc; i++) if (D.enc.tri[i] === k && D.enc.day[i] > t - 14 && D.enc.day[i] <= t) { n++; w += D.enc.wait[i]; } return { k, n, w: n ? w / n : 0 }; });
    const lw = E.longestWaits(t, 3, 6);
    return `
    <h1 class="lede ${cls}">${esc(lede)}</h1>
    <p class="sub">The 14 days up to ${dLong(t)}, compared with the 8 weeks before. Select a department to see why it is flagged.</p>
    <div class="ledger">
      <div><div class="v">${H.n}</div><div class="k">Visits</div><div class="d">${dl(H.n, expN, "", 0)}</div></div>
      <div><div class="v">${fm(H.wait)}<small>min</small></div><div class="k">Average wait</div><div class="d">${dl(H.wait, B.wait, " min")}</div></div>
      <div><div class="v">${pc(H.within)}</div><div class="k">Seen within their target</div><div class="d">${dl(H.within * 100, B.within * 100, " pts", 1)}</div></div>
      <div><div class="v">${pc(H.long)}</div><div class="k">Waited an hour or more</div><div class="d">${dl(H.long * 100, B.long * 100, " pts", 1)}</div></div>
      <div><div class="v">${pc(H.lbc, 1)}</div><div class="k">Left before being seen</div><div class="d">${dl(H.lbc * 100, B.lbc * 100, " pts", 1)}</div></div>
    </div>
    <section class="panel"><h2>Where patients spend their time</h2><p class="cap">Average minutes per visit, split into waiting, being seen and the time between care ending and discharge. The black mark is the wait target for that department's mix of patients.</p>
      <div class="legend"><span><i style="background:var(--stage-wait)"></i>Waiting to be seen</span><span><i style="background:var(--stage-service)"></i>Being seen</span><span><i style="background:var(--stage-after)"></i>Waiting for discharge</span></div>
      <div class="board">${rows.map(r => { const w = r.w, sc = 100 / mx; return `<button class="deptrow" data-why="${r.i}-${r.s.lead}" aria-label="${esc(r.dep.name)}: open explanation">
        <div class="nm"><span class="dot l${r.s.level}"></span><div><b>${esc(r.dep.name)}</b><small>${r.dep.staff} staff, ${r.dep.beds} beds</small></div></div>
        <div class="strip" data-tip="<b>${esc(r.dep.name)}</b><br>Waiting ${fm(w.wait)} min<br>Being seen ${fm(w.svc)} min<br>Waiting for discharge ${fm(w.lag)} min<br>Wait target about ${fm(w.tgt)} min"><span class="w" style="width:${w.wait * sc}%"></span><span class="s" style="width:${w.svc * sc}%"></span><span class="a" style="width:${w.lag * sc}%"></span><i class="tick" style="left:${w.tgt * sc}%"></i></div>
        <div class="nums"><b>${fm(w.wait)} min wait</b><br><span class="st l${r.s.level}">${r.s.level ? LEAD[r.s.lead] : "Normal range"}</span></div></button>`; }).join("")}</div></section>
    <div class="grid2">
      <section class="panel"><h2>Waits by urgency</h2><p class="cap">Average wait over 14 days against the target for each triage level.</p><div class="bars">${tri.map(r => { const tg = S.target[r.k], mxw = 110; return `<div class="bar-row"><span class="tag ${D.tri[r.k]}" style="justify-self:start">${D.tri[r.k]}</span><div class="track"><div class="f ${r.w > tg ? "over" : ""}" style="width:${Math.min(100, r.w / mxw * 100)}%"></div><div class="tk" style="left:${tg / mxw * 100}%" data-tip="Target ${tg} min"></div></div><span class="n"><b>${fm(r.w)}</b> of ${tg} min</span></div>`; }).join("")}</div></section>
      <section class="panel"><h2>Longest waits against target</h2><p class="cap">Patients from the last 3 days who waited furthest past their target.</p>
        ${lw.length ? `<table><thead><tr><th>Visit</th><th>Department</th><th class="r">Waited</th></tr></thead><tbody>${lw.map(p => `<tr><td>${p.id}<br><span class="tag ${p.tri}">${p.tri}</span></td><td>${esc(p.dept)}<br><span class="why" style="color:var(--muted);font-size:12.5px">${dShort(p.day)}, ${hhmm(p.hour)}</span></td><td class="r"><b>${p.wait} min</b><br><span style="color:var(--muted);font-size:12.5px">target ${p.target}</span></td></tr>`).join("")}</tbody></table>` : `<div class="empty"><b>No visits in the last 3 days</b>Pick a later date.</div>`}</section>
    </div>
    <section class="panel" style="margin-top:18px"><h2>Week by week</h2><p class="cap">Each square is one week of one department. Orange means waits ran longer than that department usually sees, blue means shorter. Triage mix is accounted for.</p>
      <div class="heat"><span></span>${wk.map((e, i) => `<span class="hd">${i % 2 === 0 ? dShort(e) : ""}</span>`).join("")}${heatRows.map(r => `<span class="rn">${esc(r.dep.name)}</span>${r.cells.map(cell).join("")}`).join("")}</div>
      <div class="scale"><span>Shorter than usual</span><span class="bar"></span><span>Longer than usual</span></div></section>`;
  }

  function viewAlerts() {
    const t = st.t, noise = E.alertNoise(), items = E.queue(t, true);
    const rows = D.depts.map((dep, i) => ({ i, dep, s: E.deptStatus(i, t) })).filter(r => r.s.level).sort((a, b) => b.s.z - a.s.z);
    const W = 880, L = 126, cw = (W - L - 8) / (E.N - E.FIRST_DAY);
    let hist = `<svg class="chart" viewBox="0 0 ${W} ${D.depts.length * 17 + 24}" role="img" aria-label="Alert history by department">`;
    D.depts.forEach((dep, i) => { hist += `<text x="${L - 8}" y="${i * 17 + 12}" text-anchor="end">${esc(dep.name)}</text>`; for (let d = E.FIRST_DAY; d < E.N; d++) { const s = E.deptStatus(i, d), x = L + (d - E.FIRST_DAY) * cw; hist += `<rect x="${x.toFixed(1)}" y="${i * 17}" width="${(cw + .25).toFixed(2)}" height="14" rx="1" fill="${s.level === 2 ? "var(--alert)" : s.level === 1 ? "var(--watch)" : "var(--line-soft)"}" ${s.level ? `data-tip="<b>${esc(dep.name)}, ${dShort(d)}</b><br>${esc(E.SIG[s.lead].name)}<br>Signal strength ${s.z.toFixed(1)}"` : ""}/>`; } });
    hist += `<line x1="${L + (t - E.FIRST_DAY) * cw}" x2="${L + (t - E.FIRST_DAY) * cw}" y1="-2" y2="${D.depts.length * 17}" stroke="var(--ink)" stroke-width="2"/>`;
    [2, 4, 6, 8, 10].forEach(m => { const d = Math.round((new Date(2025, m, 1) - new Date(2025, 0, 1)) / 864e5); if (d > E.FIRST_DAY) hist += `<text x="${L + (d - E.FIRST_DAY) * cw}" y="${D.depts.length * 17 + 16}" text-anchor="middle">${MON[m]}</text>`; });
    hist += "</svg>";
    return `<h1 class="page-title">Alerts</h1><p class="sub tight">A department is flagged when it drifts away from its own normal for the previous 8 weeks. Four signals are checked: wait times, patient volume, share of patients past their wait target, and patients leaving before care.</p>
    <section class="panel"><div class="controls">
      <label class="field">Watch from <span class="val" id="wv">${S.watch.toFixed(1)}</span><input type="range" id="watch" min="1.5" max="4" step="0.1" value="${S.watch}"></label>
      <label class="field">Alert from <span class="val" id="av">${S.alert.toFixed(1)}</span><input type="range" id="alertT" min="2" max="5" step="0.1" value="${S.alert}"></label>
      <p class="cap" style="margin:0;flex:1;min-width:240px">Higher values mean fewer, stronger alerts. At these settings, some department would have been flagged on <b>${noise.fired} of ${noise.days}</b> days this year, about <b>${noise.perWeek.toFixed(1)}</b> department-days a week.</p></div></section>
    <section class="panel"><h2>${rows.length ? `${rows.length} flagged on ${dLong(t)}` : `Nothing flagged on ${dLong(t)}`}</h2><p class="cap">Strongest first. Open one to see which numbers triggered it and what to check.</p>
      ${rows.length ? rows.map(r => { const w = E.win(r.i, t, 14), ex = []; for (let d = t - 59; d <= t; d++) ex.push(E.win(r.i, d, 14).wait);
        return `<div class="alert-card"><div><h3>${esc(r.dep.name)} <span class="tag l${r.s.level}">${r.s.level === 2 ? "Needs attention" : "Keep an eye on this"}</span></h3><p>${esc(E.SIG[r.s.lead].name)}. Average wait ${fm(w.wait)} min over ${w.n} visits.</p></div><div>${C.spark(ex, { w: 190, h: 38, aria: "Average wait over 60 days", color: r.s.level === 2 ? "var(--alert)" : "var(--watch)" })}</div><button class="btn" data-why="${r.i}-${r.s.lead}">Why this fired</button></div>`; }).join("")
        : `<div class="empty"><b>Every department is inside its normal range</b>Drag the date bar to a day with a red or amber bar, or press play to replay the year.</div>`}</section>
    <section class="panel"><h2>Alert history</h2><p class="cap">Each row is a department, each column a day from March to December. The black line marks the date you are looking at.</p>${hist}
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--alert)"></i>Needs attention</span><span><i style="background:var(--watch)"></i>Keep an eye on this</span><span><i style="background:var(--line-soft)"></i>Normal</span></div>
      <p class="note">Because the simulated data has no built-in incidents, flagged periods mostly show how much ordinary variation looks like a problem in small departments (about 2 visits a day each). That is why the thresholds are adjustable.</p></section>`;
  }

  function viewFirst() {
    const t = st.t, q = E.queue(t);
    const pts = q.map((it, i) => ({ x: it.conf * 100, y: it.impact, label: i + 1, color: it.kind === "dept" ? "var(--accent)" : "var(--stage-wait)", tip: `<b>${i + 1}. ${esc(it.name)}: ${esc(it.what.toLowerCase())}</b><br>${Math.round(it.impact).toLocaleString()} patient-minutes at stake<br>${pc(it.conf, 1)} sure it is real` }));
    return `<h1 class="page-title">What to look at first</h1><p class="sub tight">Everything unusual on ${dLong(t)}, ranked by how much waiting is at stake and how sure we are it is real. Cost times certainty sets the order.</p>
    ${q.length ? `<section class="panel"><table><thead><tr><th>#</th><th>Where</th><th>What changed</th><th class="r">Sure it is real</th><th class="r">Patient-minutes at stake</th><th></th></tr></thead><tbody>${q.map((it, i) => `<tr class="click" data-q="${i}"><td><b>${i + 1}</b></td><td><b>${esc(it.name)}</b><br><span style="color:var(--muted);font-size:12.5px">${it.kind === "dept" ? "Department" : "Diagnostic test"}</span></td><td>${esc(it.what)}<br><span style="color:var(--muted);font-size:12.5px">${esc(it.headline)}</span></td><td class="r"><b>${pc(it.conf)}</b></td><td class="r"><b>${Math.round(it.impact).toLocaleString()}</b></td><td><button class="btn ghost" data-q="${i}">Why</button></td></tr>`).join("")}</tbody></table></section>
    <section class="panel"><h2>Cost against certainty</h2><p class="cap">Items further up cost more waiting. Items further right are less likely to be chance. Aim for the top right first.</p>
      <div class="legend"><span><i style="background:var(--accent);border-radius:50%"></i>Department</span><span><i style="background:var(--stage-wait);border-radius:50%"></i>Diagnostic test</span></div>
      ${C.scatter({ pts, xMin: Math.floor(Math.min(...pts.map(p => p.x)) - 1), xMax: 100, xTicks: [90, 92, 94, 96, 98, 100].filter(v => v >= Math.min(...pts.map(p => p.x)) - 2), fmtX: v => v + "%", fmtY: v => Math.round(v).toLocaleString(), xTitle: "How sure we are it is real", yTitle: "Patient-minutes at stake", aria: "Priority chart" })}</section>`
      : `<div class="empty"><b>Nothing stands out on this date</b>No department or test is far enough from normal to be worth a look. Drag the date bar or press play to find busier days.</div>`}`;
  }

  function viewForecast() {
    const t = st.t, f = E.forecast(t), H = 14, past = 42, labels = [], lo = [], hi = [], act = [], exp = [];
    for (let k = -past + 1; k <= H; k++) { labels.push(dShort(t + k)); if (k <= 0) { act.push(f.hist[f.hist.length - 1 + k]); exp.push(null); lo.push(null); hi.push(null); } else { act.push(null); exp.push(+f.mean.toFixed(1)); lo.push(Math.max(0, f.mean + f.q10)); hi.push(f.mean + f.q90); } }
    exp[past - 1] = act[past - 1];
    const bt = D.metrics.forecast_backtest, best = Object.entries(bt).sort((a, b) => a[1] - b[1])[0];
    const tot = f.depts.reduce((s, d) => s + d.visits, 0), totL = f.depts.reduce((s, d) => s + d.expLong, 0);
    return `<h1 class="page-title">Forecast</h1><p class="sub tight">What the next 14 days after ${dLong(t)} are likely to bring: about <b>${Math.round(tot)} visits</b>, of which roughly <b>${Math.round(totL)}</b> will wait an hour or more unless something changes.</p>
    <section class="panel"><h2>Visits per day</h2><p class="cap">Actual visits for the last 6 weeks, then the expected level with a likely range (the middle 80% of past misses).</p>
      <div class="legend"><span><i style="background:var(--accent)"></i>Actual</span><span><i style="background:var(--accent);opacity:.3"></i>Likely range</span></div>
      ${C.line({ labels, series: [{ name: "Actual visits", vals: act, color: "var(--accent)" }, { name: "Expected visits", vals: exp, color: "var(--accent)", dash: "5 4" }], band: { lo, hi, from: past }, split: past, splitLabel: "Forecast", yMin: 0, xEvery: 7, tipFmt: v => fm(v), aria: "Daily visits with forecast" })}</section>
    <section class="panel"><h2>Which departments will feel it</h2><p class="cap">Expected visits over the next 14 days, how likely each visit is to wait an hour or more (from the model), and how many people that adds up to. Sorted by expected long waits.</p>
      <table><thead><tr><th>Department</th><th class="r">Expected visits</th><th class="r">Typical wait</th><th class="r">Chance of 1h+ wait</th><th class="r">Expected 1h+ waits</th><th class="r">Visits per staff, per day</th><th class="r">Vs last 2 weeks</th></tr></thead><tbody>${f.depts.map(d => `<tr><td><b>${esc(d.name)}</b></td><td class="r">${Math.round(d.visits)}</td><td class="r">${fm(d.wait)} min</td><td class="r">${pc(d.pLong)}</td><td class="r"><b>${fm(d.expLong)}</b></td><td class="r">${d.perStaff.toFixed(2)}</td><td class="r">${d.trend >= 0.15 ? `<span class="tag l1">${signed(d.trend * 100, 0, "%")}</span>` : signed(d.trend * 100, 0, "%")}</td></tr>`).join("")}</tbody></table>
      <p class="note">These are averages of recent weeks. The data shows no strong pattern by weekday or hour, so a plain average was as good as anything fancier.</p></section>
    <section class="panel"><h2>How we picked the forecasting method</h2><p class="cap">We tested each method on past data: forecast 14 days ahead, compare with what really happened, repeat every week from May. Lower is better.</p>
      <table style="max-width:560px"><thead><tr><th>Method</th><th class="r">Average miss (visits per day)</th></tr></thead><tbody>${Object.entries(bt).map(([k, v]) => `<tr><td>${k === best[0] ? "<b>" + k + " (used here)</b>" : k}</td><td class="r">${v.toFixed(2)}</td></tr>`).join("")}</tbody></table></section>`;
  }

  function sparkWeeks(tt, t) { const v = []; for (let k = 11; k >= 0; k--) { const s = E.testStats(t - 7 * k, 14, tt); if (s.n) v.push(s.median); } return v; }
  function viewTests() {
    const t = st.t, TT = D.testTypes, P = E.priorityCheck(t);
    const bins = [], u = [], r = []; const nb = 13;
    for (let b = 0; b < nb; b++) { bins.push(b * 15); u.push(0); r.push(0); }
    let nu = 0, nr = 0; for (let i = 0; i < D.tests.tat.length; i++) if (D.tests.day[i] <= t) { const b = Math.min(nb - 1, Math.floor(D.tests.tat[i] / 15)); if (D.tests.pr[i] === 0) { u[b]++; nu++; } else { r[b]++; nr++; } }
    const rowsT = TT.map((n, k) => ({ k, n, s: E.testStats(t, 28, k), z: E.testSignal(k, t).z }));
    const same = P.lo < 0 && P.hi > 0;
    return `<h1 class="page-title">Test turnaround</h1><p class="sub tight">How long from request to result for ${D.meta.n_tests.toLocaleString()} diagnostic tests, over the 28 days up to ${dLong(t)}. A result is "slow" when it takes longer than ${S.sla[0]} min (urgent) or ${S.sla[1]} min (routine). Change these under Targets.</p>
    <section class="panel"><table><thead><tr><th>Test</th><th class="r">Tests</th><th class="r">Median</th><th class="r">Slowest 1 in 10</th><th class="r">Slow results</th><th style="width:190px">Median, last 12 weeks</th><th></th></tr></thead><tbody>${rowsT.map(r => `<tr><td><b>${r.n}</b></td><td class="r">${r.s.n}</td><td class="r">${fm(r.s.median)} min</td><td class="r">${fm(r.s.p90)} min</td><td class="r"><b>${pc(r.s.breach)}</b></td><td>${C.spark(sparkWeeks(r.k, t), { w: 180, h: 32, aria: r.n + " weekly median" })}</td><td>${r.z >= S.watch ? `<span class="tag l${r.z >= S.alert ? 2 : 1}">${r.z >= S.alert ? "Needs attention" : "Keep an eye on this"}</span>` : ""}</td></tr>`).join("")}</tbody></table></section>
    <section class="panel"><h2>${same ? "Urgent tests are not coming back any faster than routine ones" : P.diff > 0 ? "Urgent tests come back faster than routine ones" : "Urgent tests are slower than routine ones"}</h2>
      <p class="cap">Up to ${dShort(t)}: urgent tests took a median of <b>${fm(P.urgentMedian)} min</b> (${P.nU.toLocaleString()} tests), routine tests <b>${fm(P.routineMedian)} min</b> (${P.nR.toLocaleString()} tests). Routine minus urgent, on average: ${signed(P.diff, 1, " min")} (95% range ${signed(P.lo, 1)} to ${signed(P.hi, 1)}). ${same ? "That range includes zero, so the data gives no sign that priority changes the queue." : ""}</p>
      <div class="legend"><span><i style="background:var(--accent)"></i>Urgent</span><span><i style="background:var(--stage-wait)"></i>Routine</span></div>
      ${C.line({ labels: bins.map((b, i) => i === nb - 1 ? b + "+" : b + "–" + (b + 15)), series: [{ name: "Urgent", vals: u.map(v => +(v / nu * 100).toFixed(1)), color: "var(--accent)" }, { name: "Routine", vals: r.map(v => +(v / nr * 100).toFixed(1)), color: "var(--stage-wait)" }], xEvery: 2, yMin: 0, fmt: v => v + "%", tipFmt: v => v + "% of tests", h: 280, w: 1000, aria: "Turnaround distribution by priority" })}
      <p class="cap" style="margin:6px 0 0">Share of tests by turnaround time in minutes.</p></section>
    <p class="note">Test request times in this dataset do not line up with the visit they belong to (see Model and data), so tests are monitored on their own and not tied to a patient's journey.</p>`;
  }

  /* predictor */
  const PV = { tri: 2, dept: 0, vis: 1, hour: 14, dow: 1, age: 45, chr: 0 };
  function viewPredict() {
    return `<h1 class="page-title">Predict a wait</h1><p class="sub tight">Describe an arriving patient and the model estimates how long they will wait, based on the 8,000 past visits. It uses only what is known at the front desk.</p>
    <div class="pred"><section class="panel"><h2>The patient</h2><p class="cap">Pick a quick example, or set your own.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn ghost" data-preset="0">Critical, Emergency</button><button class="btn ghost" data-preset="1">Medium, Cardiology</button><button class="btn ghost" data-preset="2">Low, Pediatrics</button></div>
      <div class="form">
        <label class="field">Urgency (triage)<select id="p-tri">${D.tri.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select></label>
        <label class="field">Visit type<select id="p-vis">${D.vis.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select></label>
        <label class="field full">Department<select id="p-dept">${D.depts.map((n, i) => `<option value="${i}">${n.name}</option>`).join("")}</select></label>
        <label class="field">Day<select id="p-dow">${WEEKDAYS.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select></label>
        <label class="field">Hour of arrival<input type="number" id="p-hour" min="0" max="23"></label>
        <label class="field">Age<input type="number" id="p-age" min="0" max="110"></label>
        <label class="field">Chronic condition<select id="p-chr"><option value="0">None recorded</option><option value="1">Has one</option></select></label>
      </div></section><div id="predout"></div></div>`;
  }
  function bindPredict() {
    const set = () => { $("#p-tri").value = PV.tri; $("#p-vis").value = PV.vis; $("#p-dept").value = PV.dept; $("#p-dow").value = PV.dow; $("#p-hour").value = PV.hour; $("#p-age").value = PV.age; $("#p-chr").value = PV.chr; };
    set();
    const read = () => { PV.tri = +$("#p-tri").value; PV.vis = +$("#p-vis").value; PV.dept = +$("#p-dept").value; PV.dow = +$("#p-dow").value; PV.hour = Math.min(23, Math.max(0, +$("#p-hour").value || 0)); PV.age = Math.min(110, Math.max(0, +$("#p-age").value || 0)); PV.chr = +$("#p-chr").value; out(); };
    $$(".pred select,.pred input").forEach(el => el.addEventListener("input", read));
    const presets = [{ tri: 0, dept: 0, vis: 0 }, { tri: 2, dept: 3, vis: 2 }, { tri: 3, dept: 2, vis: 1 }];
    $$("[data-preset]").forEach(b => b.addEventListener("click", () => { Object.assign(PV, presets[+b.dataset.preset]); set(); out(); }));
    function out() {
      const x = E.makeX({ tri: PV.tri, dept: PV.dept, vis: PV.vis, hour: PV.hour, dow: PV.dow, age: PV.age, chr: PV.chr, qd: 1, qa: 1 });
      const ex = E.explainPrediction(x), p = ex.base, tg = S.target[PV.tri], mx = 160, pos = v => Math.min(100, v / mx * 100);
      const maxEff = Math.max(...ex.factors.map(f => Math.abs(f.effect)), 1);
      $("#predout").innerHTML = `<section class="panel"><h2>Expected wait</h2><div class="big">${Math.round(p.mean)}<small>minutes</small></div>
        <p class="cap" style="margin:6px 0 0">Four in five patients like this wait between <b>${Math.round(p.lo)}</b> and <b>${Math.round(p.hi)}</b> minutes. Chance of an hour or more: <b>${pc(p.pLong)}</b>.</p>
        <div class="range" aria-hidden="true"><div class="rl"></div><div class="band" style="left:${pos(p.lo)}%;width:${pos(p.hi) - pos(p.lo)}%"></div><div class="pt" style="left:calc(${pos(p.mean)}% - 2px)"></div><div class="tg" style="left:${pos(tg)}%"><span>target ${tg}</span></div>
        ${[0, 30, 60, 90, 120, 150].map(v => `<span class="lab" style="left:${pos(v)}%">${v}</span>`).join("")}</div>
        <p style="margin-top:22px">${p.mean > tg ? `Expected to wait <b>${Math.round(p.mean - tg)} min past</b> the ${tg} min target for ${D.tri[PV.tri]} patients.` : `Expected to be seen <b>${Math.round(tg - p.mean)} min inside</b> the ${tg} min target for ${D.tri[PV.tri]} patients.`}</p></section>
      <section class="panel"><h2>What moves this estimate</h2><p class="cap">Each factor is swapped for typical values from past visits to see how far the estimate shifts. The typical visit waits about ${Math.round(ex.typical)} minutes.</p>
        ${ex.factors.map(f => `<div class="eff"><span>${f.name}</span><div class="tr"><i style="${f.effect >= 0 ? "left:50%" : "right:50%"};width:${Math.abs(f.effect) / maxEff * 50}%;background:${f.effect >= 0 ? "var(--warm)" : "var(--cool)"}"></i></div><span class="v">${Math.abs(f.effect) < .5 ? "0" : signed(f.effect, 0)} min</span></div>`).join("")}
        <p class="note">Try a Critical patient and then a Low one: triage level does nearly all the work, and department adds a little. Time of day, weekday, age and chronic conditions barely move the estimate, because they show no pattern in this dataset.</p></section>`;
    }
    out();
  }

  function viewModel() {
    const M = D.metrics, R = M.regression_test, our = R["Gradient-boosted trees (our model)"], tri = R["By triage level"], td = R["By triage level and department"];
    const imp = Object.entries(M.importance).sort((a, b) => b[1] - a[1]), mi = Math.max(...imp.map(i => i[1]));
    const cal = M.long_wait.calibration;
    return `<h1 class="page-title">Model and data</h1><p class="sub tight">How the estimates are made, how well they hold up on months the model never saw, and what the data can and cannot tell us.</p>
    <div class="grid2"><section class="panel"><h2>The model</h2><p class="cap">Gradient-boosted decision trees written and trained by us on the 8,000 visits. No pretrained model, no API key, no outside data. The trained trees are shipped inside this website and run in your browser.</p>
      <div class="kv"><span>Train</span><b>${esc(M.split.train)}</b></div><div class="kv"><span>Tune</span><b>${esc(M.split.validation)}</b></div><div class="kv"><span>Test (never used for fitting)</span><b>${esc(M.split.test)}</b></div>
      <p class="note">The split follows time: the model only ever learns from the past and is scored on later months. Features are limited to what is known when the patient arrives.</p></section>
    <section class="panel"><h2>Predicting the wait</h2><p class="cap">Average miss on the test months, in minutes. Lower is better.</p>
      <table><thead><tr><th>Method</th><th class="r">Average miss</th><th class="r">Explains</th></tr></thead><tbody>${Object.entries(R).map(([k, v]) => `<tr><td>${v === our ? "<b>" + k + "</b>" : k}</td><td class="r">${v.MAE.toFixed(1)} min</td><td class="r">${pc(Math.max(0, v.R2))}</td></tr>`).join("")}</tbody></table>
      <p class="note"><b>Honest reading:</b> the model beats a flat guess by ${(R["Same for everyone (overall average)"].MAE - our.MAE).toFixed(1)} minutes and a triage-only rule by ${(tri.MAE - our.MAE).toFixed(1)}, but it is only ${(td.MAE - our.MAE).toFixed(2)} min better than a simple triage-by-department average. In this simulated data, who you are barely matters beyond how urgent you are.</p></section></div>
    <div class="grid2" style="margin-top:18px"><section class="panel"><h2>Likely range and 1-hour waits</h2><p class="cap">The 80% range actually contained <b>${pc(M.interval.coverage, 1)}</b> of test visits (target 80%), averaging ${M.interval.mean_width.toFixed(0)} minutes wide. It is too narrow for Critical patients (${pc(M.interval.by_triage.Critical)}), whose waits are short and hard to pin down.</p>
      <p class="cap">Spotting waits of an hour or more: area under the curve <b>${M.long_wait.auc.toFixed(2)}</b> against ${M.long_wait.auc_triage_only.toFixed(2)} from triage alone (0.5 is a coin toss). Probability error ${M.long_wait.brier.toFixed(3)} against ${M.long_wait.brier_base.toFixed(3)} for always guessing the average.</p>
      <div class="legend"><span><i style="background:var(--accent)"></i>Model said</span><span><i style="background:var(--stage-wait)"></i>Actually happened</span></div>
      ${C.bars({ bars: cal.map((c, i) => ({ label: ["Lowest", "Low", "Middle", "High", "Highest"][i] + " risk", a: +(c.pred * 100).toFixed(1), b: +(c.actual * 100).toFixed(1), tip: `<b>${c.n} visits</b><br>Model said ${(c.pred * 100).toFixed(0)}%<br>Actually ${(c.actual * 100).toFixed(0)}% waited an hour or more` })), fmt: v => v + "%", w: 560, h: 230, aria: "Calibration" })}</section>
    <section class="panel"><h2>What drives the wait</h2><p class="cap">How much worse the model gets when each factor is scrambled (average minutes added to its miss).</p>
      <div class="bars">${imp.map(([k, v]) => `<div class="bar-row" style="grid-template-columns:200px minmax(0,1fr) 60px"><span>${k}</span><div class="track"><div class="f" style="width:${Math.max(0, v) / mi * 100}%"></div></div><span class="n"><b>${v < .05 ? "0" : v.toFixed(1)}</b></span></div>`).join("")}</div></section></div>
    <div class="grid2" style="margin-top:18px"><section class="panel health"><h2>Data checks</h2><p class="cap">What we verified before trusting the data.</p><ul>${M.health.map(h => `<li><span class="ic ${h.ok ? "y" : "n"}">${h.ok ? "✓" : "!"}</span><div>${esc(h.name || h.check)}<small>${esc(h.detail)}</small></div></li>`).join("")}</ul></section>
    <section class="panel"><h2>Limits and disclosure</h2><ul style="padding-left:18px;margin:0">
      <li>This is <b>simulated data</b>. Results show how the tool works, not how a real hospital performs. Do not use it for clinical decisions.</li>
      <li>Department volume is about 2 visits a day, far below the stated daily capacity, so capacity percentages would be meaningless. We use visits per staff member instead.</li>
      <li>Wait targets and test time limits are assumptions, set under Targets. They are not in the data.</li>
      <li>The model shipped here is refitted on the full year. The accuracy figures above come from the earlier model scored on the held-out test months.</li>
      <li>Tools used: Python, pandas, NumPy, SciPy and scikit-learn for training; plain HTML, CSS and JavaScript for this site. No API keys, no pretrained models, no outside data.</li></ul></section></div>`;
  }

  function viewTargets() {
    return `<h1 class="page-title">Targets</h1><p class="sub tight">These are assumptions, not facts from the data. Changing them updates every page.</p>
    <section class="panel"><h2>Longest acceptable wait before being seen</h2><p class="cap">In minutes, by triage level.</p><div class="controls">${D.tri.map((n, i) => `<label class="field"><span class="tag ${n}" style="align-self:flex-start">${n}</span><input type="number" min="5" max="240" data-tg="${i}" value="${S.target[i]}"></label>`).join("")}</div></section>
    <section class="panel"><h2>Longest acceptable test turnaround</h2><p class="cap">In minutes, from request to result.</p><div class="controls"><label class="field">Urgent tests<input type="number" min="10" max="480" data-sla="0" value="${S.sla[0]}"></label><label class="field">Routine tests<input type="number" min="10" max="480" data-sla="1" value="${S.sla[1]}"></label></div></section>
    <button class="btn" id="reset">Restore defaults</button>`;
  }
  function bindTargets() {
    const apply = () => { E.saveSettings(); E.build(); skyline(); badges(); };
    $$("[data-tg]").forEach(el => el.addEventListener("change", () => { S.target[+el.dataset.tg] = Math.max(5, +el.value || 5); apply(); }));
    $$("[data-sla]").forEach(el => el.addEventListener("change", () => { S.sla[+el.dataset.sla] = Math.max(10, +el.value || 10); apply(); }));
    $("#reset").addEventListener("click", () => { Object.assign(S, JSON.parse(JSON.stringify(E.DEFAULTS))); apply(); render(); });
  }

  /* ---------- render ---------- */
  const VIEWS = { now: viewNow, alerts: viewAlerts, first: viewFirst, forecast: viewForecast, tests: viewTests, predict: viewPredict, model: viewModel, targets: viewTargets };
  function badges() {
    const t = st.t; let a = 0; for (let d = 0; d < E.ND; d++) if (E.deptStatus(d, t).level === 2) a++;
    const b = $("#b-alerts"); if (b) { b.hidden = !a; b.textContent = a; }
  }
  function render() {
    $("#asof").textContent = dLong(st.t); $("#day").value = st.t;
    $$("[data-nav]").forEach(b => b.toggleAttribute("aria-current", false) || (b.dataset.nav === st.view && b.setAttribute("aria-current", "page")));
    $("#view").innerHTML = VIEWS[st.view]();
    badges(); whyBind();
    $$("[data-q]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); openWhy(E.queue(st.t)[+el.dataset.q]); }));
    if (st.view === "alerts") {
      const upd = () => { S.watch = +$("#watch").value; S.alert = Math.max(S.watch + .1, +$("#alertT").value); E.saveSettings(); skyline(); render(); };
      $("#watch").addEventListener("input", e => { $("#wv").textContent = (+e.target.value).toFixed(1); }); $("#alertT").addEventListener("input", e => { $("#av").textContent = (+e.target.value).toFixed(1); });
      $("#watch").addEventListener("change", upd); $("#alertT").addEventListener("change", upd);
    }
    if (st.view === "predict") bindPredict();
    if (st.view === "targets") bindTargets();
  }
  function boot() {
    const v = (location.hash || "").replace("#/", ""); if (VIEWS[v]) st.view = v;
    const sk = E.skyline().filter(x => x.a > 0); if (sk.length && sk[sk.length - 1].t > E.N - 120) st.t = sk[sk.length - 1].t;
    shell(); skyline(); render();
  }
  boot();
})();
