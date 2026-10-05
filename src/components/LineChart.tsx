"use client";

import { useState } from "react";
import type { PointerEvent } from "react";
import { formatCompactMoney, formatMoney } from "./money";

export interface ChartSeries {
  label: string;
  valuesPaise: Array<number | null>;
  color?: string;
}

export interface LineChartProps {
  title: string;
  subtitle?: string;
  labels: string[];
  series: ChartSeries[];
}

const palette = ["#2c7055", "#d18a4b", "#6887a8", "#8c69ac"];
const chartWidth = 760;
const chartHeight = 290;
const bounds = { left: 72, right: 22, top: 24, bottom: 38 };

export function LineChart({ title, subtitle, labels, series }: LineChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const count = labels.length;
  const availableValues = series.flatMap((item) => item.valuesPaise.filter((value): value is number => value !== null && Number.isFinite(value)));
  const empty = count === 0 || availableValues.length === 0;
  const selectedIndex = Math.min(activeIndex ?? count - 1, count - 1);
  const minValue = empty ? 0 : Math.min(0, ...availableValues);
  const maxValue = empty ? 1 : Math.max(0, ...availableValues);
  const valueSpan = maxValue === minValue ? 1 : maxValue - minValue;
  const plotWidth = chartWidth - bounds.left - bounds.right;
  const plotHeight = chartHeight - bounds.top - bounds.bottom;
  const x = (index: number) => bounds.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const y = (value: number) => bounds.top + (1 - (value - minValue) / valueSpan) * plotHeight;

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (count < 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const viewBoxX = ((event.clientX - rect.left) / rect.width) * chartWidth;
    const index = count <= 1 ? 0 : Math.round(((viewBoxX - bounds.left) / plotWidth) * (count - 1));
    setActiveIndex(Math.max(0, Math.min(count - 1, index)));
  }

  const tickIndexes = [...new Set([0, Math.round((count - 1) / 3), Math.round(((count - 1) * 2) / 3), count - 1])].filter((index) => index >= 0);

  return (
    <section className="line-chart-card" aria-label={title}>
      <div className="line-chart-header">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {!empty && <div className="line-chart-selection" aria-live="polite">
          <span>{labels[selectedIndex]}</span>
          <div>{series.map((item, index) => {
            const value = item.valuesPaise[selectedIndex];
            return <span key={`${item.label}-${index}`}><i style={{ backgroundColor: item.color || palette[index % palette.length] }} />{item.label}: <strong>{value === null || value === undefined ? "No value" : formatMoney(value)}</strong></span>;
          })}</div>
        </div>}
      </div>

      {empty ? <p className="line-chart-empty">No history yet. Your graph will appear after you add records.</p> : <>
        <svg
          className="line-chart-svg"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}. ${series.map((item) => `${item.label}: ${item.valuesPaise.map((value, index) => `${labels[index]} ${value === null || value === undefined ? "no value" : formatMoney(value)}`).join(", ")}`).join(". ")}`}
          onPointerMove={handlePointerMove}
        >
          {[0, 1, 2, 3].map((tick) => {
            const value = maxValue - (valueSpan * tick) / 3;
            const yPosition = bounds.top + (plotHeight * tick) / 3;
            return <g key={tick}><line className="line-chart-grid" x1={bounds.left} x2={chartWidth - bounds.right} y1={yPosition} y2={yPosition} /><text className="line-chart-axis-label" x={bounds.left - 12} y={yPosition + 4} textAnchor="end">{formatCompactMoney(value)}</text></g>;
          })}
          {tickIndexes.map((index) => <text className="line-chart-axis-label" key={index} x={x(index)} y={chartHeight - 10} textAnchor="middle">{labels[index]}</text>)}
          {series.map((item, seriesIndex) => {
            let hasPreviousPoint = false;
            const path = item.valuesPaise.slice(0, count).map((value, index) => {
              if (value === null || value === undefined || !Number.isFinite(value)) {
                hasPreviousPoint = false;
                return "";
              }
              const command = `${hasPreviousPoint ? "L" : "M"} ${x(index)} ${y(value)}`;
              hasPreviousPoint = true;
              return command;
            }).filter(Boolean).join(" ");
            const selectedValue = item.valuesPaise[selectedIndex];
            const color = item.color || palette[seriesIndex % palette.length];
            return <g key={`${item.label}-${seriesIndex}`}>
              <path d={path} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {selectedValue !== null && selectedValue !== undefined && Number.isFinite(selectedValue) && <circle cx={x(selectedIndex)} cy={y(selectedValue)} r="5" fill={color} stroke="#fff" strokeWidth="2.5"><title>{`${item.label}, ${labels[selectedIndex]}: ${formatMoney(selectedValue)}`}</title></circle>}
            </g>;
          })}
          <line className="line-chart-cursor" x1={x(selectedIndex)} x2={x(selectedIndex)} y1={bounds.top} y2={chartHeight - bounds.bottom} />
        </svg>
        <div className="line-chart-legend">{series.map((item, index) => <span key={`${item.label}-${index}`}><i style={{ backgroundColor: item.color || palette[index % palette.length] }} />{item.label}</span>)}</div>
      </>}
    </section>
  );
}
