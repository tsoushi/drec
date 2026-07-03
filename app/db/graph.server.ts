import { db } from "./db.server";
import { nowLocalISO } from "../lib/time";

// Queries for the concentration-graph screen (routes/graph.tsx).
// Kept separate from records.server.ts so the screen stays independent.
// Note: graph_settings stores view preferences (not medication data), so its
// writes intentionally do NOT go through logChange.

export type GraphDrug = {
  name: string;
  count: number; // all active records of this drug (incl. ones without amount)
  last_taken_at: string;
};

export type GraphDose = {
  id: number;
  drug_name: string;
  product_name: string | null;
  amount: number;
  unit: string | null;
  taken_at: string;
  taken_error_min: number | null;
  peak_min: number | null; // per-record Tmax override (minutes)
  note: string | null;
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
  `SELECT id, drug_name, product_name, amount, unit, taken_at, taken_error_min, peak_min, note
     FROM records
    WHERE deleted_at IS NULL AND amount IS NOT NULL
    ORDER BY taken_at`,
);

export type GraphSettings = {
  unit: number;
  tmax_min: number;
  half_min: number;
  window_h: number;
};

const settingsStmt = db.prepare(
  `SELECT drug_name, unit, tmax_min, half_min, window_h FROM graph_settings`,
);

const upsertSettingsStmt = db.prepare(
  `INSERT INTO graph_settings (drug_name, unit, tmax_min, half_min, window_h, updated_at)
   VALUES (@drug_name, @unit, @tmax_min, @half_min, @window_h, @updated_at)
   ON CONFLICT(drug_name) DO UPDATE SET
     unit = excluded.unit,
     tmax_min = excluded.tmax_min,
     half_min = excluded.half_min,
     window_h = excluded.window_h,
     updated_at = excluded.updated_at`,
);

export type GraphTag = { name: string; drugs: string[] };

const tagsStmt = db.prepare(`SELECT name FROM graph_tags ORDER BY name`);
const tagDrugsStmt = db.prepare(
  `SELECT tag_name, drug_name FROM graph_tag_drugs ORDER BY tag_name, drug_name`,
);

export function getGraphData(): {
  drugs: GraphDrug[];
  doses: GraphDose[];
  settings: Record<string, GraphSettings>;
  tags: GraphTag[];
} {
  const settings: Record<string, GraphSettings> = {};
  for (const row of settingsStmt.all() as Array<GraphSettings & { drug_name: string }>) {
    const { drug_name, ...rest } = row;
    settings[drug_name] = rest;
  }
  const tags = (tagsStmt.all() as Array<{ name: string }>).map((t) => ({
    name: t.name,
    drugs: [] as string[],
  }));
  const byName = new Map(tags.map((t) => [t.name, t]));
  for (const r of tagDrugsStmt.all() as Array<{ tag_name: string; drug_name: string }>) {
    byName.get(r.tag_name)?.drugs.push(r.drug_name);
  }
  return {
    drugs: drugsStmt.all() as GraphDrug[],
    doses: dosesStmt.all() as GraphDose[],
    settings,
    tags,
  };
}

export function saveGraphSettings(drug: string, s: GraphSettings): void {
  upsertSettingsStmt.run({ drug_name: drug, ...s, updated_at: nowLocalISO() });
}

const createTagStmt = db.prepare(
  `INSERT OR IGNORE INTO graph_tags (name, created_at) VALUES (?, ?)`,
);
const deleteTagStmt = db.prepare(`DELETE FROM graph_tags WHERE name = ?`);
const deleteTagDrugsStmt = db.prepare(`DELETE FROM graph_tag_drugs WHERE tag_name = ?`);
const deleteTagSettingsStmt = db.prepare(`DELETE FROM graph_settings WHERE drug_name = ?`);
const addTagDrugStmt = db.prepare(
  `INSERT OR IGNORE INTO graph_tag_drugs (tag_name, drug_name) VALUES (?, ?)`,
);
const removeTagDrugStmt = db.prepare(
  `DELETE FROM graph_tag_drugs WHERE tag_name = ? AND drug_name = ?`,
);

export function createTag(name: string): void {
  createTagStmt.run(name, nowLocalISO());
}

export const deleteTag = db.transaction((name: string): void => {
  deleteTagDrugsStmt.run(name);
  deleteTagStmt.run(name);
  deleteTagSettingsStmt.run(`tag:${name}`); // stored view settings, if any
});

export function setTagDrug(tag: string, drug: string, on: boolean): void {
  if (on) addTagDrugStmt.run(tag, drug);
  else removeTagDrugStmt.run(tag, drug);
}
