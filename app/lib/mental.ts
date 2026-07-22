// Mental-state scale bounds, shared by client (form/graph) and server (clamp).
// Kept out of *.server.ts so the client bundle can import the runtime values.
export const MENTAL_MIN = -10;
export const MENTAL_MAX = 10;
