'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Geographic portfolio map (BRD 68).
 *
 * The default provider renders a lightweight vector outline of Saudi Arabia so
 * the map works with no API key and no external tile requests. Configure
 * MAP_PROVIDER=google|mapbox to swap in a tiled provider — the component
 * contract (city markers with a metric) stays the same.
 */

export interface MapMarker {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Primary figure shown under the city name. */
  value: number;
  valueLabel: string;
  href?: string;
}

/** Bounding box of the Kingdom used to project lat/lng onto the viewBox. */
const BOUNDS = { minLng: 34.5, maxLng: 55.7, minLat: 16.0, maxLat: 32.2 };
const VIEW = { width: 420, height: 320 };

/** Simplified national outline — sufficient for an at-a-glance portfolio map. */
const SAUDI_OUTLINE =
  'M63 108 L84 79 L112 63 L139 57 L163 66 L182 60 L201 66 L214 57 L232 61 L253 55 L272 62 L296 60 L318 70 L340 84 L358 103 L372 124 L381 148 L372 166 L352 172 L338 187 L330 205 L312 219 L286 229 L262 243 L241 258 L219 268 L196 272 L172 264 L152 249 L138 230 L124 209 L108 190 L92 171 L78 150 L66 130 Z';

function project(latitude: number, longitude: number): { x: number; y: number } {
  const x = ((longitude - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * VIEW.width;
  const y = VIEW.height - ((latitude - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * VIEW.height;
  return { x, y };
}

export function SaudiPortfolioMap({
  markers,
  className,
  emptyLabel = 'No locations to display',
}: {
  markers: MapMarker[];
  className?: string;
  emptyLabel?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);

  const plottable = markers.filter(
    (marker) => marker.latitude !== null && marker.longitude !== null,
  );
  const maxValue = Math.max(1, ...plottable.map((m) => m.value));

  return (
    <div className={cn('relative', className)}>
      <div className="absolute end-3 top-3 z-10 flex flex-col overflow-hidden rounded-[8px] border border-[var(--color-border-base)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          className="flex size-7 items-center justify-center text-[15px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="h-px bg-[var(--color-border-subtle)]" />
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
          className="flex size-7 items-center justify-center text-[15px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
          aria-label="Zoom out"
        >
          −
        </button>
      </div>

      {plottable.length === 0 ? (
        <div className="flex h-[260px] items-center justify-center text-[12.5px] text-[var(--color-text-secondary)]">
          {emptyLabel}
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className="h-[260px] w-full"
          role="img"
          aria-label={`Portfolio distribution across ${plottable.length} cities`}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
        >
          <path
            d={SAUDI_OUTLINE}
            fill="var(--color-surface-alt)"
            stroke="var(--color-border-strong)"
            strokeWidth={1}
            strokeLinejoin="round"
          />

          {plottable.map((marker) => {
            const { x, y } = project(marker.latitude as number, marker.longitude as number);
            const radius = 5 + (marker.value / maxValue) * 9;
            const isActive = activeId === marker.id;
            const content = (
              <g
                onMouseEnter={() => setActiveId(marker.id)}
                onMouseLeave={() => setActiveId(null)}
                className={marker.href ? 'cursor-pointer' : undefined}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={radius + 5}
                  fill="var(--color-espresso-800)"
                  opacity={isActive ? 0.16 : 0.08}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill="var(--color-espresso-800)"
                  stroke="var(--color-surface)"
                  strokeWidth={1.5}
                />
                <text
                  x={x + radius + 6}
                  y={y - 1}
                  fontSize={9.5}
                  fontWeight={600}
                  fill="var(--color-text-primary)"
                >
                  {marker.name}
                </text>
                <text x={x + radius + 6} y={y + 10} fontSize={8.5} fill="var(--color-text-secondary)">
                  {marker.valueLabel}
                </text>
              </g>
            );

            return marker.href ? (
              <Link key={marker.id} href={marker.href}>
                {content}
              </Link>
            ) : (
              <g key={marker.id}>{content}</g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
