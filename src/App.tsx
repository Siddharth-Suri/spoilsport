import { useEffect, useState } from "react";
import { currentUser, signIn, signOut, createRoom, joinRoom, type ShowInfo } from "./cometchat";
import Room from "./Room";
import { Avatar } from "./ui";

const roomFromUrl = () => new URLSearchParams(location.search).get("room")?.toLowerCase() ?? "";

function setRoomInUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  history.replaceState(null, "", url);
}

export default function App() {
  const [user, setUser] = useState<CometChat.User | null>(null);
  const [booting, setBooting] = useState(true);
  const [group, setGroup] = useState<CometChat.Group | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    currentUser()
      .then(setUser)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setBooting(false));
  }, []);

  // Auto-join the room from an invite link once signed in.
  useEffect(() => {
    const code = roomFromUrl();
    if (!user || !code || group) return;
    joinRoom(code)
      .then(setGroup)
      .catch(() => {
        setError(`Room “${code}” doesn't exist (yet).`);
        setRoomInUrl(null);
      });
  }, [user, group]);

  if (booting) return <div className="splash"><Logo /></div>;

  if (user && group) {
    return (
      <Room
        me={user}
        group={group}
        onLeave={() => {
          setGroup(null);
          setRoomInUrl(null);
        }}
      />
    );
  }

  return (
    <div className="landing">
      <div className="landing-copy">
        <Logo />
        <h1>
          Watch together.<br />
          <em>Spoil nothing.</em>
        </h1>
        <p>
          A group chat for people watching the same show at different speeds. Every message is stamped with
          where the sender is in the show. Anything ahead of you stays blurred until you catch up.
        </p>
        <ul className="bullets">
          <li><span>🎬</span>Set your spot: episode + minute</li>
          <li><span>🫥</span>Messages from ahead of you blur automatically</li>
          <li><span>🔓</span>Scrub forward and they unlock live</li>
        </ul>
      </div>
      <div className="card">
        {error && <div className="error">{error}</div>}
        {!user ? (
          <NameForm onDone={setUser} onError={setError} />
        ) : (
          <Lobby
            me={user}
            invited={roomFromUrl()}
            onRoom={(g) => {
              setError("");
              setRoomInUrl(g.getGuid().replace(/^wp-/, ""));
              setGroup(g);
            }}
            onError={setError}
            onSignOut={async () => {
              await signOut();
              setUser(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="logo">
      <img src="/favicon.svg" alt="" width={28} height={28} />
      <span>Spoilsport</span>
    </div>
  );
}

function NameForm({ onDone, onError }: { onDone: (u: CometChat.User) => void; onError: (e: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          onDone(await signIn(name));
          onError("");
        } catch (err) {
          onError(String((err as Error).message ?? err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="label" htmlFor="name">What should the party call you?</label>
      <input id="name" autoFocus placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
      <button className="primary" disabled={busy || !name.trim()}>{busy ? "Signing in…" : "Continue"}</button>
    </form>
  );
}

function Lobby({
  me,
  invited,
  onRoom,
  onError,
  onSignOut,
}: {
  me: CometChat.User;
  invited: string;
  onRoom: (g: CometChat.Group) => void;
  onError: (e: string) => void;
  onSignOut: () => void;
}) {
  const [show, setShow] = useState("");
  const [episodes, setEpisodes] = useState(8);
  const [epLength, setEpLength] = useState(50);
  const [code, setCode] = useState(invited);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<CometChat.Group>) => {
    setBusy(true);
    try {
      onRoom(await fn());
    } catch (err) {
      const e = err as { message?: string; code?: string };
      onError(e.code === "ERR_GUID_NOT_FOUND" ? "No room with that code." : String(e.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lobby">
      <div className="me-row">
        <Avatar user={me} />
        <div>
          <div className="me-name">{me.getName()}</div>
          <button className="link" onClick={onSignOut}>Not you?</button>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const info: ShowInfo = { show: show.trim(), episodes, epLength };
          run(async () => joinRoom(await createRoom(info)));
        }}
      >
        <div className="label">Start a watch party</div>
        <input placeholder="Show title, e.g. The Long Dark Season 1" value={show} onChange={(e) => setShow(e.target.value)} maxLength={60} />
        <div className="row">
          <label className="mini">
            Episodes
            <input type="number" min={1} max={30} value={episodes} onChange={(e) => setEpisodes(+e.target.value || 1)} />
          </label>
          <label className="mini">
            Minutes / ep
            <input type="number" min={5} max={180} value={epLength} onChange={(e) => setEpLength(+e.target.value || 5)} />
          </label>
        </div>
        <button className="primary" disabled={busy || !show.trim()}>Create room</button>
      </form>

      <div className="or"><span>or</span></div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => joinRoom(code.trim()));
        }}
      >
        <div className="label">Join with a code</div>
        <div className="row">
          <input placeholder="abc123" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="secondary" disabled={busy || !code.trim()}>Join</button>
        </div>
      </form>
    </div>
  );
}
