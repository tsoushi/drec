import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("notes", "routes/notes.tsx"),
  route("calendar", "routes/calendar.tsx"),
  route("stats", "routes/stats.tsx"),
  route("search", "routes/search.tsx"),
  route("export", "routes/export.tsx"),
  route("export/dl", "routes/export-dl.ts"),
  route("logs", "routes/logs.tsx"),
  route("graph", "routes/graph.tsx"),
  route("report", "routes/report.tsx"),
] satisfies RouteConfig;
