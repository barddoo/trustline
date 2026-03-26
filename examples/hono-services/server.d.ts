import type { Server } from "node:http";

export function serveApp(options: {
  fetch: (request: Request) => Promise<Response> | Response;
  name: string;
  port: number;
}): Server;
