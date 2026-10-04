
const PALETTE = ["#ff5a5f", "#ffb020", "#3ecf8e", "#4f8cff", "#b26bff", "#ff7ac6", "#2ec4d6", "#f2734b"];

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
    <span className="avatar" style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.4 }} title={n}>
      {initials(n)}
      {online !== undefined && <i className={online ? "dot on" : "dot"} />}
    </span>
  );
}
