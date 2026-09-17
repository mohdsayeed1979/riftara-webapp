import { requireApiPermission } from '@/lib/api/guard';
import { apiError } from '@/lib/api/response';
import { buildUnitTemplate } from '@/lib/import/templates';

export const dynamic = 'force-dynamic';

/** GET /api/v1/import/templates/units — downloadable .xlsx template. */
export async function GET() {
  try {
    await requireApiPermission('units:manage');
    const buffer = await buildUnitTemplate();
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="riftara-unit-import-template.xlsx"',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
