import { db } from "./db.server";

// Read-only queries for the concentration-graph screen (routes/graph.tsx).
// Kept separate from records.server.ts so the screen stays independent.

export type GraphDrug = {
  name: string;
  count: number; // all active records of this drug (incl. ones without amount)
  last_taken_at: string;
};

export type GraphDose = {
  drug_name: string;
  taken_at: string;
  amount: number;
};

const drugsStmt = db.prepare(
  `SELECT drug_name AS name, COUNT(*) AS count, MAX(taken_at) AS last_taken_at
     FROM records
    WHERE deleted_at IS NULL
    GROUP BY drug_name
    ORDER BY last_taken_at DESC`,
);

// Only rows with a numeric amount can contribute to the curve.
const dosesStmt = db.prepare(
  `SELECT drug_name, taken_at, amount
     FROM records
    WHERE deleted_at IS NULL AND amount IS NOT NULL
    ORDER BY taken_at`,
);

export function getGraphData(): { drugs: GraphDrug[]; doses: GraphDose[] } {
  return {
    drugs: drugsStmt.all() as GraphDrug[],
    doses: dosesStmt.all() as GraphDose[],
  };
}
