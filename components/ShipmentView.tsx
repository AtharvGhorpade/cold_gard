"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildRouteGeo, type CheckpointMeta, type ShipmentState } from "@/lib/detector";
import { distanceOf, departedOf, fmtDateTime, fmtTime, headline, STATUS_COLOR, STATUS_LABEL, TYPE_LABEL } from "./status";
import { Fact, Verdict } from "./parts";

const TruckMap = dynamic(() => import("./TruckMap"), {
  ssr: false,
  loading: () => <div className="map map-tall map-loading">Loading map…</div>,
});

interface Props {
  state: ShipmentState;
  checkpoints: CheckpointMeta[];
  names: Record<string, string>;
  tickMs: number;
  onBack: () => void;
  onReport: (id: string) => void;
  onCsv: (id: string) => void;
}

// CSS variables allow the Recharts SVG elements to follow the app theme.
const INK = "var(--ink)";
const MUTED = "var(--muted)";
const BLUE = "var(--accent)";
const ALERTISH = ["ALERT", "DISCARD", "NO_SIGNAL"];

function summary(xs: number[]) {
  if (!xs.length) return null;
  return { min: Math.min(...xs), max: Math.max(...xs), avg: xs.reduce((a, b) => a + b, 0) / xs.length };
}

export default function ShipmentView({ state: s, checkpoints, names, tickMs, onBack, onReport, onCsv }: Props) {
  const states = useMemo(() => [s], [s]);
  const last = s.lastReading;
  const temps = s.history.map((r) => r.temp_c);
  const hums = s.history.map((r) => r.humidity_pct);
  const ts = summary(temps);
  const hs = summary(hums);
  const inRange = s.history.length ? Math.round((s.history.filter((r) => r.temp_c >= s.profile.min_c && r.temp_c <= s.profile.max_c).length / s.history.length) * 100) : null;
  const outNow = !!last && (last.temp_c < s.profile.min_c || last.temp_c > s.profile.max_c);
  const alerting = ALERTISH.includes(s.status);
  const stops = s.meta.checkpoints.map((id) => names[id] ?? id);
  const chartData = s.history.map((r) => ({ t: fmtTime(r.timestamp), temp: r.temp_c, hum: r.humidity_pct }));
  const doneKm = Math.min(s.progressKm, s.totalKm);
  // Distance from the origin to each stop, along the route (one entry per checkpoint)
  const stopKm = useMemo(() => {
    const cps = Object.fromEntries(checkpoints.map((c) => [c.id, c]));
    return buildRouteGeo(s.meta.checkpoints, cps).cum;
  }, [s.meta.checkpoints, checkpoints]);
  const passed = stopKm.filter((km) => km <= doneKm + 0.5).length;

  return (
    <div className="view">
      <header className="sv-head">
        <button className="btn ghost sm" onClick={onBack}>
          ← All shipments
        </button>
        <div className="sv-title">
          <div className="sv-id">
            <span className="sq-inline" style={{ background: STATUS_COLOR[s.status] }} />
            <h1 className="num">{s.meta.shipment_id}</h1>
            <span className="sv-status" style={{ color: STATUS_COLOR[s.status] }}>
              {STATUS_LABEL[s.status]}
            </span>
          </div>
          <p className="lede">
            {s.profile.name} · batch <span className="num">{s.meta.batch ?? "–"}</span> · {s.meta.doses ? `${s.meta.doses.toLocaleString("en-IN")} doses` : "doses n/a"} · {names[s.meta.checkpoints[0]] ?? ""} to {names[s.meta.destination_id] ?? s.meta.destination_id}
          </p>
        </div>
      </header>

      {alerting && (
        <section className={`band ${s.status === "NO_SIGNAL" ? "band-quiet" : ""}`} role="alert">
          <div className="band-k">{STATUS_LABEL[s.status]}</div>
          <div className="band-t">{headline(s).title}</div>
          <div className="band-b">
            {headline(s).body}
            {s.next && s.status === "ALERT" && (
              <>
                {" "}
                <strong>
                  Divert to {s.next.checkpointName}: {s.next.distKm} km, about {s.next.etaMin} min.
                </strong>
              </>
            )}
          </div>
        </section>
      )}

      <div className="sv-grid">
        {/* LEFT: temperature and humidity */}
        <section className="sv-left">
          <div className="readouts">
            <div className="readout">
              <div className="ro-k">Temperature now</div>
              <div className={`ro-v num ${outNow ? "bad" : ""}`}>{last ? last.temp_c.toFixed(1) : "–"}<span>°C</span></div>
              <div className="ro-n">Label range {s.profile.min_c} to {s.profile.max_c} °C{outNow ? " · outside range" : ""}</div>
            </div>
            <div className="readout">
              <div className="ro-k">Humidity now</div>
              <div className="ro-v num">{last ? last.humidity_pct.toFixed(0) : "–"}<span>%</span></div>
              <div className="ro-n">inside cold box</div>
            </div>
            <div className="readout">
              <div className="ro-k">Estimated potency</div>
              <div className={`ro-v num ${s.frozen ? "bad" : s.viability < 95 ? "warn" : ""}`}>{s.frozen ? "0.00" : s.viability.toFixed(2)}<span>%</span></div>
              <div className="ro-n">{s.frozen ? "frozen, discard" : "model estimate"}</div>
            </div>
          </div>

          <table className="table stats">
            <thead>
              <tr>
                <th />
                <th className="r">Min</th>
                <th className="r">Max</th>
                <th className="r">Average</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Temperature °C</td>
                <td className="num r">{ts ? ts.min.toFixed(1) : "–"}</td>
                <td className="num r">{ts ? ts.max.toFixed(1) : "–"}</td>
                <td className="num r">{ts ? ts.avg.toFixed(1) : "–"}</td>
              </tr>
              <tr>
                <td>Humidity %</td>
                <td className="num r">{hs ? hs.min.toFixed(0) : "–"}</td>
                <td className="num r">{hs ? hs.max.toFixed(0) : "–"}</td>
                <td className="num r">{hs ? hs.avg.toFixed(1) : "–"}</td>
              </tr>
            </tbody>
          </table>
          <p className="meta">
            {s.history.length} readings{inRange !== null ? ` · ${inRange}% of readings inside the label range` : ""}
          </p>

          <div className="sub-head">Temperature over the trip</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--rule-soft)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: MUTED, fontFamily: "ui-monospace, monospace" }} minTickGap={40} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: MUTED, fontFamily: "ui-monospace, monospace" }} domain={["auto", "auto"]} tickLine={false} axisLine={false} />
                <ReferenceArea y1={s.profile.min_c} y2={s.profile.max_c} fill="var(--safe-band)" fillOpacity={0.9} ifOverflow="extendDomain" />
                {s.profile.freeze_damage_below_c !== null && (
                  <ReferenceLine y={s.profile.freeze_damage_below_c} stroke="var(--bad)" strokeDasharray="3 3" ifOverflow="extendDomain" />
                )}
                <Tooltip formatter={(v: number) => `${v.toFixed(1)} °C`} contentStyle={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: INK, background: "var(--panel)", borderRadius: 8, border: `1px solid ${INK}` }} />
                <Line type="monotone" dataKey="temp" stroke={INK} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="sub-head">Humidity over the trip</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--rule-soft)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: MUTED, fontFamily: "ui-monospace, monospace" }} minTickGap={40} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: MUTED, fontFamily: "ui-monospace, monospace" }} domain={[0, 100]} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)} %`} contentStyle={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: INK, background: "var(--panel)", borderRadius: 8, border: `1px solid ${INK}` }} />
                <Line type="monotone" dataKey="hum" stroke={BLUE} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="sub-head">Excursions</div>
          {s.excursions.length === 0 ? (
            <p className="quiet">None. The cold box stayed inside the label range.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Type</th>
                  <th className="r">Duration</th>
                  <th className="r">Peak</th>
                  <th>Alert sent to</th>
                </tr>
              </thead>
              <tbody>
                {s.excursions.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{fmtTime(e.startedAt)}</td>
                    <td>
                      {TYPE_LABEL[e.type]}
                      {e.injected && <span className="tag">simulated fault</span>}
                    </td>
                    <td className="num r">
                      {e.durationMin} min{e.endedAt ? "" : " …"}
                    </td>
                    <td className="num r">{e.peakTempC.toFixed(1)} °C</td>
                    <td>{e.alert?.checkpointName ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* RIGHT: this shipment's map, progress and next stop */}
        <section className="sv-right">
          <div className="map-frame">
            <TruckMap checkpoints={checkpoints} states={states} mode="single" selected={s.meta.shipment_id} onSelect={() => {}} tickMs={tickMs} />
          </div>
          <div className="progress">
            <div className="progress-top">
              <span className="meta">Progress</span>
              <span className="num">
                {Math.round(s.progressPct)}% · {Math.round(doneKm)} of {Math.round(s.totalKm)} km
              </span>
            </div>
            <div className="progress-track" aria-hidden>
              <i style={{ width: `${Math.min(100, s.progressPct)}%` }} />
            </div>
            <ol className="stops">
              {stops.map((n, i) => (
                <li key={i} className={i < passed ? "done" : ""}>
                  <span className="num">{i + 1}</span> {n}
                  {i === 0 && <span className="meta"> origin</span>}
                  {i === stops.length - 1 && <span className="meta"> destination</span>}
                </li>
              ))}
            </ol>
          </div>
          <div className="next">
            <div className="meta">Next checkpoint</div>
            {s.next ? (
              <>
                <div className="next-n">{s.next.checkpointName}</div>
                <div className="num">
                  {s.next.distKm} km · about {s.next.etaMin} min
                </div>
              </>
            ) : (
              <div className="quiet">{s.status === "DELIVERED" ? "Arrived at destination." : "No further checkpoint."}</div>
            )}
          </div>
        </section>
      </div>

      <section className="details">
        <Fact k="Departed" v={departedOf(s.meta) ? fmtDateTime(Date.parse(departedOf(s.meta))) : "–"} small />
        <Fact k="Distance" v={`${distanceOf(s.meta).toFixed(0)} km`} />
        <Fact k="Driver" v={s.meta.driver ?? "–"} small />
        <Fact k="Vehicle" v={s.meta.vehicle ?? "–"} small />
        <Fact k="Cold box" v={s.meta.cold_box ?? "–"} small />
        <Fact k="Sensor" v={s.meta.sensor_id ?? "–"} small />
        <Fact
          k="Feed"
          v={s.meta.feed === "live" ? "Live ESP32" : "Simulated"}
          small
          note={last ? `last reading ${fmtTime(last.timestamp)} IST` : "no reading yet"}
        />
        <div className="details-actions">
          <button className="btn solid" onClick={() => onReport(s.meta.shipment_id)}>
            Shipment report
          </button>
          <button className="btn" onClick={() => onCsv(s.meta.shipment_id)}>
            Readings CSV
          </button>
        </div>
      </section>
      <Verdict s={s} />
    </div>
  );
}

