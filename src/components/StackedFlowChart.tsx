"use client";

import { useState } from "react";
import type { PointerEvent } from "react";
import type { MonthlyFlow } from "@/lib/dashboard";
import { formatCompactMoney, formatMoney } from "./money";

const colors = ["#266b50", "#70a887", "#a8c8a4", "#5e81a4", "#d18745", "#cfaa72", "#8d72a5", "#bf817d"];
const incomeColor = "#173d30";
const width = 800;
const height = 340;
const left = 56;
const right = 18;
const top = 24;
const bottom = 36;

function shortMonth(month: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
}

function categories(flows: MonthlyFlow[]) {
  const totals = new Map<string, number>();
  for (const flow of flows) for (const [name, value] of Object.entries(flow.uses)) totals.set(name, (totals.get(name) || 0) + value);
  const ordered = [...totals].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return ordered.length > 6 ? [...ordered.slice(0, 5), "Other categories"] : ordered;
}

function valueFor(flow: MonthlyFlow, category: string, visible: string[]) {
  if (category === "Other categories") return Object.entries(flow.uses).filter(([name]) => !visible.includes(name)).reduce((sum, [, value]) => sum + value, 0);
  return flow.uses[category] || 0;
}

export function StackedFlowChart({ flows }: { flows: MonthlyFlow[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const selected = Math.min(activeIndex ?? flows.length - 1, flows.length - 1);
  const useCategories = categories(flows);
  const hasActivity = flows.some(flow => Object.values(flow.income).some(Boolean) || Object.values(flow.uses).some(Boolean));
  const max = Math.max(1, ...flows.flatMap(flow => [Object.values(flow.income).reduce((a, b) => a + b, 0), Object.values(flow.uses).reduce((a, b) => a + b, 0)]));
  const x = (index: number) => left + (flows.length < 2 ? (width - left - right) / 2 : index * (width - left - right) / (flows.length - 1));
  const y = (value: number) => height - bottom - value / max * (height - bottom - top);

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = (event.clientX - rect.left) / rect.width * width;
    const index = flows.length < 2 ? 0 : Math.round((point - left) / (width - left - right) * (flows.length - 1));
    setActiveIndex(Math.max(0, Math.min(flows.length - 1, index)));
  }

  function areaPath(category: string, categoryIndex: number) {
    const lower = flows.map(flow => useCategories.slice(0, categoryIndex).reduce((sum, name) => sum + valueFor(flow, name, useCategories), 0));
    const upper = flows.map((flow, index) => lower[index] + valueFor(flow, category, useCategories));
    return `M ${flows.map((_, index) => `${x(index)} ${y(upper[index])}`).join(" L ")} L ${flows.map((_, reverse) => { const index = flows.length - reverse - 1; return `${x(index)} ${y(lower[index])}`; }).join(" L ")} Z`;
  }

  const selectedFlow = flows[selected];
  const incomeTotal = selectedFlow ? Object.values(selectedFlow.income).reduce((a, b) => a + b, 0) : 0;
  const useTotal = selectedFlow ? Object.values(selectedFlow.uses).reduce((a, b) => a + b, 0) : 0;
  const ticks = [...new Set([0, Math.round((flows.length - 1) / 3), Math.round((flows.length - 1) * 2 / 3), flows.length - 1])].filter(index => index >= 0);

  const incomePath = flows.map((flow, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(Object.values(flow.income).reduce((a, b) => a + b, 0))}`).join(" ");

  return <section className="line-chart-card" aria-label="Monthly income and uses">
    <div className="line-chart-header"><div><h2>Monthly income vs uses</h2><p>Income is a line. Expenses, investments and new goal savings form one stacked area from zero; unprocessed plans are excluded.</p></div>
      {selectedFlow && <div className="line-chart-selection" aria-live="polite"><span>{shortMonth(selectedFlow.month)}</span><div><span>Income: <strong>{formatMoney(incomeTotal)}</strong></span><span>Used: <strong>{formatMoney(useTotal)}</strong></span></div></div>}
    </div>
    {!hasActivity ? <p className="line-chart-empty">Record income or a use of money to start this graph.</p> : <>
      <svg className="line-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly income line and stacked uses area sharing a zero baseline" onPointerMove={onPointerMove}>
        {[0, 0.25, 0.5, 0.75, 1].map(fraction => <g key={fraction}><line className="line-chart-grid" x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} /><text className="line-chart-axis-label" x={left - 8} y={y(max * fraction) + 4} textAnchor="end">{formatCompactMoney(max * fraction)}</text></g>)}
        {useCategories.map((category, index) => <path key={`uses-${category}`} d={areaPath(category, index)} fill={colors[index % colors.length]}><title>{`Use: ${category}`}</title></path>)}
        <path d={incomePath} fill="none" stroke={incomeColor} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"><title>Monthly income</title></path>
        {ticks.map(index => <text className="line-chart-axis-label" key={index} x={x(index)} y={height - 5} textAnchor="middle">{shortMonth(flows[index].month)}</text>)}
        <line className="line-chart-cursor" x1={x(selected)} x2={x(selected)} y1={top} y2={height - bottom} />
        {selectedFlow && <circle cx={x(selected)} cy={y(incomeTotal)} r="5" fill={incomeColor} stroke="#fff" strokeWidth="2.5"><title>{`${shortMonth(selectedFlow.month)} income: ${formatMoney(incomeTotal)}`}</title></circle>}
      </svg>
      <div className="flow-legend"><div><strong>Line</strong><span><i style={{ backgroundColor: incomeColor }} />Total income</span></div><div><strong>Stacked area</strong>{useCategories.map((category, index) => <span key={category}><i style={{ backgroundColor: colors[index % colors.length] }} />{category}</span>)}</div></div>
      {selectedFlow && <div className="flow-selected-details"><strong>{shortMonth(selectedFlow.month)} details</strong><div>{[...Object.entries(selectedFlow.income).map(([name, value]) => [name, value, "Income"] as const), ...Object.entries(selectedFlow.uses).map(([name, value]) => [name, value, "Use"] as const)].sort((a, b) => b[1] - a[1]).map(([name, value, group]) => <span key={`${group}-${name}`}>{group} · {name}: <strong>{formatMoney(value)}</strong></span>)}</div></div>}
    </>}
  </section>;
}
