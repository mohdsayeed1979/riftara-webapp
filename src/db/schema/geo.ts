import { relations } from 'drizzle-orm';
import { boolean, index, numeric, pgTable, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { isDemo, pk, timestamps } from './_shared';
import { organizations } from './org';

/**
 * Geographic + ownership hierarchy (BRD 4):
 * Portfolio > Region > City > District > Property > Building > Floor > Unit.
 * Levels are optional: a property may attach directly to a city.
 */
export const portfolios = pgTable(
  'portfolios',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [unique('portfolios_org_code_uq').on(t.organizationId, t.code)],
);

export const regions = pgTable(
  'regions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [unique('regions_org_code_uq').on(t.organizationId, t.code)],
);

export const cities = pgTable(
  'cities',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    regionId: uuid('region_id').references(() => regions.id, { onDelete: 'set null' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    latitude: numeric('latitude', { precision: 10, scale: 7, mode: 'number' }),
    longitude: numeric('longitude', { precision: 10, scale: 7, mode: 'number' }),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('cities_org_code_uq').on(t.organizationId, t.code),
    index('cities_region_idx').on(t.regionId),
  ],
);

export const districts = pgTable(
  'districts',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }),
    latitude: numeric('latitude', { precision: 10, scale: 7, mode: 'number' }),
    longitude: numeric('longitude', { precision: 10, scale: 7, mode: 'number' }),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: isDemo(),
    ...timestamps,
  },
  (t) => [
    unique('districts_org_code_uq').on(t.organizationId, t.code),
    index('districts_city_idx').on(t.cityId),
  ],
);

export const regionsRelations = relations(regions, ({ many }) => ({ cities: many(cities) }));

export const citiesRelations = relations(cities, ({ one, many }) => ({
  region: one(regions, { fields: [cities.regionId], references: [regions.id] }),
  districts: many(districts),
}));

export const districtsRelations = relations(districts, ({ one }) => ({
  city: one(cities, { fields: [districts.cityId], references: [cities.id] }),
}));
