'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/misc';
import { setUserScopesAction } from '@/app/(app)/users/actions';

interface Option { id: string; name: string }

/** Assign property/city data scopes to a user. No scope = organization-wide.
 *  Only scopes the actor is authorized to grant are shown; the server also
 *  enforces the own-scope cap. */
export function ScopeAssignmentDialog({
  userId,
  properties,
  cities,
  currentPropertyIds,
  currentCityIds,
}: {
  userId: string;
  properties: Option[];
  cities: Option[];
  currentPropertyIds: string[];
  currentCityIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [props, setProps] = useState<Set<string>>(new Set(currentPropertyIds));
  const [selectedCities, setCities] = useState<Set<string>>(new Set(currentCityIds));
  const [pending, start] = useTransition();

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  }

  function save() {
    start(async () => {
      const result = await setUserScopesAction(userId, Array.from(props), Array.from(selectedCities));
      if (result.ok) { toast.success('Data scope updated.'); setOpen(false); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  function clear() { setProps(new Set()); setCities(new Set()); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><MapPin />Data Scope</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader title="Data Scope" description="Restrict this user to specific properties/cities. No scope means organization-wide access." />
        <DialogBody className="flex flex-col gap-4">
          {properties.length === 0 && cities.length === 0 ? (
            <EmptyState title="No assignable scopes" description="You can only delegate scopes within your own access." />
          ) : (
            <>
              {properties.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)]">Properties</p>
                  <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border-base)] p-2.5">
                    {properties.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={props.has(p.id)} onChange={() => toggle(props, setProps, p.id)} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {cities.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)]">Cities</p>
                  <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border-base)] p-2.5">
                    {cities.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={selectedCities.has(c.id)} onChange={() => toggle(selectedCities, setCities, c.id)} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <button type="button" onClick={clear} className="self-start text-[12px] text-[var(--color-info)] hover:underline">Clear all (organization-wide)</button>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
          <Button type="button" loading={pending} onClick={save} disabled={properties.length === 0 && cities.length === 0}>Save Scope</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
