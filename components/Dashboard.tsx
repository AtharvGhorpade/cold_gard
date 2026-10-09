"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor, type CheckpointMeta, type Excursion, type Profile, type Reading, type ShipmentMeta, type ShipmentState, type TruthEvent } from "@/lib/detector";
import { Replay, SPEEDS, TICK_MIN } from "@/lib/replay";
import { fleetReport, openHtml, readingsCsv, download, shipmentReport } from "@/lib/report";
import { routeDistanceKm, simulateShipment } from "@/lib/simulate";
import FleetView from "./FleetView";
import NewShipmentView, { type NewForm } from "./NewShipmentView";
import ReportsView from "./ReportsView";
import ShipmentView from "./ShipmentView";
import Transport from "./Transport";
import { fmtDateTime, fmtDay, fmtTime, IST } from "./status";

interface DataPayload {
  shipments: ShipmentMeta[];
  checkpoints: CheckpointMeta[];
  profiles: Record<string, Profile>;
  sources: string[];
  truthEvents: TruthEvent[];
  readings: Reading[];
}

type View = "fleet" | "shipment" | "new" | "reports";
type Theme = "light" | "dark";
const MATCH_WINDOW_MIN = 15;

export default function Dashboard() {
  const [data, setData] = useState<DataPayload | null>(null);
  const [replaySnap, setSnap] = useState<ShipmentState[]>([]);
  const [pos, setPos] = useState(0);
  const [clockMs, setClockMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [view, setView] = useState<View>("fleet");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [liveMetas, setLiveMetas] = useState<ShipmentMeta[]>([]);
  const [liveSnap, setLiveSnap] = useState<ShipmentState[]>([]);
  const [flash, setFlash] = useState("");
  /** Shipments and states from both sources: the replayed seed data and the live ESP32 feed. */
  const snap = useMemo(() => [...replaySnap, ...liveSnap], [replaySnap, liveSnap]);
  const liveRef = useRef<{ metas: ShipmentMeta[]; readings: Reading[]; mon: Monitor | null; lastTs: string | null }>({
    metas: [],
    readings: [],
    mon: null,
    lastTs: null,
  });
  const [showSim, setShowSim] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  const dataRef = useRef<DataPayload | null>(null);
  const replayRef = useRef<Replay | null>(null);
  const monRef = useRef<Monitor | null>(null);

  const newMonitor = () => {
    const d = dataRef.current!;
    return new Monitor(d.shipments, d.profiles, d.checkpoints);
  };

  const commit = () => {
    const mon = monRef.current!;
    setSnap(mon.snapshot());
    setClockMs(mon.clockMs);
    setPos(replayRef.current!.pos);
  };

  /** Pull live shipments and new sensor readings from the server, then run them through the same detector. */
  const pollLive = async () => {
    const d = dataRef.current;
    const L = liveRef.current;
    if (!d) return;
    try {
      const res = await fetch(`/api/live${L.lastTs ? `?since=${encodeURIComponent(L.lastTs)}` : ""}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { shipments: ShipmentMeta[]; readings: Reading[] };
      const idKey = (ms: ShipmentMeta[]) => ms.map((m) => m.shipment_id).join(",");
      const rebuild = idKey(body.shipments) !== idKey(L.metas) || !L.mon;
      L.metas = body.shipments;
      L.readings.push(...body.readings);
      if (body.readings.length) L.lastTs = body.readings[body.readings.length - 1].timestamp;
      if (rebuild) {
        L.mon = new Monitor(L.metas, d.profiles, d.checkpoints);
        L.readings.forEach((r) => L.mon!.ingest(r));
      } else {
        body.readings.forEach((r) => L.mon!.ingest(r));
      }
      // Wall-clock time, so a sensor that stops reporting shows NO_SIGNAL
      L.mon!.clockMs = Math.max(L.mon!.clockMs, Date.now());
      setLiveMetas(L.metas);
      setLiveSnap(L.mon!.snapshot());
    } catch {
      /* server briefly unreachable: keep the last known state */
    }
  };

  useEffect(() => {
    const tick = () => {
      if (dataRef.current) pollLive();
    };
    const every = setInterval(tick, 2000);
    const first = setTimeout(tick, 300);
    return () => {
      clearInterval(every);
      clearTimeout(first);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the selected appearance across visits. The system preference is used
  // only the first time, so the toggle always remains the user's choice.
  useEffect(() => {
    const saved = window.localStorage.getItem("staycold-theme") as Theme | null;
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("staycold-theme", theme);
  }, [theme]);

  /** Move the replay to tick n. Going backwards rebuilds the monitor from the start. */
  const goTo = (n: number) => {
    const replay = replayRef.current;
    if (!dataRef.current || !replay) return;
    if (n < replay.pos) {
      replay.rewind();
      monRef.current = newMonitor();
    }
    while (replay.pos < n) {
      const t = replay.next();
      if (!t) break;
      t.readings.forEach((r) => monRef.current!.ingest(r));
    }
    commit();
  };

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d: DataPayload) => {
        dataRef.current = d;
        replayRef.current = new Replay(d.readings);
        monRef.current = newMonitor();
        setData(d);
        setSelected(d.shipments[0]?.shipment_id ?? null);
        goTo(0);
        setPlaying(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Playback: one tick every (5 simulated minutes / speed) real seconds
  useEffect(() => {
    if (!playing || !data || !replayRef.current) return;
    const replay = replayRef.current;
    if (replay.pos >= replay.length) {
      setPlaying(false);
      return;
    }
    const ms = (TICK_MIN / SPEEDS[speedIdx].minPerSec) * 1000;
    const t = setTimeout(() => goTo(replay.pos + 1), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, pos, speedIdx, data]);

  const total = replayRef.current?.length ?? 0;
  const finished = total > 0 && pos >= total;
  const tickMs = (TICK_MIN / SPEEDS[speedIdx].minPerSec) * 1000;

  const onToggle = () => {
    if (finished) {
      restart();
      return;
    }
    setPlaying((p) => !p);
  };
  const restart = () => {
    replayRef.current?.restart();
    monRef.current = newMonitor();
    setNotice("");
    goTo(0);
    setPlaying(true);
  };
  const onSeek = (n: number) => {
    setPlaying(false);
    goTo(n);
  };

  const onInject = (id: string, scenario: string) => {
    const ok = replayRef.current?.inject(id, scenario);
    setNotice(
      ok
        ? `Fault queued on ${id} from this moment. Watch its next readings. Restart clears simulated faults.`
        : "The trip has finished. Restart it to simulate a fault.",
    );
  };

  /** Create a shipment: generate its telemetry, merge it into the replay, and rebuild state to the current moment. */
  const createShipment = async (f: NewForm): Promise<string | null> => {
    const d = dataRef.current;
    const r = replayRef.current;
    if (!d || !r) return "Still loading.";
    const route = [f.origin, ...f.via.filter(Boolean), f.destination];
    if (route.length < 2) return "Choose an origin and a destination.";
    if (new Set(route).size !== route.length) return "Each stop must be a different checkpoint.";
    const profile = d.profiles[f.vaccine];
    if (!profile) return "Choose a vaccine.";
    if (!f.departure || !Number.isFinite(Date.parse(`${f.departure}:00+05:30`))) return "Enter a departure time.";
    if (!f.driver.trim() || !f.vehicle.trim()) return "Enter the driver and vehicle registration.";
    if (f.feed === "live") {
      if (!f.sensorId.trim()) return "Enter the sensor ID printed on the ESP32.";
      const cpsLive = Object.fromEntries(d.checkpoints.map((c) => [c.id, c]));
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vaccine: f.vaccine,
          vaccine_name: profile.name,
          route: "custom",
          checkpoints: route,
          scenario: "live",
          description: `${f.driver.trim()} · ${f.vehicle.trim()}`,
          destination_id: f.destination,
          departed_at: new Date(Date.parse(`${f.departure}:00+05:30`)).toISOString(),
          distance_km: Math.round(routeDistanceKm(route, cpsLive) * 10) / 10,
          doses: f.doses,
          batch: f.batch,
          driver: f.driver.trim(),
          vehicle: f.vehicle.trim(),
          cold_box: f.coldBox || "–",
          sensor_id: f.sensorId.trim(),
        }),
      });
      const out = await res.json();
      if (!res.ok) return out.error ?? "Could not register the sensor.";
      await pollLive();
      setSelected(out.shipment_id);
      setView("fleet");
      setFlash(
        `${out.shipment_id} is registered. The ESP32 for sensor ${f.sensorId.trim()} should post its temperature to this server with device key ${out.device_key}. StayCold simulates humidity, route progress and battery data for the live demo.`,
      );
      return null;
    }
    const departMs = Date.parse(`${f.departure}:00+05:30`);
    const nowMs = monRef.current?.clockMs || r.ticks[0].ts;
    if (departMs <= nowMs) return `Departure must be after the current simulation time (${fmtTime(nowMs)} IST).`;

    const seq = [...d.shipments, ...liveMetas].reduce((m, s) => Math.max(m, parseInt(s.shipment_id.slice(4), 10) || 0), 1000) + 1;
    const id = `SHP-${seq}`;
    const cps = Object.fromEntries(d.checkpoints.map((c) => [c.id, c]));
    const readings = simulateShipment({ id, route, cps, profile, departMs, scenario: f.scenario, seed: seq });
    const km = routeDistanceKm(route, cps);
    const meta: ShipmentMeta = {
      shipment_id: id,
      vaccine: f.vaccine,
      vaccine_name: profile.name,
      route: "custom",
      checkpoints: route,
      scenario: f.scenario,
      description: `${f.driver.trim()} · ${f.vehicle.trim()}`,
      destination_id: f.destination,
      departed_at: new Date(departMs).toISOString(),
      distance_km: Math.round(km * 10) / 10,
      doses: f.doses,
      batch: f.batch,
      driver: f.driver.trim(),
      vehicle: f.vehicle.trim(),
      cold_box: f.coldBox || "–",
      sensor_id: f.sensorId || "–",
      source: "user",
    };

    r.addReadings(readings);
    d.shipments = [...d.shipments, meta];
    const n = r.pos;
    r.rewind();
    monRef.current = newMonitor();
    goTo(n);
    setData({ ...d });
    setSelected(id);
    setView("fleet");
    setNotice(`${id} created. It departs at ${fmtTime(departMs)} IST and appears on the map with its first reading.`);
    return null;
  };

  // ---- actions that need the data
  const names = useMemo(() => Object.fromEntries((data?.checkpoints ?? []).map((c) => [c.id, c.name])), [data]);
  const metaById = useMemo(
    () => Object.fromEntries([...(data?.shipments ?? []), ...liveMetas].map((s) => [s.shipment_id, s])),
    [data, liveMetas],
  );

  const stateOf = (id: string) => snap.find((s) => s.meta.shipment_id === id);
  const onReport = (id: string) => {
    const s = stateOf(id);
    if (!s || !data) return;
    openHtml(shipmentReport({ state: s, profile: s.profile, names, sources: data.sources, asOf: clockMs, complete: finished }));
  };
  const onCsv = (id: string) => {
    const s = stateOf(id);
    if (!s) return;
    download(`${id}-readings.csv`, readingsCsv(s.meta, s.history), "text/csv");
  };
  const onFleetReport = () => openHtml(fleetReport({ states: snap, names, asOf: clockMs }));
  const onResetLive = async () => {
    try {
      const res = await fetch("/api/live", { method: "DELETE" });
      const body = (await res.json()) as { removed?: number; error?: string };
      if (!res.ok) {
        setFlash(body.error ?? "Could not reset the ESP32 feed.");
        return;
      }
      // Drop the browser-side monitor too, otherwise already received readings would be replayed.
      liveRef.current = { metas: [], readings: [], mon: null, lastTs: null };
      setLiveMetas([]);
      setLiveSnap([]);
      await pollLive();
      setFlash(`ESP32 feed reset. ${body.removed ?? 0} reading(s) cleared; the sensor remains registered and is ready for its next temperature update.`);
    } catch {
      setFlash("Could not reset the ESP32 feed. Check that the StayCold server is running.");
    }
  };

  // ---- derived view state
  const allExc: Excursion[] = useMemo(() => snap.flatMap((s) => s.excursions), [snap]);

  const accuracy = useMemo(() => {
    if (!data) return null;
    const real = allExc.filter((e) => !e.injected && metaById[e.shipment_id]?.source !== "user");
    const due = data.truthEvents.filter((t) => Date.parse(t.start) <= clockMs);
    const inWindow = (e: Excursion, t: TruthEvent) =>
      e.shipment_id === t.shipment_id &&
      Date.parse(e.confirmedAt) >= Date.parse(t.start) - 60000 &&
      Date.parse(e.confirmedAt) <= Date.parse(t.end) + MATCH_WINDOW_MIN * 60000;
    const found = due.map((t) => real.find((e) => inWindow(e, t))).filter(Boolean);
    return { due: due.length, matched: found.length, falseAlarms: real.filter((e) => !data.truthEvents.some((t) => inWindow(e, t))).length };
  }, [data, allExc, clockMs, metaById]);

  const selectedId = selected && stateOf(selected) ? selected : snap[0]?.meta.shipment_id ?? null;
  /** Open one shipment's full detail view. Used by table rows, map trucks and alerts. */
  const openShipment = (id: string) => {
    setSelected(id);
    setView("shipment");
  };

  if (!data) return <div className="boot">Loading StayCold…</div>;

  const navCount = snap.filter((s) => s.status === "ALERT" || s.status === "DISCARD").length;

  return (
    <div className="app">
      <aside className="nav">
        <div className="wordmark">
          <div className="word">StayCold</div>
          <div className="tagline">Vaccine cold chain, monitored in transit</div>
        </div>
        <nav>
          <NavItem active={view === "fleet" || view === "shipment"} onClick={() => setView("fleet")} label="Fleet" count={navCount || undefined} alert={navCount > 0} />
          <NavItem active={view === "new"} onClick={() => setView("new")} label="New shipment" />
          <NavItem active={view === "reports"} onClick={() => setView("reports")} label="Reports" />
        </nav>
        <div className="nav-foot">
          <div className="meta">Data</div>
          <p>
            {snap.length} shipments. {snap.filter((s) => s.meta.source === "user").length} added in this session.
          </p>
          <p className="meta">Simulated sensors. Potency values are model estimates.</p>
          <button className="btn ghost sm sim-toggle" onClick={() => setShowSim((v) => !v)} aria-expanded={showSim}>
            {showSim ? "Hide simulation controls" : "Show simulation controls"}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            aria-pressed={theme === "dark"}
          >
            <span aria-hidden>{theme === "light" ? "☾" : "☀"}</span>
            {theme === "light" ? "Dark theme" : "Light theme"}
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="content">
          {flash && (
            <p className="notice flash-line">
              {flash}{" "}
              <button className="btn ghost sm" onClick={() => setFlash("")}>
                Dismiss
              </button>
            </p>
          )}
          {view === "fleet" && (
            <FleetView
              checkpoints={data.checkpoints}
              states={snap}
              names={names}
              tickMs={tickMs}
              excursions={allExc}
              metaById={metaById}
              onOpen={openShipment}
              onFleetReport={onFleetReport}
              onInject={onInject}
              notice={notice}
              onNewShipment={() => setView("new")}
              hasLive={liveMetas.length > 0}
              onResetLive={onResetLive}
            />
          )}
          {view === "shipment" && selectedId && stateOf(selectedId) && (
            <ShipmentView
              state={stateOf(selectedId)!}
              checkpoints={data.checkpoints}
              names={names}
              tickMs={tickMs}
              onBack={() => setView("fleet")}
              onReport={onReport}
              onCsv={onCsv}
            />
          )}
          {view === "new" && (
            <NewShipmentView
              checkpoints={data.checkpoints}
              profiles={data.profiles}
              defaultDeparture={defaultDeparture(clockMs)}
              nowLabel={clockMs ? fmtDateTime(clockMs) + " IST" : "not started"}
              onCreate={createShipment}
              onCancel={() => setView("fleet")}
            />
          )}
          {view === "reports" && <ReportsView states={snap} names={names} clockMs={clockMs} onReport={onReport} onCsv={onCsv} onFleetReport={onFleetReport} />}
          {view === "reports" && accuracy && (
            <p className="meta foot">
              Detector check: {accuracy.matched} of {accuracy.due} ground-truth excursions detected, {accuracy.falseAlarms} false alarms.
            </p>
          )}
        </div>

        {showSim && (
        <Transport
          playing={playing}
          finished={finished}
          onToggle={onToggle}
          onRestart={restart}
          speedIdx={speedIdx}
          onSpeed={setSpeedIdx}
          pos={pos}
          total={total}
          clockLabel={clockMs ? `${fmtDay(clockMs).split(",")[0]} ${fmtTime(clockMs)} IST` : "Not started"}
          onSeek={onSeek}
        />
        )}
      </div>
    </div>
  );
}

function NavItem({ active, onClick, label, count, alert }: { active: boolean; onClick: () => void; label: string; count?: number; alert?: boolean }) {
  return (
    <button className={`nav-item ${active ? "on" : ""}`} onClick={onClick}>
      <span>{label}</span>
      {count !== undefined && <span className={`nav-count ${alert ? "alert" : ""}`}>{count}</span>}
    </button>
  );
}

/** Default departure for the new-shipment form: the next half hour after the simulation clock, in datetime-local format. */
function defaultDeparture(clockMs: number) {
  const base = clockMs ? clockMs + 30 * 60000 : Date.parse("2026-10-08T08:00:00+05:30");
  const ist = new Date(Math.ceil(base / 300000) * 300000 + 5.5 * 3600000).toISOString();
  return ist.slice(0, 16);
}

export { IST };
