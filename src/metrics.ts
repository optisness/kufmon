export type MetricKey =
  | "syncRuns"
  | "adsFetched"
  | "newListings"
  | "changedListings"
  | "priceChanges"
  | "alertsSent"
  | "deactivations";

export const metrics: Record<MetricKey, number> = {
  syncRuns: 0,
  adsFetched: 0,
  newListings: 0,
  changedListings: 0,
  priceChanges: 0,
  alertsSent: 0,
  deactivations: 0,
};

export function incMetric(key: MetricKey, value = 1) {
  metrics[key] += value;
}
