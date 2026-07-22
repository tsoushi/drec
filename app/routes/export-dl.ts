import type { Route } from "./+types/export-dl";
import {
  exportCommentsCSV,
  exportJSON,
  exportMentalStatesCSV,
  exportRecordsCSV,
} from "../db/export.server";
import { nowLocalISO } from "../lib/time";

// Resource route (no component): streams the requested dump as a download.

export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const target = new URL(request.url).searchParams.get("target");
  const stamp = nowLocalISO().slice(0, 10);

  let body: string;
  let type: string;
  let name: string;
  switch (target) {
    case "records.csv":
      body = exportRecordsCSV();
      type = "text/csv; charset=utf-8";
      name = `drec-records-${stamp}.csv`;
      break;
    case "comments.csv":
      body = exportCommentsCSV();
      type = "text/csv; charset=utf-8";
      name = `drec-comments-${stamp}.csv`;
      break;
    case "mentals.csv":
      body = exportMentalStatesCSV();
      type = "text/csv; charset=utf-8";
      name = `drec-mentals-${stamp}.csv`;
      break;
    case "all.json":
      body = exportJSON();
      type = "application/json; charset=utf-8";
      name = `drec-all-${stamp}.json`;
      break;
    default:
      return new Response("unknown target", { status: 400 });
  }

  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
