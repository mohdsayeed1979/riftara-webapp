import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CreateChecklistTemplateButton } from '@/features/maintenance/checklist-template-form';
import { GenerateDuePreventiveButton } from '@/features/maintenance/preventive-generate-button';
import { can, requirePermission } from '@/lib/auth/guard';
import { getRequestLocale } from '@/lib/locale';
import { getMessages } from '@/i18n';
import { listChecklistTemplates, getWorkOrderFormReferenceData } from '@/services/maintenance-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Maintenance Checklists' };

export default async function MaintenanceChecklistsPage() {
  const user = await requirePermission('maintenance:view');
  const canManage = can(user, 'maintenance:manage');
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.maintenance;

  const [templates, reference] = await Promise.all([
    listChecklistTemplates(user.organizationId),
    getWorkOrderFormReferenceData(user.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: t.title, href: '/maintenance' }, { label: t.checklists }]}
        title={t.checklistsTitle}
        subtitle={t.checklistsSubtitle}
        actions={
          canManage ? (
            <>
              <GenerateDuePreventiveButton />
              <CreateChecklistTemplateButton categories={reference.categories.map((c) => ({ id: c.id, name: c.name }))} />
            </>
          ) : null
        }
      />

      <Card>
        {templates.length === 0 ? (
          <EmptyState title={t.noChecklistTemplates} description={t.noChecklistTemplatesDescription} />
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR><TH>{t.checklistCode}</TH><TH>{t.checklistName}</TH><TH alignment="end">{t.checklistItemsCol}</TH></TR>
              </THead>
              <TBody>
                {templates.map((template) => (
                  <TR key={template.id}>
                    <TD className="font-medium">{template.code}</TD>
                    <TD>{template.nameEn}</TD>
                    <TD alignment="end" numeric>{template.items.length}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
      <Card>
        <CardBody className="text-[12.5px] text-[var(--color-text-secondary)]">{t.generateDueWorkOrdersHint}</CardBody>
      </Card>
    </div>
  );
}
