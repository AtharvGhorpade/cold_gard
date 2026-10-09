"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { buildRouteGeo, pointAtKm, type CheckpointMeta, type RouteGeo, type ShipmentState } from "@/lib/detector";
import { COLOR, STATUS_COLOR } from "./status";

interface Props {
  checkpoints: CheckpointMeta[];
  states: ShipmentState[];
  /** fleet: every route. single: only the selected shipment's route, with labelled stops. */
  mode: "fleet" | "single";
  selected: string | null;
  onSelect: (id: string) => void;
  /** Real milliseconds between telemetry ticks. Trucks glide along the route across this interval. */
  tickMs: number;
}

interface Layers {
  base: L.LayerGroup;
  routes: Map<string, L.Polyline>;
  trails: Map<string, L.Polyline>;
  trucks: Map<string, L.CircleMarker>;
  alert: L.Polyline | null;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** The road from the origin up to `km`, ending exactly at the truck's position. */
function travelled(g: RouteGeo, km: number): [number, number][] {
  const pts: [number, number][] = [g.pts[0]];
  for (let i = 1; i < g.cum.length && g.cum[i] <= km; i++) pts.push(g.pts[i]);
  pts.push(pointAtKm(g, km));
  return pts;
}

export default function TruckMap({ checkpoints, states, mode, selected, onSelect, tickMs }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const geoCache = useRef(new Map<string, RouteGeo>());
  const statesRef = useRef(states);
  const startRef = useRef(0);
  const selRef = useRef(selected);
  const modeRef = useRef(mode);
  const onSelRef = useRef(onSelect);
  const tickRef = useRef(tickMs);
  const cpRef = useRef(checkpoints);
  statesRef.current = states;
  selRef.current = selected;
  modeRef.current = mode;
  onSelRef.current = onSelect;
  tickRef.current = tickMs;
  cpRef.current = checkpoints;

  const geoFor = (s: ShipmentState) => {
    let g = geoCache.current.get(s.meta.shipment_id);
    if (!g) {
      const cps = Object.fromEntries(cpRef.current.map((c) => [c.id, c]));
      g = buildRouteGeo(s.meta.checkpoints, cps);
      geoCache.current.set(s.meta.shipment_id, g);
    }
    return g;
  };

  const routeKey = states.find((s) => s.meta.shipment_id === selected)?.meta.checkpoints.join("|") ?? "";

  const visible = (states: ShipmentState[]) =>
    mode === "single" ? states.filter((s) => s.meta.shipment_id === selected) : states;

  // Create the map once
  useEffect(() => {
    const cache = geoCache.current;
    const map = L.map(elRef.current!, { zoomControl: false, attributionControl: true }).setView([19.6, 76.4], 5);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 12,
    }).addTo(map);
    mapRef.current = map;
    layersRef.current = { base: L.layerGroup().addTo(map), routes: new Map(), trails: new Map(), trucks: new Map(), alert: null };
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      cache.clear();
    };
  }, []);

  // Checkpoints: all of them in fleet view, only the route's stops in single view
  useEffect(() => {
    const lay = layersRef.current;
    if (!lay) return;
    lay.base.clearLayers();
    const sel = states.find((s) => s.meta.shipment_id === selected);
    const onRoute = mode === "single" && sel ? new Set(sel.meta.checkpoints) : null;
    const dest = sel?.meta.destination_id;
    checkpoints.forEach((c) => {
      if (onRoute && !onRoute.has(c.id)) return;
      const isEnd = c.type === "origin" || (onRoute && c.id === dest);
      const m = L.circleMarker([c.lat, c.lon], {
        radius: onRoute ? 6 : 3.5,
        color: COLOR.ink,
        weight: 1.5,
        fillColor: isEnd ? COLOR.ink : COLOR.panel,
        fillOpacity: 1,
      }).addTo(lay.base);
      if (onRoute) m.bindTooltip(c.name, { permanent: true, direction: "right", offset: [8, 0], className: "stop-label" });
      else m.bindTooltip(c.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoints, mode, selected, routeKey]);

  // Routes, trails and trucks: add, remove and restyle when shipments or the selection change
  useEffect(() => {
    const map = mapRef.current;
    const lay = layersRef.current;
    if (!map || !lay) return;
    startRef.current = performance.now();
    const shown = visible(states);
    const ids = new Set(shown.map((s) => s.meta.shipment_id));
    const drop = <T extends { remove(): unknown }>(m: Map<string, T>) =>
      Array.from(m.entries()).forEach(([id, layer]) => {
        if (!ids.has(id)) {
          layer.remove();
          m.delete(id);
        }
      });
    drop(lay.routes);
    drop(lay.trails);
    drop(lay.trucks);

    shown.forEach((s) => {
      const id = s.meta.shipment_id;
      const isSel = id === selected;
      const color = STATUS_COLOR[s.status];
      const g = geoFor(s);

      if (!lay.routes.has(id)) lay.routes.set(id, L.polyline(g.pts, { color: "#9a9485", weight: 2, dashArray: "4 6" }).addTo(map));
      lay.routes.get(id)!.setStyle(
        mode === "single" ? { color: "#9a9485", weight: 3, dashArray: "2 6", opacity: 1 } : { color: "#9a9485", weight: 2, dashArray: "4 6", opacity: 0.9 },
      );

      if (!lay.trails.has(id)) lay.trails.set(id, L.polyline([], { weight: 4, lineCap: "round", lineJoin: "round" }).addTo(map));
      lay.trails.get(id)!.setStyle({ color, weight: isSel || mode === "single" ? 5 : 3.5, opacity: 1 });

      if (!lay.trucks.has(id)) {
        const mk = L.circleMarker(g.pts[0], { radius: 8, weight: 2 }).addTo(map);
        mk.on("click", () => onSelRef.current(id));
        mk.bindTooltip(`${id} · ${s.meta.vaccine} · ${s.status}`);
        lay.trucks.set(id, mk);
      }
      lay.trucks.get(id)!.setStyle({
        color: COLOR.ink,
        fillColor: color,
        fillOpacity: 1,
        radius: isSel || mode === "single" ? 11 : 8,
        weight: 2.5,
        dashArray: s.lastReading ? undefined : "2 3",
      });
    });

    // Dashed line from the selected truck to the checkpoint it should divert to
    lay.alert?.remove();
    lay.alert = null;
    const sel = states.find((s) => s.meta.shipment_id === selected);
    const cp = sel?.open?.alert ? cpRef.current.find((c) => c.id === sel.open!.alert!.checkpointId) : undefined;
    if (sel && sel.open && cp && sel.lastReading) {
      lay.alert = L.polyline([[cp.lat, cp.lon], [cp.lat, cp.lon]], { color: "#c2410c", weight: 2.5, dashArray: "7 6" }).addTo(map);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, selected, mode]);

  // Frame the view once per selection: the selected route in single view, all routes in fleet view
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "single") {
      const sel = statesRef.current.find((s) => s.meta.shipment_id === selRef.current);
      if (sel) map.fitBounds(L.latLngBounds(geoFor(sel).pts), { padding: [48, 48], maxZoom: 8 });
    } else {
      const all = statesRef.current.flatMap((s) => geoFor(s).pts);
      if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mode]);

  // Glide: each truck moves along its own route between the last two telemetry points
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const lay = layersRef.current;
      if (lay) {
        const t = Math.min(1, (performance.now() - startRef.current) / Math.max(1, tickRef.current));
        const e = ease(t);
        for (const s of visible(statesRef.current)) {
          const id = s.meta.shipment_id;
          const g = geoFor(s);
          const truck = lay.trucks.get(id);
          const trail = lay.trails.get(id);
          if (!s.lastReading) {
            truck?.setLatLng(g.pts[0]);
            trail?.setLatLngs([]);
            continue;
          }
          // Only progress along the route is interpolated, so the truck can never leave the road.
          const jump = Math.abs(s.progressKm - s.prevKm) > 80;
          const km = jump ? s.progressKm : s.prevKm + (s.progressKm - s.prevKm) * e;
          truck?.setLatLng(pointAtKm(g, km));
          trail?.setLatLngs(travelled(g, km));
        }
        if (lay.alert) {
          const sel = statesRef.current.find((s) => s.meta.shipment_id === selRef.current);
          const cp = cpRef.current.find((c) => c.id === sel?.open?.alert?.checkpointId);
          if (sel?.lastReading && cp) lay.alert.setLatLngs([pointAtKm(geoFor(sel), sel.progressKm), [cp.lat, cp.lon]]);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={elRef} className={`map ${mode === "single" ? "map-tall" : ""}`} />;
}
