import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bootstrapTestDb } from './setup-db';
import type { Database } from '@/db/types';
import type { SessionUser } from '@/lib/auth/session';

const FOREIGN_ORG = '00000000-0000-4000-8000-000000000000';

let db: Database;
let cleanup: () => void;
let admin: SessionUser;
let cityRiyadhName = 'Riyadh';
let districtGranadaName = 'Granada';
let propertyTypeName = 'Apartment Building';
let unitTypeName = 'Apartment — 1 Bedroom';
let unitStatusName = 'Available';
let seededPropertyCode = '';
let seededPropertyId = '';
let seededBuildingCode = '';
let seededFloorName = '';

function propRow(overrides: Record<string, unknown> = {}) {
  return {
    'Property Code': `BI-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    'Property Name (EN)': 'Bulk Import Test Property',
    'Property Type': propertyTypeName,
    City: cityRiyadhName,
    ...overrides,
  };
}

function unitRow(overrides: Record<string, unknown> = {}) {
  return {
    'Property Code': seededPropertyCode,
    'Unit Code': `BI-U-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    'Unit Number': 'TEST-01',
    'Unit Type': unitTypeName,
    'Unit Status': unitStatusName,
    ...overrides,
  };
}

beforeAll(async () => {
  const ctx = await bootstrapTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;

  const { users, properties, buildings, floors } = await import('@/db/schema');
  const { loadSessionUser } = await import('@/lib/auth/session');

  const [u] = await db.select().from(users).where(eq(users.email, 'sayeed.almousa@riftara.sa')).limit(1);
  const loaded = await loadSessionUser(u.id);
  if (!loaded) throw new Error('admin actor not found');
  admin = loaded;

  const [prop] = await db.select({ id: properties.id, code: properties.code }).from(properties).where(eq(properties.organizationId, admin.organizationId)).limit(1);
  seededPropertyCode = prop.code;
  seededPropertyId = prop.id;

  const [building] = await db.select({ id: buildings.id, code: buildings.code }).from(buildings).where(eq(buildings.propertyId, prop.id)).limit(1);
  if (building) {
    seededBuildingCode = building.code;
    const [floor] = await db.select({ nameEn: floors.nameEn }).from(floors).where(eq(floors.buildingId, building.id)).limit(1);
    if (floor) seededFloorName = floor.nameEn;
  }
}, 180_000);

afterAll(() => cleanup?.());

/* -------------------------------------------------------------------------- */
describe('Property validation', () => {
  it('validates a correct property row as create', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { summary, results } = await validateProperties(admin.organizationId, [propRow()], 'create_only');
    expect(summary.error).toBe(0);
    expect(summary.create).toBe(1);
    expect(results[0].action).toBe('create');
  });

  it('reports a missing required field', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const row = propRow();
    delete (row as Record<string, unknown>)['Property Type'];
    const { results } = await validateProperties(admin.organizationId, [row], 'create_only');
    expect(results[0].action).toBe('error');
    expect(results[0].errors.some((e) => e.field === 'Property Type')).toBe(true);
  });

  it('reports an invalid city', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { results } = await validateProperties(admin.organizationId, [propRow({ City: 'Not A Real City' })], 'create_only');
    expect(results[0].action).toBe('error');
    expect(results[0].errors.some((e) => e.code === 'NOT_FOUND' && e.field === 'City')).toBe(true);
  });

  it('reports an invalid district scoped to a valid city', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { results } = await validateProperties(admin.organizationId, [propRow({ District: 'Granadaaa' })], 'create_only');
    expect(results[0].action).toBe('error');
    const districtError = results[0].errors.find((e) => e.field === 'District');
    expect(districtError?.message).toContain('City "Riyadh" is valid but District "Granadaaa" was not found');
  });

  it('resolves a valid district within the matching city', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { results } = await validateProperties(admin.organizationId, [propRow({ District: districtGranadaName })], 'create_only');
    expect(results[0].errors.length).toBe(0);
    expect(results[0].action).toBe('create');
  });

  it('flags a duplicate Property Code within the same file', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const row = propRow();
    const { results } = await validateProperties(admin.organizationId, [row, { ...row }], 'create_only');
    expect(results[0].action).toBe('create');
    expect(results[1].action).toBe('error');
    expect(results[1].errors.some((e) => e.code === 'DUPLICATE_IN_FILE')).toBe(true);
  });

  it('skips (does not error) a Property Code that already exists, in Create Only mode', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { results } = await validateProperties(admin.organizationId, [propRow({ 'Property Code': seededPropertyCode })], 'create_only');
    expect(results[0].action).toBe('skip');
    expect(results[0].warnings.some((w) => w.code === 'DUPLICATE_EXISTING')).toBe(true);
  });

  it('treats an existing Property Code as an update in Update Existing mode, and diffs the changed fields', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { results } = await validateProperties(admin.organizationId, [propRow({ 'Property Code': seededPropertyCode, 'Property Name (EN)': 'Renamed Via Import' })], 'update_existing');
    expect(results[0].action).toBe('update');
    expect(results[0].changes.some((c) => c.field === 'Name (EN)')).toBe(true);
  });

  it('errors when Update Existing mode targets a Property Code that does not exist', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { results } = await validateProperties(admin.organizationId, [propRow()], 'update_existing');
    expect(results[0].action).toBe('error');
    expect(results[0].errors.some((e) => e.code === 'NOT_FOUND' && e.field === 'Property Code')).toBe(true);
  });

  it('is organization-scoped: a property in another organization is invisible to duplicate detection', async () => {
    const { validateProperties } = await import('@/services/import-service');
    const { results } = await validateProperties(FOREIGN_ORG, [propRow({ 'Property Code': seededPropertyCode, City: 'Riyadh' })], 'create_only');
    // The foreign org has no matching city/type by these names, so it must error, not silently see the other org's property.
    expect(results[0].action).toBe('error');
  });
});

/* -------------------------------------------------------------------------- */
describe('Unit validation', () => {
  it('validates a correct unit row as create', async () => {
    const { validateUnits } = await import('@/services/import-service');
    const { summary, results } = await validateUnits(admin.organizationId, [unitRow()], 'create_only', new Map());
    expect(summary.error).toBe(0);
    expect(results[0].action).toBe('create');
  });

  it('reports an invalid (non-existent) Property Code', async () => {
    const { validateUnits } = await import('@/services/import-service');
    const { results } = await validateUnits(admin.organizationId, [unitRow({ 'Property Code': 'NOPE-DOES-NOT-EXIST' })], 'create_only', new Map());
    expect(results[0].action).toBe('error');
    expect(results[0].errors.some((e) => e.field === 'Property Code' && e.code === 'NOT_FOUND')).toBe(true);
  });

  it('reports an invalid Building Code', async () => {
    const { validateUnits } = await import('@/services/import-service');
    const { results } = await validateUnits(admin.organizationId, [unitRow({ 'Building Code': 'NOT-A-REAL-BUILDING' })], 'create_only', new Map());
    expect(results[0].action).toBe('error');
    expect(results[0].errors.some((e) => e.field === 'Building Code')).toBe(true);
  });

  it('resolves a valid Building Code and Floor from existing master data', async () => {
    if (!seededBuildingCode || !seededFloorName) return; // seed layout varies; skip if this property has none
    const { validateUnits } = await import('@/services/import-service');
    const { results } = await validateUnits(admin.organizationId, [unitRow({ 'Building Code': seededBuildingCode, Floor: seededFloorName })], 'create_only', new Map());
    expect(results[0].errors.length).toBe(0);
  });

  it('flags a duplicate Unit Code within the same file', async () => {
    const { validateUnits } = await import('@/services/import-service');
    const row = unitRow();
    const { results } = await validateUnits(admin.organizationId, [row, { ...row }], 'create_only', new Map());
    expect(results[1].errors.some((e) => e.code === 'DUPLICATE_IN_FILE')).toBe(true);
  });

  it('resolves a unit against a property created earlier in the same (combined) run', async () => {
    const { validateProperties, validateUnits } = await import('@/services/import-service');
    const propertyCode = `BI-COMBO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const propertyResult = await validateProperties(admin.organizationId, [propRow({ 'Property Code': propertyCode })], 'create_only');
    const { results } = await validateUnits(admin.organizationId, [unitRow({ 'Property Code': propertyCode })], 'create_only', propertyResult.validByCode);
    expect(results[0].action).toBe('create');
    expect(results[0].errors.length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
describe('Transactional execution', () => {
  it('imports a valid property inside a transaction, with audit and organization scoping', async () => {
    const { executeImport } = await import('@/services/import-service');
    const { properties, auditLogs } = await import('@/db/schema');
    const code = `BI-EXEC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const result = await executeImport(admin, { propertyRows: [propRow({ 'Property Code': code })], unitRows: [], mode: 'create_only', fileName: 'test.xlsx', fileType: 'xlsx' });
    expect(result.properties.imported).toBe(1);
    const [row] = await db.select({ organizationId: properties.organizationId, code: properties.code }).from(properties).where(eq(properties.code, code));
    expect(row.organizationId).toBe(admin.organizationId);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entityType, 'property'), eq(auditLogs.reason, `Bulk import (batch ${result.batchId})`)));
    expect(audit.some((a) => a.action === 'create')).toBe(true);
  });

  it('imports a combined Property + Unit workbook in one transaction, resolving the unit to the newly created property', async () => {
    const { executeImport } = await import('@/services/import-service');
    const { units } = await import('@/db/schema');
    const propertyCode = `BI-COMBO2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const unitCode = `BI-COMBO2-U-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const result = await executeImport(admin, {
      propertyRows: [propRow({ 'Property Code': propertyCode })],
      unitRows: [{ ...unitRow({ 'Unit Code': unitCode }), 'Property Code': propertyCode }],
      mode: 'create_only',
      fileName: 'combined.xlsx',
      fileType: 'xlsx',
    });
    expect(result.properties.imported).toBe(1);
    expect(result.units.imported).toBe(1);
    const { properties } = await import('@/db/schema');
    const [property] = await db.select({ id: properties.id }).from(properties).where(eq(properties.code, propertyCode));
    const [unit] = await db.select({ propertyId: units.propertyId, computedAvailabilityClass: units.computedAvailabilityClass }).from(units).where(eq(units.code, unitCode));
    expect(unit.propertyId).toBe(property.id);
    // The availability engine runs after commit — the unit must not be left un-derived.
    expect(unit.computedAvailabilityClass).toBeTruthy();
  });

  it('rejects the whole batch (no partial writes) when any row is invalid and skipErrorRows is not set', async () => {
    const { executeImport } = await import('@/services/import-service');
    const { properties } = await import('@/db/schema');
    const goodCode = `BI-ROLLBACK-GOOD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const badRow = propRow({ 'Property Code': `BI-ROLLBACK-BAD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, City: 'Nowhere' });
    await expect(
      executeImport(admin, { propertyRows: [propRow({ 'Property Code': goodCode }), badRow], unitRows: [], mode: 'create_only', fileName: 'bad.xlsx', fileType: 'xlsx' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const rows = await db.select({ id: properties.id }).from(properties).where(eq(properties.code, goodCode));
    expect(rows.length).toBe(0); // the valid row must NOT have been written either
  });

  it('imports only the valid rows when skipErrorRows is set, and records the batch as completed_with_errors', async () => {
    const { executeImport, getImportBatch } = await import('@/services/import-service');
    const { properties } = await import('@/db/schema');
    const goodCode = `BI-PARTIAL-GOOD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const badRow = propRow({ 'Property Code': `BI-PARTIAL-BAD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, City: 'Nowhere' });
    const result = await executeImport(admin, { propertyRows: [propRow({ 'Property Code': goodCode }), badRow], unitRows: [], mode: 'create_only', fileName: 'partial.xlsx', fileType: 'xlsx', skipErrorRows: true });
    expect(result.properties.imported).toBe(1);
    expect(result.properties.errors).toBe(1);
    const rows = await db.select({ id: properties.id }).from(properties).where(eq(properties.code, goodCode));
    expect(rows.length).toBe(1);
    const batch = await getImportBatch(admin.organizationId, result.batchId);
    expect(batch.status).toBe('completed_with_errors');
  });

  it('Create + Update mode creates a new code and updates an existing one in the same run', async () => {
    const { executeImport } = await import('@/services/import-service');
    const { properties } = await import('@/db/schema');
    const newCode = `BI-CU-NEW-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const result = await executeImport(admin, {
      propertyRows: [propRow({ 'Property Code': newCode }), propRow({ 'Property Code': seededPropertyCode, 'Property Name (EN)': 'Updated By Create+Update' })],
      unitRows: [],
      mode: 'create_and_update',
      fileName: 'cu.xlsx',
      fileType: 'xlsx',
    });
    expect(result.properties.imported).toBe(1);
    expect(result.properties.updated).toBe(1);
    const [updated] = await db.select({ nameEn: properties.nameEn }).from(properties).where(eq(properties.id, seededPropertyId));
    expect(updated.nameEn).toBe('Updated By Create+Update');
  });
});

/* -------------------------------------------------------------------------- */
describe('Import history', () => {
  it('records a batch with row counts and exposes it via history', async () => {
    const { executeImport, listImportBatches, getImportBatch } = await import('@/services/import-service');
    const code = `BI-HIST-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const result = await executeImport(admin, { propertyRows: [propRow({ 'Property Code': code })], unitRows: [], mode: 'create_only', fileName: 'history.xlsx', fileType: 'xlsx' });
    const batch = await getImportBatch(admin.organizationId, result.batchId);
    expect(batch.status).toBe('completed');
    expect(batch.importedRows).toBe(1);
    const list = await listImportBatches(admin.organizationId);
    expect(list.some((b) => b.id === result.batchId)).toBe(true);
  });

  it('generates a downloadable error report for a failed batch', async () => {
    const { executeImport, getImportBatchErrors } = await import('@/services/import-service');
    const badRow = propRow({ City: 'Nowhere' });
    let batchId = '';
    try {
      await executeImport(admin, { propertyRows: [badRow], unitRows: [], mode: 'create_only', fileName: 'errors.xlsx', fileType: 'xlsx' });
    } catch (error) {
      batchId = (error as { details?: { batchId?: string } }).details?.batchId ?? '';
    }
    expect(batchId).toBeTruthy();
    const errors = await getImportBatchErrors(admin.organizationId, batchId);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe('City');
  });
});

/* -------------------------------------------------------------------------- */
describe('File parsing (CSV, XLSX, Arabic content)', () => {
  it('parses a CSV upload into row objects', async () => {
    const { parseUploadedWorkbook } = await import('@/lib/import/workbook');
    const csv = 'Property Code,Property Name (EN),Property Type,City\nBI-CSV-01,CSV Import Test,Apartment Building,Riyadh\n';
    const sheets = await parseUploadedWorkbook(Buffer.from(csv, 'utf-8'), 'upload.csv');
    expect(sheets.length).toBe(1);
    expect(sheets[0].rows.length).toBe(1);
    expect(sheets[0].rows[0]['Property Code']).toBe('BI-CSV-01');
  });

  it('parses the official .xlsx property template, including its sample row', async () => {
    const { buildPropertyTemplate } = await import('@/lib/import/templates');
    const { parseUploadedWorkbook } = await import('@/lib/import/workbook');
    const buffer = await buildPropertyTemplate();
    const sheets = await parseUploadedWorkbook(buffer, 'template.xlsx');
    const propertiesSheet = sheets.find((s) => s.name === 'Properties');
    expect(propertiesSheet?.rows.length).toBe(1);
    expect(propertiesSheet?.rows[0]['Property Code']).toBe('RYD-GRN-01');
  });

  it('rejects an unsupported file type', async () => {
    const { parseUploadedWorkbook } = await import('@/lib/import/workbook');
    await expect(parseUploadedWorkbook(Buffer.from('not a spreadsheet'), 'malware.exe')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('preserves Arabic text through validation and import', async () => {
    const { executeImport } = await import('@/services/import-service');
    const { properties } = await import('@/db/schema');
    const code = `BI-AR-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await executeImport(admin, {
      propertyRows: [propRow({ 'Property Code': code, 'Property Name (AR)': 'عقار تجريبي للاستيراد', Description: 'وصف تجريبي بالعربية' })],
      unitRows: [],
      mode: 'create_only',
      fileName: 'arabic.xlsx',
      fileType: 'xlsx',
    });
    const [row] = await db.select({ nameAr: properties.nameAr, descriptionEn: properties.descriptionEn }).from(properties).where(eq(properties.code, code));
    expect(row.nameAr).toBe('عقار تجريبي للاستيراد');
  });
});

/* -------------------------------------------------------------------------- */
describe('RBAC catalog', () => {
  it('defines properties:manage and units:manage, reusing the existing global "manage" action', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/catalog');
    expect(PERMISSIONS.some((p) => p.key === 'properties:manage')).toBe(true);
    expect(PERMISSIONS.some((p) => p.key === 'units:manage')).toBe(true);
  });

  it('grants properties:manage/units:manage to operational roles but not to the read-only Auditor role', async () => {
    const { ROLE_DEFINITIONS, resolveRolePermissions } = await import('@/lib/permissions/catalog');
    const auditor = ROLE_DEFINITIONS.find((r) => r.key === 'auditor')!;
    const auditorPerms = resolveRolePermissions(auditor);
    expect(auditorPerms.includes('properties:manage')).toBe(false);
    expect(auditorPerms.includes('units:manage')).toBe(false);

    const propertyManager = ROLE_DEFINITIONS.find((r) => r.key === 'property_manager')!;
    const pmPerms = resolveRolePermissions(propertyManager);
    expect(pmPerms.includes('properties:manage')).toBe(true);
  });
});
