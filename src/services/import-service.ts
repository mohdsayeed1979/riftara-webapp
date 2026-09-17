import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  buildings,
  cities,
  districts,
  floors,
  importBatches,
  importErrors,
  properties,
  propertyTypes,
  unitPricing,
  units,
  unitStatuses,
  unitTypes,
} from '@/db/schema';
import type { DbExecutor } from '@/db/types';
import { recordAudit } from '@/lib/audit';
import { conflict, notFound, validationError } from '@/lib/errors';
import { PROPERTY_STATUS_VALUES } from '@/lib/properties/enums';
import { computeUnitAvailability } from '@/services/availability-service';
import { getPolicy } from '@/lib/settings';
import { round2 } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/session';
import type { RawRow } from '@/lib/import/workbook';

/**
 * Bulk Property & Unit Import (Phase 20A / BRD 135).
 *
 * Reuses the pre-existing (previously unimplemented) `import_batches` /
 * `import_errors` tables as the single import-history mechanism — no second
 * audit or history system. Validation always runs before any write; the
 * actual create/update happens in one database transaction so a fatal error
 * leaves no half-created records.
 */

export type ImportMode = 'create_only' | 'update_existing' | 'create_and_update';
export type RowAction = 'create' | 'update' | 'skip' | 'error';

export interface RowIssue {
  field?: string;
  code: string;
  message: string;
  /** The offending raw value, for the downloadable error report. */
  value?: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface PropertyRowResult {
  rowNumber: number;
  code: string;
  nameEn: string | null;
  action: RowAction;
  existingId: string | null;
  values: {
    nameEn: string;
    nameAr: string | null;
    propertyTypeId: string;
    cityId: string;
    districtId: string | null;
    addressLine: string | null;
    status: string;
    descriptionEn: string | null;
  } | null;
  changes: FieldChange[];
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface UnitRowResult {
  rowNumber: number;
  code: string;
  unitNumber: string | null;
  propertyCode: string;
  action: RowAction;
  existingId: string | null;
  values: {
    propertyId: string;
    buildingId: string | null;
    floorId: string | null;
    unitNumber: string;
    unitTypeId: string;
    usageType: string;
    statusId: string;
    bedroomCount: number | null;
    bathroomCount: number | null;
    grossArea: number | null;
    descriptionEn: string | null;
    annualRent: number | null;
  } | null;
  changes: FieldChange[];
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface SectionSummary {
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  warning: number;
}

export interface ImportPreview {
  properties: { summary: SectionSummary; results: PropertyRowResult[] };
  units: { summary: SectionSummary; results: UnitRowResult[] };
  canImport: boolean;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pick(row: RawRow, ...keys: string[]): unknown {
  for (const key of keys) {
    const hit = Object.keys(row).find((k) => k.trim().toLowerCase() === key.toLowerCase());
    if (hit !== undefined && row[hit] !== undefined) return row[hit];
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Master data resolution                                                      */
/* -------------------------------------------------------------------------- */

interface MasterData {
  propertyTypes: Map<string, { id: string }>;
  cities: Map<string, { id: string }>;
  districtsByCity: Map<string, Map<string, { id: string }>>;
  unitTypes: Map<string, { id: string; category: string }>;
  unitStatuses: Map<string, { id: string }>;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

async function loadMasterData(db: DbExecutor, organizationId: string): Promise<MasterData> {
  const [typeRows, cityRows, districtRows, unitTypeRows, statusRows] = await Promise.all([
    db.select({ id: propertyTypes.id, nameEn: propertyTypes.nameEn, key: propertyTypes.key }).from(propertyTypes).where(and(eq(propertyTypes.organizationId, organizationId), eq(propertyTypes.isActive, true))),
    db.select({ id: cities.id, nameEn: cities.nameEn }).from(cities).where(and(eq(cities.organizationId, organizationId), eq(cities.isActive, true))),
    db.select({ id: districts.id, nameEn: districts.nameEn, cityId: districts.cityId }).from(districts).where(and(eq(districts.organizationId, organizationId), eq(districts.isActive, true))),
    db.select({ id: unitTypes.id, nameEn: unitTypes.nameEn, key: unitTypes.key, category: unitTypes.category }).from(unitTypes).where(and(eq(unitTypes.organizationId, organizationId), eq(unitTypes.isActive, true))),
    db.select({ id: unitStatuses.id, nameEn: unitStatuses.nameEn, key: unitStatuses.key }).from(unitStatuses).where(and(eq(unitStatuses.organizationId, organizationId), eq(unitStatuses.isActive, true))),
  ]);

  const propertyTypeMap = new Map<string, { id: string }>();
  for (const r of typeRows) {
    propertyTypeMap.set(normalize(r.nameEn), { id: r.id });
    propertyTypeMap.set(normalize(r.key), { id: r.id });
  }
  const cityMap = new Map<string, { id: string }>();
  for (const r of cityRows) cityMap.set(normalize(r.nameEn), { id: r.id });

  const districtsByCity = new Map<string, Map<string, { id: string }>>();
  for (const r of districtRows) {
    if (!districtsByCity.has(r.cityId)) districtsByCity.set(r.cityId, new Map());
    districtsByCity.get(r.cityId)!.set(normalize(r.nameEn), { id: r.id });
  }

  const unitTypeMap = new Map<string, { id: string; category: string }>();
  for (const r of unitTypeRows) {
    unitTypeMap.set(normalize(r.nameEn), { id: r.id, category: r.category });
    unitTypeMap.set(normalize(r.key), { id: r.id, category: r.category });
  }
  const unitStatusMap = new Map<string, { id: string }>();
  for (const r of statusRows) {
    unitStatusMap.set(normalize(r.nameEn), { id: r.id });
    unitStatusMap.set(normalize(r.key), { id: r.id });
  }

  return { propertyTypes: propertyTypeMap, cities: cityMap, districtsByCity, unitTypes: unitTypeMap, unitStatuses: unitStatusMap };
}

/* -------------------------------------------------------------------------- */
/* Property validation                                                         */
/* -------------------------------------------------------------------------- */

export async function validateProperties(
  organizationId: string,
  rows: RawRow[],
  mode: ImportMode,
): Promise<{ summary: SectionSummary; results: PropertyRowResult[]; validByCode: Map<string, PropertyRowResult> }> {
  const db = await getDb();
  const master = await loadMasterData(db, organizationId);

  const existing = await db
    .select({ id: properties.id, code: properties.code, nameEn: properties.nameEn, nameAr: properties.nameAr, propertyTypeId: properties.propertyTypeId, cityId: properties.cityId, districtId: properties.districtId, addressLine: properties.addressLine, status: properties.status, descriptionEn: properties.descriptionEn })
    .from(properties)
    .where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt)));
  const existingByCode = new Map(existing.map((p) => [normalize(p.code), p]));

  const seenInFile = new Map<string, number>();
  const results: PropertyRowResult[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];

    const code = str(pick(row, 'Property Code', 'Code'));
    const nameEn = str(pick(row, 'Property Name (EN)', 'Property Name', 'Name'));
    const nameAr = str(pick(row, 'Property Name (AR)', 'Name (Arabic)'));
    const typeName = str(pick(row, 'Property Type', 'Type'));
    const cityName = str(pick(row, 'City'));
    const districtName = str(pick(row, 'District'));
    const address = str(pick(row, 'Address'));
    const statusRaw = str(pick(row, 'Status'))?.toLowerCase() ?? 'active';
    const description = str(pick(row, 'Description'));

    if (!code) errors.push({ field: 'Property Code', code: 'REQUIRED', message: 'Property Code is required.' });
    if (!nameEn) errors.push({ field: 'Property Name (EN)', code: 'REQUIRED', message: 'Property Name (EN) is required.' });
    if (!typeName) errors.push({ field: 'Property Type', code: 'REQUIRED', message: 'Property Type is required.' });
    if (!cityName) errors.push({ field: 'City', code: 'REQUIRED', message: 'City is required.' });

    let propertyTypeId: string | null = null;
    if (typeName) {
      const match = master.propertyTypes.get(normalize(typeName));
      if (!match) errors.push({ field: 'Property Type', code: 'NOT_FOUND', message: `Property Type "${typeName}" was not found.`, value: typeName ?? undefined });
      else propertyTypeId = match.id;
    }

    let cityId: string | null = null;
    if (cityName) {
      const match = master.cities.get(normalize(cityName));
      if (!match) errors.push({ field: 'City', code: 'NOT_FOUND', message: `City "${cityName}" was not found.`, value: cityName ?? undefined });
      else cityId = match.id;
    }

    let districtId: string | null = null;
    if (districtName && cityId) {
      const match = master.districtsByCity.get(cityId)?.get(normalize(districtName));
      if (!match) errors.push({ field: 'District', code: 'NOT_FOUND', message: `City "${cityName}" is valid but District "${districtName}" was not found.`, value: districtName ?? undefined });
      else districtId = match.id;
    } else if (districtName && !cityId) {
      warnings.push({ field: 'District', code: 'UNRESOLVED_PARENT', message: 'District could not be checked because City is invalid.' });
    }

    let status = 'active';
    if (str(pick(row, 'Status'))) {
      if (!(PROPERTY_STATUS_VALUES as readonly string[]).includes(statusRaw)) {
        errors.push({ field: 'Status', code: 'INVALID_ENUM', message: `Status "${statusRaw}" is not valid. Allowed: ${PROPERTY_STATUS_VALUES.join(', ')}.`, value: statusRaw });
      } else {
        status = statusRaw;
      }
    }

    if (code) {
      const key = normalize(code);
      if (seenInFile.has(key)) {
        errors.push({ field: 'Property Code', code: 'DUPLICATE_IN_FILE', message: `Property Code "${code}" appears more than once in this file (first at row ${seenInFile.get(key)}).` });
      } else {
        seenInFile.set(key, rowNumber);
      }
    }

    const existingRow = code ? existingByCode.get(normalize(code)) : undefined;
    let action: RowAction = 'error';
    const changes: FieldChange[] = [];

    if (errors.length === 0) {
      if (existingRow) {
        if (mode === 'create_only') {
          action = 'skip';
          warnings.push({ code: 'DUPLICATE_EXISTING', message: 'Duplicate existing record — Property Code already exists (Create Only mode).' });
        } else {
          action = 'update';
          const next: Array<[string, unknown, unknown]> = [
            ['Name (EN)', existingRow.nameEn, nameEn],
            ['Name (AR)', existingRow.nameAr, nameAr],
            ['City', existingRow.cityId, cityId],
            ['District', existingRow.districtId, districtId],
            ['Address', existingRow.addressLine, address],
            ['Status', existingRow.status, status],
            ['Description', existingRow.descriptionEn, description],
          ];
          for (const [field, from, to] of next) {
            if ((from ?? null) !== (to ?? null)) changes.push({ field, from, to });
          }
        }
      } else if (mode === 'update_existing') {
        action = 'error';
        errors.push({ field: 'Property Code', code: 'NOT_FOUND', message: `Property Code "${code}" does not exist (Update Existing mode requires an existing record).` });
      } else {
        action = 'create';
      }
    }

    const result: PropertyRowResult = {
      rowNumber,
      code: code ?? '',
      nameEn,
      action: errors.length > 0 ? 'error' : action,
      existingId: existingRow?.id ?? null,
      values:
        errors.length === 0 && nameEn && propertyTypeId && cityId
          ? { nameEn, nameAr, propertyTypeId, cityId, districtId, addressLine: address, status, descriptionEn: description }
          : null,
      changes,
      errors,
      warnings,
    };
    results.push(result);
  });

  const summary: SectionSummary = {
    total: results.length,
    create: results.filter((r) => r.action === 'create').length,
    update: results.filter((r) => r.action === 'update').length,
    skip: results.filter((r) => r.action === 'skip').length,
    error: results.filter((r) => r.action === 'error').length,
    warning: results.filter((r) => r.warnings.length > 0).length,
  };
  const validByCode = new Map(results.filter((r) => r.action !== 'error').map((r) => [normalize(r.code), r]));

  return { summary, results, validByCode };
}

/* -------------------------------------------------------------------------- */
/* Unit validation                                                             */
/* -------------------------------------------------------------------------- */

export async function validateUnits(
  organizationId: string,
  rows: RawRow[],
  mode: ImportMode,
  /** Property codes resolved earlier in the same combined-workbook run (create/update rows only). */
  pendingProperties: Map<string, PropertyRowResult>,
): Promise<{ summary: SectionSummary; results: UnitRowResult[] }> {
  const db = await getDb();
  const master = await loadMasterData(db, organizationId);

  const [propertyRows, existingUnits] = await Promise.all([
    db.select({ id: properties.id, code: properties.code }).from(properties).where(and(eq(properties.organizationId, organizationId), isNull(properties.deletedAt))),
    db.select({ id: units.id, code: units.code, propertyId: units.propertyId, buildingId: units.buildingId, floorId: units.floorId, unitNumber: units.unitNumber, unitTypeId: units.unitTypeId, statusId: units.statusId, bedroomCount: units.bedroomCount, bathroomCount: units.bathroomCount, grossArea: units.grossArea, descriptionEn: units.descriptionEn }).from(units).where(and(eq(units.organizationId, organizationId), isNull(units.deletedAt))),
  ]);
  const existingPropertyByCode = new Map(propertyRows.map((p) => [normalize(p.code), p]));
  const existingUnitByCode = new Map(existingUnits.map((u) => [normalize(u.code), u]));

  const seenInFile = new Map<string, number>();
  const results: UnitRowResult[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];

    const propertyCode = str(pick(row, 'Property Code'));
    const buildingCode = str(pick(row, 'Building Code'));
    const floorLabel = str(pick(row, 'Floor'));
    const code = str(pick(row, 'Unit Code'));
    const unitNumber = str(pick(row, 'Unit Number', 'Unit Name'));
    const typeName = str(pick(row, 'Unit Type'));
    const statusName = str(pick(row, 'Unit Status'));
    const bedrooms = num(pick(row, 'Bedrooms'));
    const bathrooms = num(pick(row, 'Bathrooms'));
    const area = num(pick(row, 'Area (sqm)', 'Area'));
    const rent = num(pick(row, 'Annual Rent (SAR)', 'Annual Rent'));
    const description = str(pick(row, 'Description'));

    if (!propertyCode) errors.push({ field: 'Property Code', code: 'REQUIRED', message: 'Property Code is required.' });
    if (!code) errors.push({ field: 'Unit Code', code: 'REQUIRED', message: 'Unit Code is required.' });
    if (!unitNumber) errors.push({ field: 'Unit Number', code: 'REQUIRED', message: 'Unit Number is required.' });
    if (!typeName) errors.push({ field: 'Unit Type', code: 'REQUIRED', message: 'Unit Type is required.' });
    if (!statusName) errors.push({ field: 'Unit Status', code: 'REQUIRED', message: 'Unit Status is required.' });

    let propertyId: string | null = null;
    if (propertyCode) {
      const pending = pendingProperties.get(normalize(propertyCode));
      const existingProp = existingPropertyByCode.get(normalize(propertyCode));
      if (pending?.values) {
        propertyId = pending.existingId ?? null; // resolved after create — see execute()
      } else if (existingProp) {
        propertyId = existingProp.id;
      } else {
        errors.push({ field: 'Property Code', code: 'NOT_FOUND', message: `Property Code "${propertyCode}" does not exist.`, value: propertyCode ?? undefined });
      }
    }

    let buildingId: string | null = null;
    if (buildingCode && propertyId) {
      const [building] = await db.select({ id: buildings.id }).from(buildings).where(and(eq(buildings.organizationId, organizationId), eq(buildings.propertyId, propertyId), eq(buildings.code, buildingCode), isNull(buildings.deletedAt))).limit(1);
      if (!building) errors.push({ field: 'Building Code', code: 'NOT_FOUND', message: `Building Code "${buildingCode}" was not found for property "${propertyCode}".`, value: buildingCode ?? undefined });
      else buildingId = building.id;
    } else if (buildingCode && !propertyId) {
      warnings.push({ field: 'Building Code', code: 'UNRESOLVED_PARENT', message: 'Building could not be checked because Property Code is invalid.' });
    }

    let floorId: string | null = null;
    if (floorLabel && buildingId) {
      const floorRows = await db.select({ id: floors.id, level: floors.level, nameEn: floors.nameEn }).from(floors).where(and(eq(floors.buildingId, buildingId), isNull(floors.deletedAt)));
      const asLevel = Number(floorLabel);
      const match = floorRows.find((f) => normalize(f.nameEn) === normalize(floorLabel) || (Number.isFinite(asLevel) && f.level === asLevel));
      if (!match) errors.push({ field: 'Floor', code: 'NOT_FOUND', message: `Floor "${floorLabel}" was not found in building "${buildingCode}".`, value: floorLabel ?? undefined });
      else floorId = match.id;
    } else if (floorLabel && !buildingId) {
      warnings.push({ field: 'Floor', code: 'UNRESOLVED_PARENT', message: 'Floor could not be checked because Building Code is invalid or missing.' });
    }

    let unitTypeId: string | null = null;
    let usageType = 'commercial';
    if (typeName) {
      const match = master.unitTypes.get(normalize(typeName));
      if (!match) errors.push({ field: 'Unit Type', code: 'NOT_FOUND', message: `Unit Type "${typeName}" was not found.`, value: typeName ?? undefined });
      else {
        unitTypeId = match.id;
        usageType = match.category;
      }
    }

    let statusId: string | null = null;
    if (statusName) {
      const match = master.unitStatuses.get(normalize(statusName));
      if (!match) errors.push({ field: 'Unit Status', code: 'NOT_FOUND', message: `Unit Status "${statusName}" was not found.`, value: statusName ?? undefined });
      else statusId = match.id;
    }

    if (code) {
      const key = normalize(code);
      if (seenInFile.has(key)) {
        errors.push({ field: 'Unit Code', code: 'DUPLICATE_IN_FILE', message: `Unit Code "${code}" appears more than once in this file (first at row ${seenInFile.get(key)}).` });
      } else {
        seenInFile.set(key, rowNumber);
      }
    }

    const existingRow = code ? existingUnitByCode.get(normalize(code)) : undefined;
    let action: RowAction = 'error';
    const changes: FieldChange[] = [];

    if (errors.length === 0) {
      if (existingRow) {
        if (mode === 'create_only') {
          action = 'skip';
          warnings.push({ code: 'DUPLICATE_EXISTING', message: 'Duplicate existing record — Unit Code already exists (Create Only mode).' });
        } else {
          action = 'update';
          const next: Array<[string, unknown, unknown]> = [
            ['Unit Number', existingRow.unitNumber, unitNumber],
            ['Building', existingRow.buildingId, buildingId],
            ['Floor', existingRow.floorId, floorId],
            ['Bedrooms', existingRow.bedroomCount, bedrooms],
            ['Bathrooms', existingRow.bathroomCount, bathrooms],
            ['Area', existingRow.grossArea, area],
            ['Description', existingRow.descriptionEn, description],
          ];
          for (const [field, from, to] of next) {
            if ((from ?? null) !== (to ?? null)) changes.push({ field, from, to });
          }
        }
      } else if (mode === 'update_existing') {
        action = 'error';
        errors.push({ field: 'Unit Code', code: 'NOT_FOUND', message: `Unit Code "${code}" does not exist (Update Existing mode requires an existing record).` });
      } else {
        action = 'create';
      }
    }

    results.push({
      rowNumber,
      code: code ?? '',
      unitNumber,
      propertyCode: propertyCode ?? '',
      action: errors.length > 0 ? 'error' : action,
      existingId: existingRow?.id ?? null,
      values:
        errors.length === 0 && unitNumber && unitTypeId && statusId && (propertyId || pendingProperties.get(normalize(propertyCode ?? '')))
          ? { propertyId: propertyId ?? '', buildingId, floorId, unitNumber, unitTypeId, usageType, statusId, bedroomCount: bedrooms, bathroomCount: bathrooms, grossArea: area, descriptionEn: description, annualRent: rent }
          : null,
      changes,
      errors,
      warnings,
    });
  }

  const summary: SectionSummary = {
    total: results.length,
    create: results.filter((r) => r.action === 'create').length,
    update: results.filter((r) => r.action === 'update').length,
    skip: results.filter((r) => r.action === 'skip').length,
    error: results.filter((r) => r.action === 'error').length,
    warning: results.filter((r) => r.warnings.length > 0).length,
  };

  return { summary, results };
}

/* -------------------------------------------------------------------------- */
/* Combined preview                                                            */
/* -------------------------------------------------------------------------- */

export async function buildPreview(
  organizationId: string,
  input: { propertyRows: RawRow[]; unitRows: RawRow[]; mode: ImportMode },
): Promise<ImportPreview> {
  const propertyResult = await validateProperties(organizationId, input.propertyRows, input.mode);
  const unitResult = await validateUnits(organizationId, input.unitRows, input.mode, propertyResult.validByCode);

  const canImport =
    propertyResult.results.every((r) => r.action !== 'error') &&
    unitResult.results.every((r) => r.action !== 'error') &&
    (propertyResult.summary.total > 0 || unitResult.summary.total > 0);

  return { properties: { summary: propertyResult.summary, results: propertyResult.results }, units: { summary: unitResult.summary, results: unitResult.results }, canImport };
}

/* -------------------------------------------------------------------------- */
/* Transactional execution                                                     */
/* -------------------------------------------------------------------------- */

export interface ExecuteResult {
  batchId: string;
  properties: { imported: number; updated: number; skipped: number; errors: number };
  units: { imported: number; updated: number; skipped: number; errors: number };
}

export async function executeImport(
  actor: SessionUser,
  input: { propertyRows: RawRow[]; unitRows: RawRow[]; mode: ImportMode; fileName: string; fileType: 'xlsx' | 'csv'; skipErrorRows?: boolean },
): Promise<ExecuteResult> {
  const db = await getDb();
  // Pre-warm the settings cache before opening the transaction (PGlite single-connection safety) —
  // computeUnitAvailability (run after commit) reads it too, so warming once here covers both.
  await getPolicy(actor.organizationId);

  const entityType = input.propertyRows.length > 0 && input.unitRows.length > 0 ? 'property_unit' : input.propertyRows.length > 0 ? 'property' : 'unit';

  const [batch] = await db
    .insert(importBatches)
    .values({
      organizationId: actor.organizationId,
      entityType,
      fileName: input.fileName,
      fileType: input.fileType,
      mode: input.mode,
      status: 'validating',
      totalRows: input.propertyRows.length + input.unitRows.length,
      startedAt: new Date(),
      userId: actor.id,
    })
    .returning({ id: importBatches.id });

  // Re-validate defensively — never trust a client-held preview for the write.
  const propertyValidation = await validateProperties(actor.organizationId, input.propertyRows, input.mode);
  const unitValidation = await validateUnits(actor.organizationId, input.unitRows, input.mode, propertyValidation.validByCode);

  const propertyErrorRows = propertyValidation.results.filter((r) => r.action === 'error');
  const unitErrorRows = unitValidation.results.filter((r) => r.action === 'error');

  if ((propertyErrorRows.length > 0 || unitErrorRows.length > 0) && !input.skipErrorRows) {
    await db.insert(importErrors).values([
      ...propertyErrorRows.flatMap((r) => r.errors.map((e) => ({ batchId: batch.id, rowNumber: r.rowNumber, field: e.field ?? null, errorCode: e.code, message: e.message, rowData: { code: r.code, unitCode: null, value: e.value ?? null } }))),
      ...unitErrorRows.flatMap((r) => r.errors.map((e) => ({ batchId: batch.id, rowNumber: r.rowNumber, field: e.field ?? null, errorCode: e.code, message: e.message, rowData: { code: r.propertyCode, unitCode: r.code, value: e.value ?? null } }))),
    ]);
    await db
      .update(importBatches)
      .set({
        status: 'failed',
        validRows: propertyValidation.summary.create + propertyValidation.summary.update + unitValidation.summary.create + unitValidation.summary.update,
        invalidRows: propertyErrorRows.length + unitErrorRows.length,
        errorSummary: 'Validation failed — no rows were imported.',
        updatedAt: new Date(),
      })
      .where(eq(importBatches.id, batch.id));
    throw validationError('Some rows failed validation. No rows were imported. Download the error report for details.', { batchId: batch.id });
  }

  // "Import valid rows only" (skipErrorRows): record the errors for the
  // report, but proceed to write everything that IS valid.
  if ((propertyErrorRows.length > 0 || unitErrorRows.length > 0) && input.skipErrorRows) {
    await db.insert(importErrors).values([
      ...propertyErrorRows.flatMap((r) => r.errors.map((e) => ({ batchId: batch.id, rowNumber: r.rowNumber, field: e.field ?? null, errorCode: e.code, message: e.message, rowData: { code: r.code, unitCode: null, value: e.value ?? null } }))),
      ...unitErrorRows.flatMap((r) => r.errors.map((e) => ({ batchId: batch.id, rowNumber: r.rowNumber, field: e.field ?? null, errorCode: e.code, message: e.message, rowData: { code: r.propertyCode, unitCode: r.code, value: e.value ?? null } }))),
    ]);
  }

  const propertyIdByCode = new Map<string, string>();
  const createdEntityIds: string[] = [];
  let propertiesImported = 0;
  let propertiesUpdated = 0;
  let unitsImported = 0;
  let unitsUpdated = 0;
  const createdOrUpdatedUnitIds: string[] = [];

  try {
    await db.transaction(async (tx) => {
      for (const row of propertyValidation.results) {
        if (row.action === 'skip' || row.action === 'error') continue;
        if (!row.values) continue;
        if (row.action === 'create') {
          const [created] = await tx
            .insert(properties)
            .values({
              organizationId: actor.organizationId,
              code: row.code,
              nameEn: row.values.nameEn,
              nameAr: row.values.nameAr,
              propertyTypeId: row.values.propertyTypeId,
              cityId: row.values.cityId,
              districtId: row.values.districtId,
              addressLine: row.values.addressLine,
              status: row.values.status,
              descriptionEn: row.values.descriptionEn,
            })
            .returning({ id: properties.id });
          propertyIdByCode.set(normalize(row.code), created.id);
          createdEntityIds.push(created.id);
          propertiesImported += 1;
          await recordAudit(tx, { organizationId: actor.organizationId, action: 'create', entityType: 'property', entityId: created.id, entityLabel: row.values.nameEn, newValue: row.values, reason: `Bulk import (batch ${batch.id})`, actor: { id: actor.id, fullName: actor.fullName } });
        } else if (row.action === 'update' && row.existingId) {
          await tx
            .update(properties)
            .set({ nameEn: row.values.nameEn, nameAr: row.values.nameAr, districtId: row.values.districtId, addressLine: row.values.addressLine, status: row.values.status, descriptionEn: row.values.descriptionEn, updatedAt: new Date() })
            .where(eq(properties.id, row.existingId));
          propertyIdByCode.set(normalize(row.code), row.existingId);
          propertiesUpdated += 1;
          await recordAudit(tx, { organizationId: actor.organizationId, action: 'update', entityType: 'property', entityId: row.existingId, entityLabel: row.values.nameEn, previousValue: {}, newValue: row.values, reason: `Bulk import (batch ${batch.id})`, actor: { id: actor.id, fullName: actor.fullName } });
        }
      }

      for (const row of unitValidation.results) {
        if (row.action === 'skip' || row.action === 'error') continue;
        if (!row.values) continue;
        const propertyId = row.values.propertyId || propertyIdByCode.get(normalize(row.propertyCode));
        if (!propertyId) throw conflict(`Unit row ${row.rowNumber}: parent property could not be resolved.`);

        if (row.action === 'create') {
          const [created] = await tx
            .insert(units)
            .values({
              organizationId: actor.organizationId,
              propertyId,
              buildingId: row.values.buildingId,
              floorId: row.values.floorId,
              code: row.code,
              unitNumber: row.values.unitNumber,
              unitTypeId: row.values.unitTypeId,
              usageType: row.values.usageType,
              statusId: row.values.statusId,
              bedroomCount: row.values.bedroomCount,
              bathroomCount: row.values.bathroomCount,
              grossArea: row.values.grossArea,
              leasableArea: row.values.grossArea,
              descriptionEn: row.values.descriptionEn,
            })
            .returning({ id: units.id });
          createdEntityIds.push(created.id);
          createdOrUpdatedUnitIds.push(created.id);
          unitsImported += 1;
          if (row.values.annualRent !== null) {
            await tx.insert(unitPricing).values({ unitId: created.id, askingRent: round2(row.values.annualRent) });
          }
          await recordAudit(tx, { organizationId: actor.organizationId, action: 'create', entityType: 'unit', entityId: created.id, entityLabel: row.values.unitNumber, newValue: row.values, reason: `Bulk import (batch ${batch.id})`, actor: { id: actor.id, fullName: actor.fullName } });
        } else if (row.action === 'update' && row.existingId) {
          await tx
            .update(units)
            .set({ buildingId: row.values.buildingId, floorId: row.values.floorId, unitNumber: row.values.unitNumber, bedroomCount: row.values.bedroomCount, bathroomCount: row.values.bathroomCount, grossArea: row.values.grossArea, leasableArea: row.values.grossArea, descriptionEn: row.values.descriptionEn, updatedAt: new Date() })
            .where(eq(units.id, row.existingId));
          createdOrUpdatedUnitIds.push(row.existingId);
          unitsUpdated += 1;
          if (row.values.annualRent !== null) {
            const [existingPricing] = await tx.select({ unitId: unitPricing.unitId }).from(unitPricing).where(eq(unitPricing.unitId, row.existingId)).limit(1);
            if (existingPricing) await tx.update(unitPricing).set({ askingRent: round2(row.values.annualRent), updatedAt: new Date() }).where(eq(unitPricing.unitId, row.existingId));
            else await tx.insert(unitPricing).values({ unitId: row.existingId, askingRent: round2(row.values.annualRent) });
          }
          await recordAudit(tx, { organizationId: actor.organizationId, action: 'update', entityType: 'unit', entityId: row.existingId, entityLabel: row.values.unitNumber, previousValue: {}, newValue: row.values, reason: `Bulk import (batch ${batch.id})`, actor: { id: actor.id, fullName: actor.fullName } });
        }
      }

      await recordAudit(tx, { organizationId: actor.organizationId, action: 'import', entityType: 'import_batch', entityId: batch.id, entityLabel: input.fileName, newValue: { propertiesImported, propertiesUpdated, unitsImported, unitsUpdated }, actor: { id: actor.id, fullName: actor.fullName } });
    });
  } catch (error) {
    await db
      .update(importBatches)
      .set({ status: 'failed', errorSummary: error instanceof Error ? error.message : 'Unexpected failure during import.', updatedAt: new Date() })
      .where(eq(importBatches.id, batch.id));
    throw error;
  }

  // The availability engine reads settings on its own connection — run after
  // the transaction commits, never inside it (PGlite single-connection rule).
  for (const unitId of createdOrUpdatedUnitIds) {
    await computeUnitAvailability(db, unitId, actor.organizationId);
  }

  const skippedTotal = propertyValidation.summary.skip + unitValidation.summary.skip;
  const warningTotal = propertyValidation.summary.warning + unitValidation.summary.warning;
  const errorTotal = propertyErrorRows.length + unitErrorRows.length;
  await db
    .update(importBatches)
    .set({
      status: errorTotal > 0 ? 'completed_with_errors' : skippedTotal > 0 || warningTotal > 0 ? 'completed_with_errors' : 'completed',
      validRows: propertiesImported + propertiesUpdated + unitsImported + unitsUpdated,
      invalidRows: errorTotal,
      duplicateRows: skippedTotal,
      importedRows: propertiesImported + unitsImported,
      updatedRows: propertiesUpdated + unitsUpdated,
      skippedRows: skippedTotal,
      warningRows: warningTotal,
      createdEntityIds,
      importedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(importBatches.id, batch.id));

  return {
    batchId: batch.id,
    properties: { imported: propertiesImported, updated: propertiesUpdated, skipped: propertyValidation.summary.skip, errors: propertyErrorRows.length },
    units: { imported: unitsImported, updated: unitsUpdated, skipped: unitValidation.summary.skip, errors: unitErrorRows.length },
  };
}

/* -------------------------------------------------------------------------- */
/* Import history                                                              */
/* -------------------------------------------------------------------------- */

export async function listImportBatches(organizationId: string, limit = 50) {
  const db = await getDb();
  return db.select().from(importBatches).where(eq(importBatches.organizationId, organizationId)).orderBy(desc(importBatches.createdAt)).limit(limit);
}

export async function getImportBatch(organizationId: string, batchId: string) {
  const db = await getDb();
  const [row] = await db.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.organizationId, organizationId))).limit(1);
  if (!row) throw notFound('Import batch', batchId);
  return row;
}

export async function getImportBatchErrors(organizationId: string, batchId: string) {
  await getImportBatch(organizationId, batchId);
  const db = await getDb();
  return db.select().from(importErrors).where(eq(importErrors.batchId, batchId)).orderBy(importErrors.rowNumber);
}
