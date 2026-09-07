import type { Metadata } from 'next';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  businessRuleConfigs,
  documentCategories,
  expenseCategories,
  leadSources,
  leadStages,
  maintenanceCategories,
  propertyTypes,
  settings,
  unitStatuses,
  unitTypes,
} from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader, SectionTitle } from '@/components/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requirePermission('settings:view');
  const db = await getDb();
  const orgId = user.organizationId;

  const [settingRows, rules, propertyTypeRows, unitTypeRows, unitStatusRows, leadSourceRows, leadStageRows, expenseRows, maintenanceRows, documentRows] =
    await Promise.all([
      db.select().from(settings).where(eq(settings.organizationId, orgId)).orderBy(asc(settings.group), asc(settings.key)),
      db.select().from(businessRuleConfigs).where(eq(businessRuleConfigs.organizationId, orgId)).orderBy(asc(businessRuleConfigs.ruleCode)),
      db.select().from(propertyTypes).where(eq(propertyTypes.organizationId, orgId)).orderBy(asc(propertyTypes.sortOrder)),
      db.select().from(unitTypes).where(eq(unitTypes.organizationId, orgId)).orderBy(asc(unitTypes.sortOrder)),
      db.select().from(unitStatuses).where(eq(unitStatuses.organizationId, orgId)).orderBy(asc(unitStatuses.sortOrder)),
      db.select().from(leadSources).where(eq(leadSources.organizationId, orgId)).orderBy(asc(leadSources.sortOrder)),
      db.select().from(leadStages).where(eq(leadStages.organizationId, orgId)).orderBy(asc(leadStages.pipelineOrder)),
      db.select().from(expenseCategories).where(eq(expenseCategories.organizationId, orgId)).orderBy(asc(expenseCategories.sortOrder)),
      db.select().from(maintenanceCategories).where(eq(maintenanceCategories.organizationId, orgId)).orderBy(asc(maintenanceCategories.sortOrder)),
      db.select().from(documentCategories).where(eq(documentCategories.organizationId, orgId)).orderBy(asc(documentCategories.sortOrder)),
    ]);

  const settingsByGroup = new Map<string, typeof settingRows>();
  for (const row of settingRows) {
    const bucket = settingsByGroup.get(row.group) ?? [];
    bucket.push(row);
    settingsByGroup.set(row.group, bucket);
  }

  function renderValue(value: unknown, valueType: string): string {
    if (valueType === 'boolean') return value ? 'Enabled' : 'Disabled';
    if (valueType === 'percent') return `${value}%`;
    if (valueType === 'duration_days') return `${value} days`;
    if (valueType === 'duration_minutes') return `${value} minutes`;
    if (typeof value === 'object') return Array.isArray(value) ? `${value.length} items` : 'Configured';
    return String(value);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Settings"
        subtitle="Configure business rules, taxonomies and system preferences. Values here drive platform behaviour without code changes."
      />

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Business Rules</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="taxonomies">Taxonomies</TabsTrigger>
          <TabsTrigger value="statuses">Unit Statuses</TabsTrigger>
          <TabsTrigger value="pipeline">Lead Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <Card>
            <CardHeader title="Core Business Rules" description="The BRD business rules and their enforcement status." />
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>Rule</TH><TH>Description</TH><TH alignment="center">Enforcement</TH><TH alignment="center">Status</TH></TR>
                </THead>
                <TBody>
                  {rules.map((rule) => (
                    <TR key={rule.id}>
                      <TD className="font-medium">{rule.ruleCode}</TD>
                      <TD className="max-w-md text-[var(--color-text-secondary)]">{rule.name}</TD>
                      <TD alignment="center">
                        <Badge tone={rule.enforcement === 'enforced' ? 'success' : rule.enforcement === 'warning' ? 'warning' : 'neutral'}>
                          {rule.enforcement}
                        </Badge>
                      </TD>
                      <TD alignment="center">
                        <Badge tone={rule.isEnabled ? 'success' : 'neutral'} dot>{rule.isEnabled ? 'Active' : 'Off'}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <div className="flex flex-col gap-4">
            {Array.from(settingsByGroup.entries()).map(([group, rows]) => (
              <div key={group}>
                <SectionTitle>
                  <span className="capitalize">{group}</span>
                </SectionTitle>
                <Card>
                  <TableContainer>
                    <Table>
                      <THead>
                        <TR><TH>Setting</TH><TH>Description</TH><TH alignment="end">Value</TH></TR>
                      </THead>
                      <TBody>
                        {rows.map((row) => (
                          <TR key={row.id}>
                            <TD className="font-medium">{row.label}</TD>
                            <TD className="max-w-md text-[var(--color-text-secondary)]">{row.description}</TD>
                            <TD alignment="end" className="font-medium tabular">{renderValue(row.value, row.valueType)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableContainer>
                </Card>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="taxonomies">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TaxonomyCard title="Property Types" items={propertyTypeRows.map((t) => t.nameEn)} />
            <TaxonomyCard title="Unit Types" items={unitTypeRows.map((t) => t.nameEn)} />
            <TaxonomyCard title="Lead Sources" items={leadSourceRows.map((t) => t.nameEn)} />
            <TaxonomyCard title="Expense Categories" items={expenseRows.map((t) => t.nameEn)} />
            <TaxonomyCard title="Maintenance Categories" items={maintenanceRows.map((t) => t.nameEn)} />
            <TaxonomyCard title="Document Categories" items={documentRows.map((t) => t.nameEn)} />
          </div>
        </TabsContent>

        <TabsContent value="statuses">
          <Card>
            <CardHeader title="Unit Statuses" description="Configurable statuses drive the availability engine and website publishing rules." />
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>Status</TH><TH>Availability Class</TH><TH alignment="center">Publishable</TH><TH alignment="center">Counts as Occupied</TH><TH alignment="center">Blocks Leasing</TH></TR>
                </THead>
                <TBody>
                  {unitStatusRows.map((status) => (
                    <TR key={status.id}>
                      <TD className="font-medium">{status.nameEn}</TD>
                      <TD><Badge tone={status.availabilityClass === 'available' ? 'success' : status.availabilityClass === 'leased' ? 'info' : status.availabilityClass === 'reserved' ? 'warning' : 'neutral'}>{status.availabilityClass}</Badge></TD>
                      <TD alignment="center">{status.publishable ? '✓' : '—'}</TD>
                      <TD alignment="center">{status.countsAsOccupied ? '✓' : '—'}</TD>
                      <TD alignment="center">{status.blocksLeasing ? '✓' : '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          </Card>
        </TabsContent>

        <TabsContent value="pipeline">
          <Card>
            <CardHeader title="Lead Pipeline Stages" description="The configurable leasing pipeline (BRD 19)." />
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>#</TH><TH>Stage</TH><TH alignment="center">Type</TH><TH alignment="end">Probability</TH><TH alignment="center">Loss Reason</TH></TR>
                </THead>
                <TBody>
                  {leadStageRows.map((stage) => (
                    <TR key={stage.id}>
                      <TD className="text-[var(--color-text-tertiary)]">{stage.pipelineOrder + 1}</TD>
                      <TD className="font-medium">{stage.nameEn}</TD>
                      <TD alignment="center"><Badge tone={stage.stageType === 'won' ? 'success' : stage.stageType === 'lost' ? 'error' : 'info'}>{stage.stageType}</Badge></TD>
                      <TD alignment="end" numeric>{stage.probability}%</TD>
                      <TD alignment="center">{stage.requiresLossReason ? 'Required' : '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TaxonomyCard({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader title={title} action={<span className="text-[11px] text-[var(--color-text-tertiary)]">{items.length}</span>} />
      <CardBody className="flex flex-wrap gap-1.5 pt-0">
        {items.map((item) => (
          <Badge key={item} tone="outline">
            {item}
          </Badge>
        ))}
      </CardBody>
    </Card>
  );
}
