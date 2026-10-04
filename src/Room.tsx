import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CometChat,
  PROGRESS_TYPE,
  fetchHistory,
  fetchMembers,
  sendProgress,
  sendStampedText,
  spotLabel,
  spotValue,
  typingIndicator,
  type ShowInfo,
  type Spot,
} from "./cometchat";
import { Avatar, colorFor } from "./ui";

type Msg = {
  id: string;
  uid: string;
  name: string;
  text: string;
  spot: Spot;
  sentAt: number;
  kind: "text" | "progress";
};

type Member = { uid: string; name: string; online: boolean };

const START: Spot = { ep: 1, min: 0 };

function toMsg(m: CometChat.BaseMessage): Msg | null {
  const sender = m.getSender();
  if (m instanceof CometChat.TextMessage) {
    const spot = (m.getMetadata() as { spot?: Spot } | undefined)?.spot ?? START;
    return { id: String(m.getId()), uid: sender.getUid(), name: sender.getName(), text: m.getText(), spot, sentAt: m.getSentAt(), kind: "text" };
  }
  if (m instanceof CometChat.CustomMessage && m.getType() === PROGRESS_TYPE) {
    const spot = (m.getCustomData() as { spot?: Spot }).spot ?? START;
    return { id: String(m.getId()), uid: sender.getUid(), name: sender.getName(), text: "", spot, sentAt: m.getSentAt(), kind: "progress" };
  }
  return null;
}

/** Same length as the real text so the bubble keeps its shape, but nothing readable in the DOM. */
const scramble = (text: string) => text.replace(/\S/g, (_c, i: number) => "▇▆▅▄"[(i * 7) % 4]);

const spotKey = (guid: string) => `spoilsport:spot:${guid}`;

function loadSpot(guid: string): Spot {
  try {
    const raw = localStorage.getItem(spotKey(guid));
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  return START;
}

export default function Room({ me, group, onLeave }: { me: CometChat.User; group: CometChat.Group; onLeave: () => void }) {
  const guid = group.getGuid();
  const code = guid.replace(/^wp-/, "");
  const info = (group.getMetadata() ?? {}) as Partial<ShowInfo>;
  const episodes = info.episodes ?? 8;
  const epLength = info.epLength ?? 50;
  const total = episodes * epLength;

  const [mySpot, setMySpot] = useState<Spot>(() => loadSpot(guid));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; spot: Spot }>>({});
  const [peeked, setPeeked] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const myValue = spotValue(mySpot);
  const meUid = me.getUid();

  const addMessage = useCallback((m: Msg | null) => {
    if (!m) return;
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
  }, []);

  // Initial load + realtime listeners.
  useEffect(() => {
    let alive = true;
    fetchHistory(guid).then((list) => {
      if (!alive) return;
      setMessages(list.map(toMsg).filter((m): m is Msg => !!m));
    });
    const refreshMembers = () =>
      fetchMembers(guid).then((list) => {
        if (!alive) return;
        setMembers(list.map((u) => ({ uid: u.getUid(), name: u.getName(), online: u.getStatus() === "online" })));
      });
    refreshMembers();

    const id = `room-${guid}-${Math.random().toString(36).slice(2)}`;
    CometChat.addMessageListener(
      id,
      new CometChat.MessageListener({
        onTextMessageReceived: (m: CometChat.TextMessage) => m.getReceiverId() === guid && addMessage(toMsg(m)),
        onCustomMessageReceived: (m: CometChat.CustomMessage) => {
          if (m.getReceiverId() !== guid) return;
          addMessage(toMsg(m));
          refreshMembers();
        },
        onTypingStarted: (t: CometChat.TypingIndicator) => {
          if (t.getReceiverId() !== guid) return;
          const spot = (t.getMetadata() as { spot?: Spot } | undefined)?.spot ?? START;
          setTyping((p) => ({ ...p, [t.getSender().getUid()]: { name: t.getSender().getName(), spot } }));
        },
        onTypingEnded: (t: CometChat.TypingIndicator) => {
          setTyping((p) => {
            const n = { ...p };
            delete n[t.getSender().getUid()];
            return n;
          });
        },
      }),
    );
    CometChat.addUserListener(
      id,
      new CometChat.UserListener({
        onUserOnline: (u: CometChat.User) => setMembers((p) => p.map((m) => (m.uid === u.getUid() ? { ...m, online: true } : m))),
        onUserOffline: (u: CometChat.User) => setMembers((p) => p.map((m) => (m.uid === u.getUid() ? { ...m, online: false } : m))),
      }),
    );
    CometChat.addGroupListener(
      id,
      new CometChat.GroupListener({
        onGroupMemberJoined: (_a: unknown, _u: unknown, g: CometChat.Group) => g.getGuid() === guid && refreshMembers(),
        onGroupMemberLeft: (_a: unknown, _u: unknown, g: CometChat.Group) => g.getGuid() === guid && refreshMembers(),
      }),
    );
    return () => {
      alive = false;
      CometChat.removeMessageListener(id);
      CometChat.removeUserListener(id);
      CometChat.removeGroupListener(id);
    };
  }, [guid, addMessage]);

  // Broadcast my spot (debounced) whenever I scrub.
  const firstSpot = useRef(true);
  useEffect(() => {
    try {
      localStorage.setItem(spotKey(guid), JSON.stringify(mySpot));
    } catch {
      /* storage unavailable */
    }
    if (firstSpot.current) {
      firstSpot.current = false;
      return;
    }
    const t = setTimeout(() => sendProgress(guid, mySpot).then((m) => addMessage(toMsg(m as CometChat.BaseMessage))), 500);
    return () => clearTimeout(t);
  }, [guid, mySpot, addMessage]);

  // Everyone's latest known spot, from progress pings and stamped messages.
  const spots = useMemo(() => {
    const latest: Record<string, { spot: Spot; at: number }> = {};
    for (const m of messages) {
      const cur = latest[m.uid];
      if (!cur || m.sentAt >= cur.at) latest[m.uid] = { spot: m.spot, at: m.sentAt };
    }
    const out: Record<string, Spot> = {};
    for (const [k, v] of Object.entries(latest)) out[k] = v.spot;
    out[meUid] = mySpot;
    return out;
  }, [messages, mySpot, meUid]);

  const chat = messages.filter((m) => m.kind === "text").sort((a, b) => a.sentAt - b.sentAt);
  const isLocked = (m: Msg) => m.uid !== meUid && spotValue(m.spot) > myValue && !peeked.has(m.id);
  const lockedCount = chat.filter(isLocked).length;

  // "N messages unlocked" toast when scrubbing forward reveals things.
  const prevLocked = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nowLocked = new Set(chat.filter(isLocked).map((m) => m.id));
    const unlocked = [...prevLocked.current].filter((id) => !nowLocked.has(id) && !peeked.has(id)).length;
    prevLocked.current = nowLocked;
    if (unlocked > 0) {
      setToast(`🔓 ${unlocked} message${unlocked > 1 ? "s" : ""} unlocked`);
      const t = setTimeout(() => setToast(""), 2200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myValue, messages.length]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length]);

  // Typing indicator (debounced end).
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onType = (v: string) => {
    setDraft(v);
    if (!typingTimer.current) CometChat.startTyping(typingIndicator(guid, mySpot));
    else clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      CometChat.endTyping(typingIndicator(guid, mySpot));
      typingTimer.current = null;
    }, 1500);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
      CometChat.endTyping(typingIndicator(guid, mySpot));
    }
    const sent = await sendStampedText(guid, text, mySpot);
    addMessage(toMsg(sent as CometChat.BaseMessage));
  };

  const minutesOf = (s: Spot) => (s.ep - 1) * epLength + s.min;
  const spotOf = (t: number): Spot => {
    const clamped = Math.max(0, Math.min(total, t));
    if (clamped === total) return { ep: episodes, min: epLength };
    return { ep: Math.floor(clamped / epLength) + 1, min: clamped % epLength };
  };

  const typers = Object.entries(typing).filter(([uid]) => uid !== meUid);
  const roster = useMemo(() => {
    const list = [...members];
    if (!list.some((m) => m.uid === meUid)) list.push({ uid: meUid, name: me.getName(), online: true });
    // Anyone who has posted is in the room, even if the member list hasn't refreshed yet.
    for (const m of messages) if (!list.some((x) => x.uid === m.uid)) list.push({ uid: m.uid, name: m.name, online: true });
    return list
      .map((m) => ({ ...m, online: m.uid === meUid ? true : m.online, spot: spots[m.uid] }))
      .sort((a, b) => (b.spot ? spotValue(b.spot) : -1) - (a.spot ? spotValue(a.spot) : -1));
  }, [members, messages, spots, meUid, me]);

  return (
    <div className="room">
      <header className="room-head">
        <button className="ghost" onClick={onLeave} aria-label="Leave room">←</button>
        <div className="room-title">
          <div className="eyebrow">Watch party · {episodes} episodes</div>
          <h2>{group.getName()}</h2>
        </div>
        <button
          className="secondary invite"
          onClick={() => {
            navigator.clipboard?.writeText(`${location.origin}/?room=${code}`).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Link copied ✓" : `Invite · ${code}`}
        </button>
      </header>

      <section className="timeline">
        <div className="timeline-top">
          <div>
            <div className="eyebrow">You're at</div>
            <div className="my-spot">{spotLabel(mySpot)}</div>
          </div>
          <div className="shield">
            {lockedCount > 0 ? (
              <>🫥 <b>{lockedCount}</b> spoiler{lockedCount > 1 ? "s" : ""} hidden</>
            ) : (
              <>🛡️ You're all caught up</>
            )}
          </div>
        </div>
        <div className="track">
          {Array.from({ length: episodes }, (_, i) => (
            <div key={i} className="ep" style={{ left: `${(i / episodes) * 100}%`, width: `${100 / episodes}%` }}>
              <span>E{i + 1}</span>
            </div>
          ))}
          <div className="fill" style={{ width: `${(minutesOf(mySpot) / total) * 100}%` }} />
          {roster
            .filter((m) => m.uid !== meUid && m.spot)
            .map((m) => (
              <div key={m.uid} className="pin" style={{ left: `${(minutesOf(m.spot!) / total) * 100}%`, borderColor: colorFor(m.uid) }} title={`${m.name} · ${spotLabel(m.spot!)}`}>
                <Avatar uid={m.uid} name={m.name} size={22} />
              </div>
            ))}
          <input
            className="scrub"
            type="range"
            min={0}
            max={total}
            value={minutesOf(mySpot)}
            aria-label="Your spot in the show"
            onChange={(e) => setMySpot(spotOf(+e.target.value))}
          />
        </div>
        <div className="steppers">
          <button className="chip" onClick={() => setMySpot(spotOf(minutesOf(mySpot) - 5))}>−5m</button>
          <button className="chip" onClick={() => setMySpot(spotOf(minutesOf(mySpot) + 5))}>+5m</button>
          <button className="chip" onClick={() => setMySpot(spotOf(mySpot.ep * epLength))}>Finished E{mySpot.ep} ⏭</button>
        </div>
      </section>

      <div className="room-body">
        <main className="chat">
          <div className="messages" ref={listRef}>
            {chat.length === 0 && (
              <div className="empty">
                <div className="empty-icon">🍿</div>
                No messages yet. Say something about what you just watched. It gets stamped with <b>{spotLabel(mySpot)}</b>.
              </div>
            )}
            {chat.map((m) => {
              const mine = m.uid === meUid;
              const locked = isLocked(m);
              const ahead = spotValue(m.spot) > myValue;
              return (
                <div key={m.id} className={`msg ${mine ? "mine" : ""}`}>
                  {!mine && <Avatar uid={m.uid} name={m.name} size={32} />}
                  <div className="msg-col">
                    <div className="msg-meta">
                      {!mine && <b style={{ color: colorFor(m.uid) }}>{m.name}</b>}
                      <span className={`stamp ${ahead && !mine ? "ahead" : ""}`}>{spotLabel(m.spot)}</span>
                    </div>
                    <div className={`bubble ${locked ? "locked" : ""}`}>
                      {locked ? (
                        <>
                          <span className="scrambled" aria-hidden>{scramble(m.text)}</span>
                          <span className="lock-overlay">
                            <span>🫥 Spoiler from {spotLabel(m.spot)}</span>
                            <button className="peek" onClick={() => setPeeked((p) => new Set(p).add(m.id))}>Peek anyway</button>
                          </span>
                        </>
                      ) : (
                        <span className="reveal">{m.text}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="typing">
            {typers.map(([uid, t]) => (
              <span key={uid}>
                <b>{t.name}</b> is typing
                {spotValue(t.spot) > myValue ? <em> from {spotLabel(t.spot)}, ahead of you 🙈</em> : "…"}
              </span>
            ))}
          </div>

          <form className="composer" onSubmit={send}>
            <span className="composer-stamp">{spotLabel(mySpot)}</span>
            <input value={draft} onChange={(e) => onType(e.target.value)} placeholder="Say something about what you've seen…" maxLength={500} />
            <button className="primary" disabled={!draft.trim()}>Send</button>
          </form>
        </main>

        <aside className="roster">
          <div className="eyebrow">In the room · {roster.length}</div>
          {roster.map((m) => {
            const ahead = m.spot && spotValue(m.spot) > myValue;
            return (
              <div key={m.uid} className="member">
                <Avatar uid={m.uid} name={m.name} size={34} online={m.online} />
                <div className="member-info">
                  <div className="member-name">
                    {m.name} {m.uid === meUid && <span className="you">you</span>}
                  </div>
                  <div className="member-bar">
                    <i style={{ width: `${m.spot ? (minutesOf(m.spot) / total) * 100 : 0}%`, background: colorFor(m.uid) }} />
                  </div>
                  <div className={`member-spot ${ahead ? "ahead" : ""}`}>
                    {m.spot ? spotLabel(m.spot) : "Hasn't started"}
                    {ahead && " · ahead"}
                  </div>
                </div>
              </div>
            );
          })}
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
