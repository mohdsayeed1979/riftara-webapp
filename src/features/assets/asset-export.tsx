'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * Export menu for the asset register. Links point at the org/scope/permission-
 * enforced API routes and carry the current register filters so the export
 * matches what the user sees. Downloads run as normal browser GETs.
 */
export function AssetExportMenu({ query }: { query: string }) {
  const qs = query ? `&${query}` : '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Download />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Asset Register</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={`/api/v1/assets/export?format=xlsx${qs}`}>Excel (.xlsx)</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/api/v1/assets/export?format=csv${qs}`}>CSV</a>
        </DropdownMenuItem>
        <DropdownMenuLabel>Maintenance Report</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={`/api/v1/assets/maintenance/export?format=xlsx${qs}`}>Excel (.xlsx)</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/api/v1/assets/maintenance/export?format=csv${qs}`}>CSV</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
