
const PALETTE = ["#0071eb", "#e8a800", "#2bb871", "#8c4bd6", "#e5560f", "#00a3b4", "#d6336c", "#5b6b7f"];

export function colorFor(uid: string) {
  let h = 0;
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function Avatar({
  user,
  uid,
  name,
  size = 36,
  online,
}: {
  user?: CometChat.User;
  uid?: string;
  name?: string;
  size?: number;
  online?: boolean;
}) {
  const id = user?.getUid() ?? uid ?? "?";
  const n = user?.getName() ?? name ?? "?";
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.42 }} title={n}>
      {initials(n)}
      {online !== undefined && <i className={online ? "dot on" : "dot"} />}
    </span>
  );
}
