import type { NextRequest } from 'next/server';
import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { buildCombinedTemplate, buildPropertyTemplate } from '@/lib/import/templates';

export const dynamic = 'force-dynamic';

/** GET /api/v1/import/templates/properties?combined=true — downloadable .xlsx template. */
export async function GET(request: NextRequest) {
  try {
    await requireApiPermission('properties:manage');
    const combined = request.nextUrl.searchParams.get('combined') === 'true';
    const buffer = combined ? await buildCombinedTemplate() : await buildPropertyTemplate();
    const filename = combined ? 'riftara-property-unit-import-template.xlsx' : 'riftara-property-import-template.xlsx';

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
