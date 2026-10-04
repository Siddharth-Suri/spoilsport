import { createSession } from "./_session.js";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, json } = await createSession(body, process.env);
  return Response.json(json, { status, headers: { "cache-control": "no-store" } });
}
