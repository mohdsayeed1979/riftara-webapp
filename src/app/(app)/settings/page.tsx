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
import { getRequestLocale } from '@/lib/locale';
import { getMessages, interpolate } from '@/i18n';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requirePermission('settings:view');
  const db = await getDb();
  const orgId = user.organizationId;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const t = m.settings;

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
    if (valueType === 'boolean') return value ? t.enabled : t.disabled;
    if (valueType === 'percent') return `${value}%`;
    if (valueType === 'duration_days') return interpolate(t.days, { count: String(value) });
    if (valueType === 'duration_minutes') return interpolate(t.minutes, { count: String(value) });
    if (typeof value === 'object') return Array.isArray(value) ? interpolate(t.items, { count: value.length }) : t.configured;
    return String(value);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        subtitle={t.subtitleLong}
      />

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">{t.businessRules}</TabsTrigger>
          <TabsTrigger value="config">{t.tabConfig}</TabsTrigger>
          <TabsTrigger value="taxonomies">{t.taxonomies}</TabsTrigger>
          <TabsTrigger value="statuses">{t.tabStatuses}</TabsTrigger>
          <TabsTrigger value="pipeline">{t.tabPipeline}</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <Card>
            <CardHeader title={t.coreBusinessRules} description={t.coreBusinessRulesDesc} />
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>{t.ruleCol}</TH><TH>{t.descriptionCol}</TH><TH alignment="center">{t.enforcementCol}</TH><TH alignment="center">{m.common.status}</TH></TR>
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
                        <Badge tone={rule.isEnabled ? 'success' : 'neutral'} dot>{rule.isEnabled ? m.common.statuses.active : t.off}</Badge>
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
                        <TR><TH>{t.settingCol}</TH><TH>{t.descriptionCol}</TH><TH alignment="end">{t.valueCol}</TH></TR>
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
            <TaxonomyCard title={t.propertyTypes} items={taxonomyNames(propertyTypeRows, locale)} />
            <TaxonomyCard title={t.unitTypesTax} items={taxonomyNames(unitTypeRows, locale)} />
            <TaxonomyCard title={t.leadSources} items={taxonomyNames(leadSourceRows, locale)} />
            <TaxonomyCard title={t.expenseCategories} items={taxonomyNames(expenseRows, locale)} />
            <TaxonomyCard title={t.maintenanceCategories} items={taxonomyNames(maintenanceRows, locale)} />
            <TaxonomyCard title={t.documentCategories} items={taxonomyNames(documentRows, locale)} />
          </div>
        </TabsContent>

        <TabsContent value="statuses">
          <Card>
            <CardHeader title={t.unitStatusesTitle} description={t.unitStatusesDesc} />
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>{m.common.status}</TH><TH>{t.availabilityClassCol}</TH><TH alignment="center">{t.publishableCol}</TH><TH alignment="center">{t.occupiedCol}</TH><TH alignment="center">{t.blocksLeasingCol}</TH></TR>
                </THead>
                <TBody>
                  {unitStatusRows.map((status) => (
                    <TR key={status.id}>
                      <TD className="font-medium">{locale === 'ar' && status.nameAr ? status.nameAr : status.nameEn}</TD>
                      <TD><Badge tone={status.availabilityClass === 'available' ? 'success' : status.availabilityClass === 'leased' ? 'info' : status.availabilityClass === 'reserved' ? 'warning' : 'neutral'}>{(m.common.statuses as Record<string,string>)[status.availabilityClass] ?? status.availabilityClass}</Badge></TD>
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
            <CardHeader title={t.leadPipelineTitle} description={t.leadPipelineDesc} />
            <TableContainer>
              <Table>
                <THead>
                  <TR><TH>#</TH><TH>{t.stageCol}</TH><TH alignment="center">{t.typeCol}</TH><TH alignment="end">{t.probabilityCol}</TH><TH alignment="center">{t.lossReasonCol}</TH></TR>
                </THead>
                <TBody>
                  {leadStageRows.map((stage) => (
                    <TR key={stage.id}>
                      <TD className="text-[var(--color-text-tertiary)]">{stage.pipelineOrder + 1}</TD>
                      <TD className="font-medium">{locale === 'ar' && stage.nameAr ? stage.nameAr : stage.nameEn}</TD>
                      <TD alignment="center"><Badge tone={stage.stageType === 'won' ? 'success' : stage.stageType === 'lost' ? 'error' : 'info'}>{stage.stageType}</Badge></TD>
                      <TD alignment="end" numeric>{stage.probability}%</TD>
                      <TD alignment="center">{stage.requiresLossReason ? t.required : '—'}</TD>
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

/** Localizes DB taxonomy display names: Arabic name when available, else English. */
function taxonomyNames(rows: Array<{ nameEn: string; nameAr: string | null }>, locale: 'en' | 'ar'): string[] {
  return rows.map((r) => (locale === 'ar' && r.nameAr ? r.nameAr : r.nameEn));
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
