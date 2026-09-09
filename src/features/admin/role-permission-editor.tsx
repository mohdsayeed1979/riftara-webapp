'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setRolePermissionsAction } from '@/app/(app)/roles/actions';

export interface PermissionCatalogEntry { key: string; module: string; action: string }

/** Permission matrix editor for a custom role. Non-assignable permissions
 *  (outside the actor's own rights) are disabled; the server independently
 *  enforces the actor-subset rule. */
export function RolePermissionEditor({
  roleId,
  catalog,
  assignableKeys,
  currentKeys,
  readOnly = false,
}: {
  roleId: string;
  catalog: PermissionCatalogEntry[];
  assignableKeys: string[];
  currentKeys: string[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(currentKeys));
  const [pending, start] = useTransition();
  const assignable = useMemo(() => new Set(assignableKeys), [assignableKeys]);

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionCatalogEntry[]>();
    for (const p of catalog) map.set(p.module, [...(map.get(p.module) ?? []), p]);
    return Array.from(map.entries());
  }, [catalog]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function save() {
    start(async () => {
      const result = await setRolePermissionsAction(roleId, Array.from(selected));
      if (result.ok) { toast.success('Permissions updated.'); router.refresh(); }
      else toast.error(result.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {grouped.map(([module, perms]) => (
          <div key={module} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-3">
            <p className="mb-2 text-[12px] font-semibold capitalize text-[var(--color-text-secondary)]">{module.replace(/_/g, ' ')}</p>
            <div className="flex flex-col gap-1.5">
              {perms.map((p) => {
                const checked = selected.has(p.key);
                const locked = readOnly || (!assignable.has(p.key) && !checked);
                return (
                  <label key={p.key} className={`flex items-center gap-2 text-[12.5px] ${locked ? 'opacity-50' : ''}`}>
                    <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggle(p.key)} />
                    <span className="capitalize">{p.action.replace(/_/g, ' ')}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {!readOnly ? (
        <div className="flex justify-end">
          <Button loading={pending} onClick={save}><Save />Save Permissions</Button>
        </div>
      ) : null}
    </div>
  );
}
