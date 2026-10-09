// Report generation. Produces self-contained HTML (print to PDF from the browser) and CSV.
import type { Profile, Reading, ShipmentMeta, ShipmentState } from "./detector";
import { SENSOR_SCENARIOS } from "./simulate";

const esc = (v: unknown) =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmt = (iso: string | number) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }) + " IST";

const hm = (iso: string | number) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

const TYPE: Record<string, string> = { HEAT: "Too warm", COLD: "Too cold", FREEZE: "Frozen", MIXED: "Temperature swing" };
const GAP_MIN = 15;

export function checkpointNames(meta: ShipmentMeta, names: Record<string, string>) {
  return meta.checkpoints.map((id) => names[id] ?? id);
}

function verdict(s: ShipmentState): { label: string; text: string } {
  if (s.status === "DISCARD")
    return { label: "DISCARD", text: "Frozen exposure. Quarantine this batch and do not administer. Record the batch number and report to the supervisor." };
  if (s.status === "ALERT")
    return { label: "ACTION NEEDED", text: "Excursion still in progress at the time of this report. Divert to the alerted checkpoint and re-check temperature on arrival." };
  if (s.status === "NO_SIGNAL")
    return { label: "UNVERIFIED", text: "Telemetry lost. Confirm the cold box status with the driver before accepting the load." };
  if (s.status === "WAITING") return { label: "NOT DEPARTED", text: "No telemetry recorded yet." };
  if (s.excursions.length && s.viability >= 95)
    return { label: "RELEASE WITH NOTE", text: "Temperature excursion(s) recorded. Estimated potency remains high. Release with the excursion documented, and confirm VVM status on arrival." };
  if (s.excursions.length)
    return { label: "HOLD FOR REVIEW", text: "Excursion(s) recorded with reduced estimated potency. Hold for supervisor review before release." };
  return { label: "RELEASE", text: "Temperature stayed within the label range for the whole trip." };
}

const stats = (xs: number[]) =>
  xs.length
    ? { min: Math.min(...xs), max: Math.max(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length }
    : null;

/** Time-series line chart as inline SVG, so it prints with the report. */
function lineSvg(o: {
  times: number[];
  values: number[];
  yMin: number;
  yMax: number;
  unit: string;
  color: string;
  band?: [number, number];
  lines?: { y: number; label: string; color: string }[];
}): string {
  const W = 720, H = 190, L = 46, R = 12, T = 10, B = 26;
  if (!o.values.length) return "";
  const t0 = o.times[0], t1 = o.times[o.times.length - 1] || t0 + 1;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - o.yMin) / Math.max(0.0001, o.yMax - o.yMin)) * (H - T - B);
  const path = o.values.map((v, i) => `${i ? "L" : "M"}${x(o.times[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => o.yMin + f * (o.yMax - o.yMin));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0));
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.unit)} chart">
${o.band ? `<rect x="${L}" y="${y(o.band[1])}" width="${W - L - R}" height="${y(o.band[0]) - y(o.band[1])}" fill="#e3ebe3"/>` : ""}
${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e7e2d6"/><text x="${L - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#6f6a5e" font-family="monospace">${v.toFixed(o.unit === "%" ? 0 : 1)}</text>`).join("")}
${o.lines?.map((l) => `<line x1="${L}" x2="${W - R}" y1="${y(l.y)}" y2="${y(l.y)}" stroke="${l.color}" stroke-dasharray="4 3"/><text x="${W - R}" y="${y(l.y) - 3}" font-size="10" text-anchor="end" fill="${l.color}" font-family="monospace">${esc(l.label)}</text>`).join("") ?? ""}
${xTicks.map((t) => `<text x="${x(t)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#6f6a5e" font-family="monospace">${hm(t)}</text>`).join("")}
<path d="${path}" fill="none" stroke="${o.color}" stroke-width="1.8" stroke-linejoin="round"/>
</svg>`;
}

function page(title: string, body: string) {
  const css = `
@page { size: A4; margin: 14mm; }
body { font-family: Georgia, 'Times New Roman', serif; color: #1b1a17; margin: 0; background: #fff; font-size: 12px; line-height: 1.45; }
.wrap { max-width: 800px; margin: 0 auto; padding: 28px; }
.bar { display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #1b1a17; padding-bottom: 10px; }
.brand { font-size: 20px; font-weight: 700; }
.doc { font: 11px ui-monospace, Menlo, Consolas, monospace; text-transform: uppercase; letter-spacing: .08em; color:#5b574c; text-align:right; }
h1 { font-size: 22px; margin: 18px 0 4px; }
h2 { font: 600 11.5px ui-monospace, Menlo, Consolas, monospace; text-transform: uppercase; letter-spacing: .08em; margin: 22px 0 8px; border-bottom: 1px solid #d9d4c7; padding-bottom: 4px; }
h3 { font: 600 11px ui-monospace, Menlo, Consolas, monospace; color:#5b574c; margin: 14px 0 4px; text-transform: uppercase; letter-spacing: .06em; }
table { width: 100%; border-collapse: collapse; }
td, th { padding: 5px 7px; border-bottom: 1px solid #e6e2d6; text-align: left; vertical-align: top; }
th { font: 600 10px ui-monospace, Menlo, Consolas, monospace; text-transform: uppercase; letter-spacing: .05em; color:#5b574c; }
tr { break-inside: avoid; }
.readings td, .readings th { padding: 3px 6px; font-size: 10.5px; }
.kv td:first-child { width: 32%; color:#5b574c; }
.num { font-family: ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.out { font-weight: 700; color: #7f1d1d; }
.verdict { border: 1.5px solid #1b1a17; padding: 12px 14px; margin-top: 14px; break-inside: avoid; }
.verdict b { font: 700 12px ui-monospace, Menlo, Consolas, monospace; letter-spacing: .06em; }
.stats { display:grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 8px 0; }
.stats div { border: 1px solid #d9d4c7; padding: 6px 8px; }
.stats span { display:block; font: 10px ui-monospace, Menlo, monospace; text-transform: uppercase; color:#5b574c; }
.stats b { font: 600 15px ui-monospace, Menlo, monospace; }
.sign { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 34px; break-inside: avoid; }
.sign div { border-top: 1px solid #1b1a17; padding-top: 4px; font-size: 11px; color:#5b574c; }
.note { font-size: 10.5px; color:#5b574c; margin-top: 8px; }
.gap { color:#7f1d1d; }
svg { display:block; margin: 4px 0 10px; }
.printbtn { position: fixed; top: 14px; right: 14px; background:#1b1a17; color:#fff; border:0; padding:8px 14px; font: 13px system-ui; cursor:pointer; }
@media print { .printbtn { display:none; } h2 { break-after: avoid; } }`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head>
<body><button class="printbtn" onclick="window.print()">Print / Save as PDF</button><div class="wrap">${body}
<p class="note">Generated by StayCold from simulated sensor data. Potency values are model estimates, not manufacturer data. Verify with the product insert and VVM before clinical use.</p>
</div></body></html>`;
}

export function shipmentReport(p: {
  state: ShipmentState;
  profile: Profile;
  names: Record<string, string>;
  sources: string[];
  asOf: number;
  complete: boolean;
}): string {
  const { state: s, profile, names } = p;
  const m = s.meta;
  const v = verdict(s);
  const hist = s.history;
  const temps = hist.map((r) => r.temp_c);
  const hums = hist.map((r) => r.humidity_pct);
  const ts = stats(temps);
  const hs = stats(hums);
  const inRange = hist.filter((r) => r.temp_c >= profile.min_c && r.temp_c <= profile.max_c).length;
  const dist = m.distance_km ?? m.ground_truth?.distance_km;
  const departed = m.departed_at ?? m.ground_truth?.departed_at;
  const stops = checkpointNames(m, names);
  const sim = m.source === "user" ? `<tr><td>Telemetry source</td><td>Simulated sensor (${esc(SENSOR_SCENARIOS[m.scenario] ?? m.scenario)})</td></tr>` : "";

  // gaps in telemetry
  const gaps: { from: string; to: string; min: number }[] = [];
  for (let i = 1; i < hist.length; i++) {
    const d = (Date.parse(hist[i].timestamp) - Date.parse(hist[i - 1].timestamp)) / 60000;
    if (d > GAP_MIN) gaps.push({ from: hist[i - 1].timestamp, to: hist[i].timestamp, min: Math.round(d) });
  }

  const excRows = s.excursions.length
    ? s.excursions
        .map(
          (e) => `<tr><td class="num">${fmt(e.startedAt)}</td><td>${esc(TYPE[e.type])}</td><td class="num">${e.durationMin} min</td>
<td class="num">${e.peakTempC.toFixed(1)} °C</td><td class="num">${e.degreeMinutes}</td><td>${e.endedAt ? "Recovered" : "Ongoing"}</td>
<td>${esc(e.alert?.checkpointName ?? "—")}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="7">No excursions recorded.</td></tr>`;

  const stopRows = stops
    .map((n, i) => `<tr><td class="num">${i + 1}</td><td>${esc(n)}</td><td>${i === 0 ? "Origin" : i === stops.length - 1 ? "Destination" : "Checkpoint"}</td></tr>`)
    .join("");

  const readingRows = hist
    .map((r, i) => {
      const st = r.temp_c < (profile.freeze_damage_below_c ?? -Infinity) ? "FROZEN" : r.temp_c < profile.min_c ? "LOW" : r.temp_c > profile.max_c ? "HIGH" : "in range";
      const cls = st === "in range" ? "" : "out";
      return `<tr class="${cls}"><td class="num">${i + 1}</td><td class="num">${fmt(r.timestamp)}</td><td class="num">${r.temp_c.toFixed(2)}</td><td class="num">${r.humidity_pct.toFixed(1)}</td><td>${st}</td><td class="num">${r.lat.toFixed(4)}</td><td class="num">${r.lon.toFixed(4)}</td><td class="num">${r.battery_pct.toFixed(0)}%</td></tr>`;
    })
    .join("");

  const tempSvg = lineSvg({
    times: hist.map((r) => Date.parse(r.timestamp)),
    values: temps,
    yMin: Math.min(profile.min_c - 2, ...temps) - 0.5,
    yMax: Math.max(profile.max_c + 2, ...temps) + 0.5,
    unit: "°C",
    color: "#1b1a17",
    band: [profile.min_c, profile.max_c],
    lines: profile.freeze_damage_below_c !== null ? [{ y: profile.freeze_damage_below_c, label: "freezing limit", color: "#7f1d1d" }] : [],
  });
  const humSvg = lineSvg({
    times: hist.map((r) => Date.parse(r.timestamp)),
    values: hums,
    yMin: 0,
    yMax: 100,
    unit: "%",
    color: "#2446a8",
  });

  const body = `
<div class="bar"><div class="brand">StayCold</div><div class="doc">Shipment report<br>${esc(m.shipment_id)}</div></div>
<h1>${esc(profile.name)} · ${esc(m.shipment_id)}</h1>
<div class="muted">As of ${fmt(p.asOf)}${p.complete ? " · trip complete" : " · trip in progress"}</div>

<div class="verdict"><b>${esc(v.label)}</b><br>${esc(v.text)}</div>

<h2>Shipment</h2>
<table class="kv">
<tr><td>Status</td><td>${esc(s.status.replace("_", " "))}: ${esc(s.reason)}</td></tr>
<tr><td>Vaccine</td><td>${esc(profile.name)} (${esc(m.vaccine)})</td></tr>
<tr><td>Batch</td><td class="num">${esc(m.batch)}</td></tr>
<tr><td>Doses</td><td class="num">${m.doses ? m.doses.toLocaleString("en-IN") : "—"}</td></tr>
<tr><td>Departed</td><td>${departed ? fmt(departed) : "—"}</td></tr>
<tr><td>Distance</td><td class="num">${dist ? dist.toFixed(0) + " km" : "—"}</td></tr>
<tr><td>Driver / vehicle</td><td>${esc(m.driver)} · <span class="num">${esc(m.vehicle)}</span></td></tr>
<tr><td>Cold box / sensor</td><td class="num">${esc(m.cold_box)} · ${esc(m.sensor_id)}</td></tr>
${sim}
</table>

<h2>Storage requirements</h2>
<table class="kv">
<tr><td>Label storage</td><td>${profile.min_c} to ${profile.max_c} °C</td></tr>
<tr><td>Freezing</td><td>${profile.freeze_damage_below_c === null ? "Not damaged by freezing" : `Damaged below ${profile.freeze_damage_below_c} °C`}</td></tr>
<tr><td>Estimated potency</td><td class="num">${s.frozen ? "0.00% (frozen)" : s.viability.toFixed(2) + "%"}</td></tr>
</table>

<h2>Temperature and humidity summary</h2>
<div class="stats">
<div><span>Readings</span><b>${hist.length}</b></div>
<div><span>Temp min / max</span><b>${ts ? `${ts.min.toFixed(1)} / ${ts.max.toFixed(1)} °C` : "—"}</b></div>
<div><span>Temp mean</span><b>${ts ? ts.mean.toFixed(1) + " °C" : "—"}</b></div>
<div><span>In label range</span><b>${hist.length ? Math.round((inRange / hist.length) * 100) + "%" : "—"}</b></div>
<div><span>Humidity min / max</span><b>${hs ? `${hs.min.toFixed(0)} / ${hs.max.toFixed(0)} %` : "—"}</b></div>
<div><span>Humidity mean</span><b>${hs ? hs.mean.toFixed(1) + " %" : "—"}</b></div>
<div><span>Telemetry gaps</span><b>${gaps.length}</b></div>
<div><span>Excursions</span><b>${s.excursions.length}</b></div>
</div>
${gaps.length ? `<p class="gap">Telemetry gaps longer than ${GAP_MIN} minutes: ${gaps.map((g) => `${hm(g.from)} to ${hm(g.to)} (${g.min} min)`).join("; ")}.</p>` : ""}

<h2>Temperature over the trip</h2>
${tempSvg || "<p>No readings.</p>"}
<h2>Humidity over the trip</h2>
${humSvg || "<p>No readings.</p>"}

<h2>Excursions</h2>
<table><thead><tr><th>Started</th><th>Type</th><th>Duration</th><th>Peak</th><th>Deg-min</th><th>State</th><th>Alert sent to</th></tr></thead>
<tbody>${excRows}</tbody></table>

<h2>Route</h2>
<table><thead><tr><th>#</th><th>Stop</th><th>Role</th></tr></thead><tbody>${stopRows}</tbody></table>

<h2>All readings (${hist.length})</h2>
<table class="readings"><thead><tr><th>#</th><th>Time</th><th>Temp °C</th><th>Humidity %</th><th>Status</th><th>Latitude</th><th>Longitude</th><th>Battery</th></tr></thead>
<tbody>${readingRows || `<tr><td colspan="8">No readings received.</td></tr>`}</tbody></table>

<h2>Method</h2>
<p>Excursions are confirmed after two consecutive out-of-range readings (10 minutes). A reading below the freezing limit is confirmed immediately. Potency is estimated from heat exposure using an illustrative half-life model. Freezing sets potency to zero. Progress along the route is estimated from GPS fixes.</p>
<p class="note">Sources: ${p.sources.map(esc).join("; ")}</p>

<div class="sign"><div>Dispatched by</div><div>Received by</div><div>Reviewed by</div></div>
`;
  return page(`Shipment report ${m.shipment_id}`, body);
}

export function fleetReport(p: { states: ShipmentState[]; names: Record<string, string>; asOf: number }): string {
  const rows = p.states
    .map(
      (s) => `<tr><td class="num">${esc(s.meta.shipment_id)}</td><td>${esc(s.profile.name)}</td><td class="num">${esc(s.meta.batch)}</td>
<td>${esc(s.status.replace("_", " "))}</td><td class="num">${s.frozen ? "0.00%" : s.viability.toFixed(2) + "%"}</td>
<td class="num">${s.excursions.length}</td><td class="num">${Math.round(s.progressPct)}%</td></tr>`,
    )
    .join("");
  const body = `
<div class="bar"><div class="brand">StayCold</div><div class="doc">Fleet summary</div></div>
<h1>Cold chain fleet summary</h1>
<div class="muted">As of ${fmt(p.asOf)} · ${p.states.length} shipments</div>
<h2>Shipments</h2>
<table><thead><tr><th>Shipment</th><th>Vaccine</th><th>Batch</th><th>Status</th><th>Potency</th><th>Excursions</th><th>Progress</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="sign"><div>Prepared by</div><div>Reviewed by</div><div>Date</div></div>`;
  return page("StayCold fleet summary", body);
}

export function readingsCsv(meta: ShipmentMeta, rows: Reading[], profile?: Profile): string {
  const head = "shipment_id,timestamp_ist,temp_c,humidity_pct,status,lat,lon,battery_pct";
  const lines = rows.map((r) => {
    const ist = new Date(Date.parse(r.timestamp) + 5.5 * 3600000).toISOString().replace("T", " ").slice(0, 16);
    const st = profile ? (r.temp_c < profile.min_c ? "LOW" : r.temp_c > profile.max_c ? "HIGH" : "in range") : "";
    return [meta.shipment_id, ist, r.temp_c, r.humidity_pct, st, r.lat, r.lon, r.battery_pct].join(",");
  });
  return [head, ...lines].join("\n");
}

/** Open an HTML document in a new tab (the user can print or save it as PDF). */
export function openHtml(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(url, "_blank");
  if (!w) download("staycold-report.html", html, "text/html");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
