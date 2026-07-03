import { db } from "./db.server";

// Read-only query for the monthly report screen (routes/report.tsx).

export type MonthlyDrugRow = {
  month: string; // 'YYYY-MM' (from the local-ISO taken_at)
  drug_name: string;
  unit: string | null;
  times: number;
  total: number | null; // SUM(amount); null when no row had an amount
};

const monthlyStmt = db.prepare(
  `SELECT substr(taken_at, 1, 7) AS month, drug_name, unit,
          COUNT(*) AS times, SUM(amount) AS total
     FROM records
    WHERE deleted_at IS NULL
    GROUP BY month, drug_name, unit
    ORDER BY month DESC, times DESC, drug_name`,
);

export function getMonthlyReport(): MonthlyDrugRow[] {
  return monthlyStmt.all() as MonthlyDrugRow[];
}
