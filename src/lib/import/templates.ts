import 'server-only';
import ExcelJS from 'exceljs';

/**
 * Downloadable bulk-import templates (Phase 20A). Column headers here are the
 * authoritative contract the validation engine expects — keep them in sync
 * with `PROPERTY_COLUMNS` / `UNIT_COLUMNS` in `import-service.ts`.
 */

const BRAND_BROWN = 'FF3A2B1F';
const BRAND_GOLD = 'FFC9A96A';

function styleHeaderRow(sheet: ExcelJS.Worksheet, row: number, count: number) {
  const headerRow = sheet.getRow(row);
  for (let i = 1; i <= count; i += 1) {
    const cell = headerRow.getCell(i);
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_BROWN } };
  }
  headerRow.height = 18;
  sheet.views = [{ state: 'frozen', ySplit: row }];
}

function addInstructionsSheet(workbook: ExcelJS.Workbook, lines: Array<{ text: string; bold?: boolean; heading?: boolean }>) {
  const sheet = workbook.addWorksheet('Instructions', { properties: { tabColor: { argb: BRAND_GOLD } } });
  sheet.getColumn(1).width = 110;
  let r = 1;
  for (const line of lines) {
    const cell = sheet.getCell(r, 1);
    cell.value = line.text;
    if (line.heading) cell.font = { bold: true, size: 13, color: { argb: BRAND_BROWN } };
    else if (line.bold) cell.font = { bold: true, size: 10.5 };
    else cell.font = { size: 10.5 };
    cell.alignment = { wrapText: true, vertical: 'top' };
    r += 1;
  }
}

export const PROPERTY_TEMPLATE_HEADERS = [
  'Property Code',
  'Property Name (EN)',
  'Property Name (AR)',
  'Property Type',
  'City',
  'District',
  'Address',
  'Status',
  'Description',
];

export async function buildPropertyTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RIFTARA';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Properties');
  sheet.columns = [
    { header: 'Property Code', key: 'code', width: 18 },
    { header: 'Property Name (EN)', key: 'nameEn', width: 32 },
    { header: 'Property Name (AR)', key: 'nameAr', width: 32 },
    { header: 'Property Type', key: 'type', width: 18 },
    { header: 'City', key: 'city', width: 16 },
    { header: 'District', key: 'district', width: 18 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Description', key: 'description', width: 40 },
  ];
  styleHeaderRow(sheet, 1, sheet.columns.length);
  sheet.addRow({
    code: 'RYD-GRN-01',
    nameEn: 'Granada Residential',
    nameAr: 'غرناطة السكني',
    type: 'Residential',
    city: 'Riyadh',
    district: 'Al Yasmin',
    address: 'King Fahd Road, Riyadh',
    status: 'active',
    description: 'Sample row — replace with your data or delete before uploading.',
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  addInstructionsSheet(workbook, [
    { text: 'RIFTARA — Property Import Template', heading: true },
    { text: '' },
    { text: 'Required fields', bold: true },
    { text: '  Property Code — unique per organization. Reused to detect duplicates and to link Units to this property.' },
    { text: '  Property Name (EN) — the property\'s English name.' },
    { text: '  Property Type — must match an existing property type name exactly (e.g. Residential, Commercial, Office, Retail, Mixed-Use). Spelling must match; a typo is a validation error, not auto-created.' },
    { text: '  City — must match an existing city name exactly.' },
    { text: '' },
    { text: 'Optional fields', bold: true },
    { text: '  Property Name (AR), District (must belong to the selected City), Address, Description.' },
    { text: '  Status — one of: active, under_construction, under_renovation, planned, disposed, inactive. Defaults to "active" if left blank.' },
    { text: '' },
    { text: 'Fields NOT imported (derived automatically)', bold: true },
    { text: '  Total Units, Occupied, Available, Occupancy % and Annual Rental Value are always computed by RIFTARA from the actual unit and contract data — they cannot be set by import, to keep dashboards consistent.' },
    { text: '' },
    { text: 'Duplicate & update behavior', bold: true },
    { text: '  "Create Only" (default): a Property Code that already exists in RIFTARA is skipped, not duplicated.' },
    { text: '  "Update Existing": a Property Code that already exists updates that property\'s fields; a Property Code that does not exist is an error.' },
    { text: '  "Create + Update": creates new codes and updates existing ones.' },
    { text: '' },
    { text: 'Notes', bold: true },
    { text: '  Delete the sample data row before uploading your real data.' },
    { text: '  A combined workbook may also include a "Units" sheet — see the Unit Import Template for its columns. Units reference properties by Property Code.' },
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const UNIT_TEMPLATE_HEADERS = [
  'Property Code',
  'Building Code',
  'Floor',
  'Unit Code',
  'Unit Number',
  'Unit Type',
  'Unit Status',
  'Bedrooms',
  'Bathrooms',
  'Area (sqm)',
  'Annual Rent (SAR)',
  'Description',
];

export async function buildUnitTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RIFTARA';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Units');
  sheet.columns = [
    { header: 'Property Code', key: 'propertyCode', width: 18 },
    { header: 'Building Code', key: 'buildingCode', width: 16 },
    { header: 'Floor', key: 'floor', width: 10 },
    { header: 'Unit Code', key: 'unitCode', width: 22 },
    { header: 'Unit Number', key: 'unitNumber', width: 16 },
    { header: 'Unit Type', key: 'unitType', width: 16 },
    { header: 'Unit Status', key: 'unitStatus', width: 16 },
    { header: 'Bedrooms', key: 'bedrooms', width: 10 },
    { header: 'Bathrooms', key: 'bathrooms', width: 10 },
    { header: 'Area (sqm)', key: 'area', width: 12 },
    { header: 'Annual Rent (SAR)', key: 'rent', width: 18 },
    { header: 'Description', key: 'description', width: 36 },
  ];
  styleHeaderRow(sheet, 1, sheet.columns.length);
  sheet.addRow({
    propertyCode: 'RYD-GRN-01', buildingCode: 'BLD-A', floor: 'GF', unitCode: 'RYD-GRN-01-A-001', unitNumber: 'A-001',
    unitType: 'Apartment', unitStatus: 'available', bedrooms: 2, bathrooms: 2, area: 120, rent: 45000,
    description: 'Sample row — replace with your data or delete before uploading.',
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  addInstructionsSheet(workbook, [
    { text: 'RIFTARA — Unit Import Template', heading: true },
    { text: '' },
    { text: 'Required fields', bold: true },
    { text: '  Property Code — must exactly match an existing property\'s code (or one created earlier in the same combined workbook). A unit cannot be imported without a resolvable parent property.' },
    { text: '  Unit Code — unique per organization.' },
    { text: '  Unit Number — the unit\'s display number (e.g. A-001).' },
    { text: '  Unit Type — must match an existing unit type name exactly (e.g. Apartment, Office, Shop, Warehouse).' },
    { text: '  Unit Status — must match an existing unit status name exactly (e.g. available, reserved, leased, not_available), or a status key.' },
    { text: '' },
    { text: 'Optional fields', bold: true },
    { text: '  Building Code — must belong to the resolved property. Floor is matched by its level/name within that building.' },
    { text: '  Bedrooms, Bathrooms, Area (sqm), Annual Rent (SAR), Description.' },
    { text: '' },
    { text: 'Fields NOT imported (derived automatically)', bold: true },
    { text: '  Availability class and "available from" date are always computed by RIFTARA\'s availability engine from the unit\'s status, contracts and reservations — not set directly by import.' },
    { text: '' },
    { text: 'Duplicate & update behavior', bold: true },
    { text: '  Same as Properties: "Create Only" (default) skips an existing Unit Code, "Update Existing" updates it, "Create + Update" does both.' },
    { text: '' },
    { text: 'Relationship rules', bold: true },
    { text: '  Do not guess a property from its name — always reference the stable Property Code.' },
    { text: '  RIFTARA never creates a Building or Floor automatically from a typo; an unresolvable Building Code or Floor is a validation error.' },
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Combined workbook: Properties + Units + Instructions, for importing a full portfolio in one file. */
export async function buildCombinedTemplate(): Promise<Buffer> {
  const propBuf = await buildPropertyTemplate();
  const unitBuf = await buildUnitTemplate();

  const propWb = new ExcelJS.Workbook();
  const unitWb = new ExcelJS.Workbook();
  // exceljs's own .d.ts declares a conflicting global Buffer type — cast through any.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await propWb.xlsx.load(propBuf as any);
  await unitWb.xlsx.load(unitBuf as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const combined = new ExcelJS.Workbook();
  combined.creator = 'RIFTARA';
  combined.created = new Date();

  const copySheet = (source: ExcelJS.Worksheet, name: string) => {
    const target = combined.addWorksheet(name);
    target.columns = source.columns?.map((c) => ({ key: c.key, width: c.width })) ?? [];
    source.eachRow((row) => {
      const values = row.values as (string | number | undefined)[];
      target.addRow(values.slice(1));
    });
    target.views = source.views;
    target.autoFilter = source.autoFilter;
    styleHeaderRow(target, 1, target.columns.length);
    return target;
  };

  copySheet(propWb.getWorksheet('Properties')!, 'Properties');
  copySheet(unitWb.getWorksheet('Units')!, 'Units');

  addInstructionsSheet(combined, [
    { text: 'RIFTARA — Combined Property + Unit Import Template', heading: true },
    { text: '' },
    { text: 'This workbook imports Properties and their Units together in one file.' },
    { text: '' },
    { text: 'Sheet 1: Properties — see the "Properties" sheet header row for required/optional columns.' },
    { text: 'Sheet 2: Units — reference the parent property by its Property Code, which must appear in the Properties sheet (or already exist in RIFTARA).' },
    { text: '' },
    { text: 'Import order', bold: true },
    { text: '  1. All Properties rows are validated first.' },
    { text: '  2. All Units rows are then validated against both existing properties and the Properties sheet in this same file.' },
    { text: '  3. If everything is valid, Properties are created/updated first, then Units — as one transaction. If a fatal error occurs, nothing is written.' },
    { text: '' },
    { text: 'See the individual Property and Unit templates for the full field reference, allowed values and duplicate/update rules.' },
  ]);

  return Buffer.from(await combined.xlsx.writeBuffer());
}
