"use client";

import { useMemo, useState } from "react";
import type { CheckpointMeta, Profile } from "@/lib/detector";
import { routeDistanceKm, SENSOR_SCENARIOS, SIM_SPEED_KMH } from "@/lib/simulate";
import { fmtDateTime, IST } from "./status";

export interface NewForm {
  vaccine: string;
  doses: number;
  batch: string;
  origin: string;
  via: string[];
  destination: string;
  departure: string; // datetime-local, IST
  driver: string;
  vehicle: string;
  coldBox: string;
  sensorId: string;
  feed: "live" | "simulated";
  scenario: string;
}

interface Props {
  checkpoints: CheckpointMeta[];
  profiles: Record<string, Profile>;
  defaultDeparture: string;
  nowLabel: string;
  onCreate: (f: NewForm) => Promise<string | null>;
  onCancel: () => void;
}

export default function NewShipmentView({ checkpoints, profiles, defaultDeparture, nowLabel, onCreate, onCancel }: Props) {
  const vaccines = Object.entries(profiles);
  const [f, setF] = useState<NewForm>({
    vaccine: vaccines[0]?.[0] ?? "MR",
    doses: 10000,
    batch: "",
    origin: "CP-PUN-01",
    via: ["", ""],
    destination: "CP-HYD-01",
    departure: defaultDeparture,
    driver: "",
    vehicle: "",
    coldBox: "",
    sensorId: "",
    feed: "live",
    scenario: "normal",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NewForm>(k: K, v: NewForm[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const cps = useMemo(() => Object.fromEntries(checkpoints.map((c) => [c.id, c])), [checkpoints]);
  const route = [f.origin, ...f.via.filter(Boolean), f.destination].filter(Boolean);
  const distance = route.length > 1 && route.every((id) => cps[id]) ? routeDistanceKm(route, cps) : 0;
  const hours = distance / SIM_SPEED_KMH;
  const profile = profiles[f.vaccine];
  const departMs = f.departure ? Date.parse(`${f.departure}:00+05:30`) : NaN;
  const arrivalMs = departMs + hours * 3600000;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await onCreate({ ...f, batch: f.batch || autoBatch(f.vaccine) });
    setBusy(false);
    setError(err);
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>New shipment</h1>
          <p className="lede">Add a consignment to the fleet. It appears on the map when its first sensor reading arrives. Simulation time is {nowLabel}.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={onCancel}>
            Back to fleet
          </button>
        </div>
      </header>

      <form className="form-grid" onSubmit={submit}>
        <div className="form-main">
          <section className="panel">
            <h2>Consignment</h2>
            <div className="fields">
              <Field label="Vaccine" wide>
                <select className="input" value={f.vaccine} onChange={(e) => set("vaccine", e.target.value)}>
                  {vaccines.map(([k, p]) => (
                    <option key={k} value={k}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Doses">
                <input className="input num" type="number" min={1} step={1} value={f.doses} onChange={(e) => set("doses", Number(e.target.value))} />
              </Field>
              <Field label="Batch number" hint="Leave blank to generate">
                <input className="input num" value={f.batch} placeholder={autoBatch(f.vaccine)} onChange={(e) => set("batch", e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="panel">
            <h2>Route</h2>
            <div className="fields">
              <Field label="Origin">
                <CheckpointSelect value={f.origin} onChange={(v) => set("origin", v)} checkpoints={checkpoints} />
              </Field>
              <Field label="Destination">
                <CheckpointSelect value={f.destination} onChange={(v) => set("destination", v)} checkpoints={checkpoints} />
              </Field>
              {f.via.map((v, i) => (
                <Field key={i} label={`Stop ${i + 1}`} hint={i === 0 ? "Optional" : undefined}>
                  <CheckpointSelect
                    value={v}
                    optional
                    onChange={(nv) => set("via", f.via.map((x, j) => (j === i ? nv : x)))}
                    checkpoints={checkpoints}
                  />
                </Field>
              ))}
            </div>
            <p className="meta">Stops are visited in the order shown. Distances are straight-line segments between checkpoints.</p>
          </section>

          <section className="panel">
            <h2>Data source</h2>
            <p className="meta">For the live demo, the ESP32 posts the real cold-box temperature. StayCold adds simulated humidity, route progress and battery readings for the shipment.</p>
            <div className="choice">
              <label className={f.feed === "live" ? "opt on" : "opt"}>
                <input type="radio" name="feed" checked={f.feed === "live"} onChange={() => set("feed", "live")} />
                Live sensor (ESP32)
              </label>
              <label className={f.feed === "simulated" ? "opt on" : "opt"}>
                <input type="radio" name="feed" checked={f.feed === "simulated"} onChange={() => set("feed", "simulated")} />
                Simulated (demo only)
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>Schedule and handling</h2>
            <div className="fields">
              <Field label="Departure (IST)" hint="Must be after the current simulation time">
                <input className="input num" type="datetime-local" value={f.departure} onChange={(e) => set("departure", e.target.value)} />
              </Field>
              <Field label="Cold box ID">
                <input className="input num" value={f.coldBox} placeholder="CB-07" onChange={(e) => set("coldBox", e.target.value)} />
              </Field>
              <Field label={f.feed === "live" ? "Sensor ID (required)" : "Sensor ID"} hint={f.feed === "live" ? "Printed on the ESP32 device" : undefined}>
                <input className="input num" value={f.sensorId} placeholder="TL-2210" onChange={(e) => set("sensorId", e.target.value)} />
              </Field>
              <Field label="Driver">
                <input className="input" value={f.driver} placeholder="Name" onChange={(e) => set("driver", e.target.value)} />
              </Field>
              <Field label="Vehicle registration">
                <input className="input num" value={f.vehicle} placeholder="MH 12 AB 1234" onChange={(e) => set("vehicle", e.target.value)} />
              </Field>
            </div>
          </section>

          {f.feed === "simulated" && (
          <section className="panel">
            <h2>Simulated sensor behaviour</h2>
            <p className="meta">Telemetry for this shipment is generated in the browser so the demo stays self-contained. Pick how the cold box should behave.</p>
            <div className="choice">
              {Object.entries(SENSOR_SCENARIOS).map(([k, label]) => (
                <label key={k} className={f.scenario === k ? "opt on" : "opt"}>
                  <input type="radio" name="scenario" value={k} checked={f.scenario === k} onChange={() => set("scenario", k)} />
                  {label}
                </label>
              ))}
            </div>
          </section>
          )}

          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn solid" disabled={busy}>
              {busy ? "Registering…" : "Create shipment"}
            </button>
          </div>
        </div>

        <aside className="form-side">
          <section className="panel sticky">
            <h2>Summary</h2>
            <dl className="sum">
              <div>
                <dt>Vaccine</dt>
                <dd>{profile?.name ?? "–"}</dd>
              </div>
              <div>
                <dt>Safe range</dt>
                <dd className="num">{profile ? `${profile.min_c} to ${profile.max_c} °C` : "–"}</dd>
              </div>
              <div>
                <dt>Freezing limit</dt>
                <dd className="num">{profile?.freeze_damage_below_c == null ? "Not freeze-damaged" : `${profile.freeze_damage_below_c} °C`}</dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd className="num">{distance ? `${distance.toFixed(0)} km` : "–"}</dd>
              </div>
              <div>
                <dt>Estimated duration</dt>
                <dd className="num">{distance ? `${Math.floor(hours)} h ${Math.round((hours % 1) * 60)} min` : "–"}</dd>
              </div>
              <div>
                <dt>Expected arrival</dt>
                <dd className="num">{Number.isFinite(arrivalMs) && distance ? fmtDateTime(arrivalMs) + " IST" : "–"}</dd>
              </div>
            </dl>
            <div className="sub-head">Route</div>
            <ol className="route-list">
              {route.map((id, i) => (
                <li key={`${id}-${i}`}>
                  <span className="num">{i === 0 ? "Start" : i === route.length - 1 ? "End" : `Stop ${i}`}</span>
                  <span>{cps[id]?.name ?? "Choose a checkpoint"}</span>
                </li>
              ))}
            </ol>
            <p className="meta">Timezone {IST}. Telemetry every 5 simulated minutes.</p>
          </section>
        </aside>
      </form>
    </div>
  );
}

function autoBatch(vaccine: string) {
  return `B-${vaccine}-${new Date().getFullYear().toString().slice(2)}${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 900) + 100)}`;
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span className="field-l">{label}</span>
      {children}
      {hint && <span className="meta">{hint}</span>}
    </label>
  );
}

function CheckpointSelect({ value, onChange, checkpoints, optional }: { value: string; onChange: (v: string) => void; checkpoints: CheckpointMeta[]; optional?: boolean }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{optional ? "None" : "Choose…"}</option>
      {checkpoints.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
