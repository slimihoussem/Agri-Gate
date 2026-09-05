import { z } from "zod";

export const trendQuerySchema = z.object({
  hours: z.coerce
    .number()
    .int("hours must be an integer")
    .min(1, "hours must be >= 1")
    .max(24 * 30, "hours must be <= 720")
    .default(24),
});
export type TrendQuery = z.infer<typeof trendQuerySchema>;

export const trendPointSchema = z.object({
  time: z.string(),
  avgMoisture: z.number(),
});

export const zoneTrendSchema = z.object({
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  points: z.array(trendPointSchema),
});
export type ZoneTrend = z.infer<typeof zoneTrendSchema>;
