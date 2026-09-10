import { z } from 'zod';
import { REPORT_FREQUENCIES, REPORT_PERIODS, REPORT_TYPES } from './catalog';

/**
 * Shared validation for report-schedule input, reused by the REST API and the
 * Server Actions behind the admin UI so both enforce the same rules. Timing
 * fields are clamped again in the service; org/property scope is never trusted
 * from the client — it is derived from the creator's live session at execution.
 */

export const scheduleConfigSchema = z.object({
  period: z.enum(REPORT_PERIODS).default('12m'),
  propertyId: z.string().uuid().nullable().optional(),
  commentary: z.string().max(4000).nullable().optional(),
});

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  reportType: z.enum(REPORT_TYPES),
  frequency: z.enum(REPORT_FREQUENCIES),
  hour: z.number().int().min(0).max(23).optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  config: scheduleConfigSchema,
});

export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  reportType: z.enum(REPORT_TYPES).optional(),
  frequency: z.enum(REPORT_FREQUENCIES).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  config: scheduleConfigSchema.optional(),
  isActive: z.boolean().optional(),
});

export type CreateScheduleInputDto = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInputDto = z.infer<typeof updateScheduleSchema>;
