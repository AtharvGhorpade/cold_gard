"use client";

import { useState } from "react";
import type { Excursion, ShipmentMeta, ShipmentState } from "@/lib/detector";
import { SCENARIOS } from "@/lib/replay";
import { fmtTime, headline, STATUS_COLOR, STATUS_LABEL, TYPE_LABEL } from "./status";

export function Verdict({ s }: { s: ShipmentState }) {
  const h = headline(s);
  return (
    <div className="verdict" style={{ borderLeftColor: STATUS_COLOR[s.status] }}>
      <div className="verdict-k" style={{ color: STATUS_COLOR[s.status] }}>
        {STATUS_LABEL[s.status]}
      </div>
      <div className="verdict-t">{h.title}</div>
      <div className="verdict-b">{h.body}</div>
    </div>
  );
}

export function Fact({ k, v, note, warn, bad, small }: { k: string; v: string; note?: string; warn?: boolean; bad?: boolean; small?: boolean }) {
  return (
    <div className="fact">
      <dt>{k}</dt>
      <dd className={`${small ? "small-v" : ""} ${bad ? "bad" : warn ? "warn" : ""}`}>{v}</dd>
      {note && <span className="note">{note}</span>}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      {(["OK", "AT_RISK", "ALERT", "NO_SIGNAL", "DELIVERED", "DISCARD"] as const).map((k) => (
        <span key={k}>
          <i style={{ background: STATUS_COLOR[k] }} />
          {STATUS_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

export function AlertList({
  excursions,
  metaById,
  onOpen,
  limit,
}: {
  excursions: Excursion[];
  metaById: Record<string, ShipmentMeta>;
  onOpen: (id: string) => void;
  limit?: number;
}) {
  const sorted = [...excursions].sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt));
  const items = limit ? sorted.slice(0, limit) : sorted;
  if (!items.length) return <p className="quiet">No confirmed alerts. An alert is raised as soon as a shipment stays outside its safe range.</p>;
  return (
    <ol className="alerts">
      {items.map((e) => (
        <li key={e.id} className={e.type === "FREEZE" ? "freeze" : ""} onClick={() => onOpen(e.shipment_id)}>
          <div className="al-top">
            <span className="num">{fmtTime(e.confirmedAt)}</span>
            <strong className="num">{e.shipment_id}</strong>
            <span className="muted">{metaById[e.shipment_id]?.vaccine}</span>
            {e.injected && <span className="tag">simulated</span>}
          </div>
          <div>
            {e.type === "FREEZE" ? "Frozen. Discard" : TYPE_LABEL[e.type]} · peak {e.peakTempC.toFixed(1)} °C · {e.durationMin} min
          </div>
          {e.alert && (
            <div className="al-act">
              Divert to {e.alert.checkpointName}, {e.alert.distKm} km, about {e.alert.etaMin} min
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Injector({ shipments, onInject, notice }: { shipments: ShipmentMeta[]; onInject: (id: string, sc: string) => void; notice: string }) {
  const [target, setTarget] = useState(shipments[0]?.shipment_id ?? "SHP-1004");
  return (
    <details className="injector">
      <summary>
        <span className="serif">Simulate a fault</span>
        <span className="meta">for demonstrations</span>
      </summary>
      <div className="inj-body">
        <label className="meta" htmlFor="inj">
          Shipment
        </label>
        <select id="inj" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          {shipments.map((s) => (
            <option key={s.shipment_id} value={s.shipment_id}>
              {s.shipment_id} · {s.vaccine}
            </option>
          ))}
        </select>
        <div className="inj-grid">
          {Object.entries(SCENARIOS).map(([k, sc]) => (
            <button key={k} className="btn" onClick={() => onInject(target, k)}>
              {sc.label}
            </button>
          ))}
        </div>
        {notice && <p className="notice">{notice}</p>}
      </div>
    </details>
  );
}
