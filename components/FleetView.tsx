"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { CheckpointMeta, Excursion, ShipmentMeta, ShipmentState } from "@/lib/detector";
import { headline, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from "./status";
import { AlertList, Injector, Legend } from "./parts";
import { countFilters, matchesShipment, SearchBar, type Filter } from "./search";

const TruckMap = dynamic(() => import("./TruckMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

interface Props {
  checkpoints: CheckpointMeta[];
  states: ShipmentState[];
  names: Record<string, string>;
  tickMs: number;
  excursions: Excursion[];
  metaById: Record<string, ShipmentMeta>;
  onOpen: (id: string) => void;
  onFleetReport: () => void;
  onInject: (id: string, scenario: string) => void;
  notice: string;
  onNewShipment: () => void;
  hasLive: boolean;
  onResetLive: () => void;
}

const ACTION = ["DISCARD", "ALERT", "NO_SIGNAL"] as const;

export default function FleetView(p: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const urgent = useMemo(
    () => p.states.filter((s) => (ACTION as readonly string[]).includes(s.status)).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [p.states],
  );
  const rows = useMemo(
    () =>
      p.states
        .filter((s) => matchesShipment(s, query, filter, p.names))
        .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [p.states, query, filter, p.names],
  );
  const counts = useMemo(() => countFilters(p.states, query, p.names), [p.states, query, p.names]);
  const inTransit = p.states.filter((s) => ["OK", "AT_RISK", "ALERT", "NO_SIGNAL"].includes(s.status)).length;
  const confirmed = p.excursions.filter((e) => !e.injected).length;

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Fleet</h1>
          <p className="lede">
            {inTransit} in transit · {p.states.filter((s) => s.status === "DELIVERED").length} delivered · {urgent.length
              ? `${urgent.length} need action`
              : "nothing needs action"}
          </p>
        </div>
        <div className="actions">
          {p.hasLive && (
            <button className="btn ghost" onClick={p.onResetLive}>
              R
            </button>
          )}
          <button className="btn" onClick={p.onFleetReport}>
            Fleet summary
          </button>
          <button className="btn solid" onClick={p.onNewShipment}>
            New shipment
          </button>
        </div>
      </header>

      {/* Alerts come first: they are the most important thing on this screen */}
      <section className="alert-zone" aria-label="Alerts">
        <div className="alert-cards">
          {urgent.length === 0 ? (
            <div className="all-clear">
              <span className="serif">No active alerts.</span>
              <span className="meta">Every shipment is inside its safe range or still on schedule.</span>
            </div>
          ) : (
            urgent.map((s) => {
              const h = headline(s);
              return (
                <article key={s.meta.shipment_id} className={`alert-card ${s.status === "DISCARD" ? "discard" : s.status === "NO_SIGNAL" ? "nosignal" : ""}`}>
                  <div className="ac-top">
                    <span className="ac-status">{STATUS_LABEL[s.status]}</span>
                    <span className="num">{s.meta.shipment_id}</span>
                  </div>
                  <h3 className="ac-title">{h.title}</h3>
                  <p className="ac-body">{h.body}</p>
                  <div className="ac-foot">
                    <span className="meta">
                      {s.profile.name} · batch <span className="num">{s.meta.batch}</span>
                    </span>
                    <button className="btn solid sm" onClick={() => p.onOpen(s.meta.shipment_id)}>
                      Open shipment
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <aside className="recent">
          <div className="panel-head">
            <h2 className="serif">Recent confirmed alerts</h2>
            <span className="meta">{confirmed} total</span>
          </div>
          <div className="alert-list-scroll" role="region" aria-label="Recent confirmed alerts">
            <AlertList excursions={p.excursions} metaById={p.metaById} onOpen={p.onOpen} />
          </div>
        </aside>
      </section>

      <div className="fleet-grid">
        <section className="panel map-panel">
          <div className="panel-head">
            <h2 className="serif">Routes</h2>
            <Legend />
          </div>
          <div className="map-frame">
            <TruckMap checkpoints={p.checkpoints} states={p.states} mode="fleet" selected={null} onSelect={p.onOpen} tickMs={p.tickMs} />
          </div>
          <p className="meta map-note">Dashed lines are planned routes. Solid lines are distance travelled. Click a truck to open its shipment.</p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="serif">Shipments</h2>
            <span className="meta">{rows.length} of {p.states.length}</span>
          </div>
          <SearchBar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} counts={counts} />
          <div className="shipment-list-scroll" role="region" aria-label="Shipment list" tabIndex={0}>
            <table className="table rows shipments">
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td className="quiet">No shipment matches “{query}”.</td>
                  </tr>
                )}
                {rows.map((s) => (
                  <tr key={s.meta.shipment_id} onClick={() => p.onOpen(s.meta.shipment_id)}>
                    <td className="sq">
                      <span style={{ background: STATUS_COLOR[s.status] }} />
                    </td>
                    <td>
                      <div className="id">{s.meta.shipment_id}</div>
                      <div className="sub">
                        {s.meta.vaccine} · {s.meta.driver ?? "–"}
                      </div>
                    </td>
                    <td>
                      <div>{STATUS_LABEL[s.status]}</div>
                      <div className="sub">{s.lastReading ? `${s.lastReading.temp_c.toFixed(1)} °C` : "no reading"}</div>
                    </td>
                    <td className="num r">
                      {s.frozen ? "0.00%" : `${s.viability.toFixed(1)}%`}
                      <div className="sub">potency</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Injector shipments={p.states.map((s) => s.meta)} onInject={p.onInject} notice={p.notice} />
    </div>
  );
}

