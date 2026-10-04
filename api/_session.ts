// Server-only: the CometChat Auth Key never leaves the server. The browser asks for a session,
// we create a fresh user with a server-chosen UID and hand back an auth token for that user only.

type Env = { COMETCHAT_APP_ID?: string; COMETCHAT_REGION?: string; COMETCHAT_AUTH_KEY?: string };

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "viewer";

export async function createSession(body: unknown, env: Env): Promise<{ status: number; json: unknown }> {
  const { COMETCHAT_APP_ID: appId, COMETCHAT_REGION: region, COMETCHAT_AUTH_KEY: key } = env;
  if (!appId || !region || !key) return { status: 500, json: { error: "Server is missing CometChat credentials" } };

  const name = typeof (body as { name?: unknown })?.name === "string" ? (body as { name: string }).name.trim() : "";
  if (!name || name.length > 32) return { status: 400, json: { error: "Name must be 1–32 characters" } };

  const uid = `${slug(name)}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await fetch(`https://${appId}.api-${region}.cometchat.io/v3/users`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ uid, name, withAuthToken: true }),
  });
  const data = (await res.json().catch(() => ({}))) as { data?: { authToken?: string } };
  const authToken = data.data?.authToken;
  if (!res.ok || !authToken) return { status: 502, json: { error: "Could not create a CometChat session" } };
  return { status: 200, json: { uid, authToken } };
}
