'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

interface City { id: string; name: string }
interface Building { id: string; name: string; cityId: string; propertyId: string }
interface Unit { id: string; name: string; buildingId: string | null; propertyId: string; cityId: string }

/**
 * Hierarchical City → Building → Unit dashboard filters. State lives in the URL
 * (?city=&building=&unit=) alongside the existing ?period=, so refresh, sharing
 * and back/forward all work. Selections cascade and reset invalid children.
 */
export function DashboardScopeFilters({
  cities,
  buildings,
  units,
  cityId,
  buildingId,
  unitId,
}: {
  cities: City[];
  buildings: Building[];
  units: Unit[];
  cityId: string | null;
  buildingId: string | null;
  unitId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const push = useCallback(
    (next: { city?: string | null; building?: string | null; unit?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(qs ? `/dashboard?${qs}` : '/dashboard');
    },
    [router, searchParams],
  );

  // Options cascade to the current parent selection.
  const buildingOptions = buildings.filter((b) => !cityId || b.cityId === cityId).map((b) => ({ id: b.id, name: b.name }));
  const unitOptions = units
    .filter((u) => (buildingId ? u.buildingId === buildingId : !cityId || u.cityId === cityId))
    .map((u) => ({ id: u.id, name: u.name }));

  const hasFilters = Boolean(cityId || buildingId || unitId);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="City">
        {/* Changing city clears building + unit. */}
        <NativeSelect value={cityId ?? ''} onChange={(v) => push({ city: v || null, building: null, unit: null })} placeholder="All Cities" options={cities} />
      </Field>
      <Field label="Building">
        {/* Selecting a building sets its city and clears unit. */}
        <NativeSelect
          value={buildingId ?? ''}
          onChange={(v) => {
            const b = buildings.find((x) => x.id === v);
            push({ city: b?.cityId ?? cityId ?? null, building: v || null, unit: null });
          }}
          placeholder="All Buildings"
          options={buildingOptions}
        />
      </Field>
      <Field label="Unit">
        {/* Selecting a unit sets its building + city. */}
        <NativeSelect
          value={unitId ?? ''}
          onChange={(v) => {
            const u = units.find((x) => x.id === v);
            push({ city: u?.cityId ?? cityId ?? null, building: u?.buildingId ?? buildingId ?? null, unit: v || null });
          }}
          placeholder="All Units"
          options={unitOptions}
        />
      </Field>
      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={() => push({ city: null, building: null, unit: null })} title="Clear City/Building/Unit; keeps the date range">
          <X />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">{label}</span>
      <div className="min-w-[150px]">{children}</div>
    </label>
  );
}
