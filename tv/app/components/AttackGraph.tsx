"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GNode, GLink } from "@/lib/arenaState";

interface FN { id: string; label: string; kind: string; owned: boolean; flagged: boolean; shielded: boolean; bornAt: number; x?: number; y?: number; fx?: number; fy?: number; }
interface FL { source: any; target: any; active: boolean; }

const KIND_COLOR: Record<string, string> = {
  host: "#2e90ff", service: "#6fb4ff", cred: "#ff3b50", db: "#b06bff", file: "#ffcf4a",
};

export default function AttackGraph({ nodes, links }: { nodes: GNode[]; links: GLink[] }) {
  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // canonical graph objects — identity is preserved so x/y/vx/vy survive updates
  const data = useRef<{ nodes: FN[]; links: FL[] }>({ nodes: [], links: [] });
  const activeIds = useRef<Set<string>>(new Set()); // endpoints of active (attacking) links
  const [version, setVersion] = useState(0);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  // fold incoming state into the canonical objects without replacing identities
  useEffect(() => {
    const d = data.current;
    let structural = false;
    const byId = new Map(d.nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      const ex = byId.get(n.id);
      if (ex) { ex.owned = n.owned; ex.flagged = n.flagged; ex.shielded = n.shielded; ex.label = n.label; }
      else {
        const fn: FN = { id: n.id, label: n.label, kind: n.kind, owned: n.owned, flagged: n.flagged, shielded: n.shielded, bornAt: n.bornAt };
        if (n.id === "target") { fn.fx = 0; fn.fy = 0; }
        d.nodes.push(fn); byId.set(n.id, fn); structural = true;
      }
    }
    const keep = new Set(nodes.map((n) => n.id));
    if (d.nodes.some((n) => !keep.has(n.id))) {
      d.nodes = d.nodes.filter((n) => keep.has(n.id));
      d.links = d.links.filter((l) => keep.has(srcId(l.source)) && keep.has(srcId(l.target)));
      structural = true;
    }
    for (const l of links) {
      const ex = d.links.find((x) => srcId(x.source) === l.source && srcId(x.target) === l.target);
      if (ex) ex.active = l.active;
      else { d.links.push({ source: l.source, target: l.target, active: l.active }); structural = true; }
    }
    const act = new Set<string>();
    for (const l of d.links) if (l.active) { act.add(srcId(l.target)); act.add(srcId(l.source)); }
    activeIds.current = act;
    if (structural) setVersion((v) => v + 1);
  }, [nodes, links]);

  const graphData = useMemo(() => ({ nodes: data.current.nodes.slice(), links: data.current.links.slice() }), [version]);

  // spread the nodes (stronger repulsion + longer links) so a 20+ node ring does
  // not crowd; then fit. Re-applied whenever the topology grows.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || typeof fg.d3Force !== "function") return;
    fg.d3Force("charge")?.strength(-210).distanceMax(420);
    fg.d3Force("link")?.distance(95).strength(0.5);
    if (typeof fg.d3ReheatSimulation === "function") fg.d3ReheatSimulation();
    const t = setTimeout(() => {
      if (typeof fg.zoomToFit === "function") fg.zoomToFit(700, 64);
      setTimeout(() => { if (typeof fg.zoom === "function" && fg.zoom() > 2.6) fg.zoom(2.6, 400); }, 720);
    }, 160);
    return () => clearTimeout(t);
  }, [version, size]);

  const drawNode = useMemo(() => (node: FN, ctx: CanvasRenderingContext2D, scale: number) => {
    const now = performance.now();
    const age = Math.min(1, (now - node.bornAt) / 600);
    const isTarget = node.id === "target";
    const active = activeIds.current.has(node.id);
    const base = node.owned ? "#ff3b50" : node.shielded ? "#2e90ff" : KIND_COLOR[node.kind] || "#6fb4ff";
    const r = isTarget ? 7 : node.owned || node.shielded || active ? 5 : 3.6;
    const x = node.x || 0, y = node.y || 0;
    // dim the quiet nodes so the hotspots read
    const quiet = !isTarget && !node.owned && !node.shielded && !node.flagged && !active;
    ctx.globalAlpha = age * (quiet ? 0.7 : 1);

    const pulse = node.owned ? 0.6 + 0.4 * Math.sin(now / 180) : 0.4;
    const halo = quiet ? r * 2.4 : r * 4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
    g.addColorStop(0, hexA(base, (quiet ? 0.28 : 0.5) * pulse));
    g.addColorStop(1, hexA(base, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, halo, 0, Math.PI * 2); ctx.fill();

    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = base; ctx.fill();
    ctx.lineWidth = 1.2 / scale; ctx.strokeStyle = "#070a12"; ctx.stroke();

    if (node.shielded) {
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = hexA("#2e90ff", 0.55 + 0.4 * Math.sin(now / 240));
      ctx.lineWidth = 2 / scale; ctx.stroke();
    }
    if (node.flagged && !node.shielded) {
      ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = hexA("#ffcf4a", 0.85); ctx.setLineDash([2 / scale, 2 / scale]);
      ctx.lineWidth = 1.4 / scale; ctx.stroke(); ctx.setLineDash([]);
    }

    // LABELS: only the target + hotspots get one (owned / shielded / flagged /
    // actively under attack). Everything else stays a dot, so labels never pile up.
    const labeled = isTarget || node.owned || node.shielded || node.flagged || active;
    if (labeled) {
      const text = node.label.slice(0, isTarget ? 18 : 20);
      const px = (isTarget ? 10 : 8.5) / scale;
      ctx.font = `600 ${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const tw = ctx.measureText(text).width;
      const padX = 4 / scale, padY = 2.4 / scale;
      const ty = y + r + 4 / scale;
      // dark pill behind the text for legibility over lines + glow
      ctx.globalAlpha = age;
      ctx.beginPath();
      (ctx as any).roundRect(x - tw / 2 - padX, ty - padY, tw + padX * 2, px + padY * 2, 3 / scale);
      ctx.fillStyle = "rgba(7,10,18,0.78)"; ctx.fill();
      ctx.fillStyle = node.owned ? "#ffb3bd" : node.shielded ? "#9ecbff" : node.flagged ? "#ffe39a" : "#dbe5f5";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(text, x, ty);
    }
    ctx.globalAlpha = 1;
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        graphData={graphData}
        cooldownTicks={Infinity}
        d3AlphaDecay={0.022}
        d3VelocityDecay={0.36}
        warmupTicks={40}
        nodeRelSize={5}
        nodeCanvasObject={drawNode as any}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(node.x, node.y, 8, 0, Math.PI * 2); ctx.fill();
        }}
        linkColor={(l: any) => (l.active ? "rgba(255,59,80,0.6)" : "rgba(110,180,255,0.14)")}
        linkWidth={(l: any) => (l.active ? 1.6 : 0.5)}
        linkDirectionalParticles={(l: any) => (l.active ? 3 : 0)}
        linkDirectionalParticleWidth={2.2}
        linkDirectionalParticleColor={() => "#ff6b7b"}
        linkDirectionalParticleSpeed={0.012}
        enableNodeDrag={false}
        enableZoomInteraction={false}
        enablePanInteraction={false}
      />
    </div>
  );
}

function srcId(s: any): string { return typeof s === "object" && s ? s.id : s; }
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
