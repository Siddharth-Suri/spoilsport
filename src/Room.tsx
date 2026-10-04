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
import { Avatar } from "./ui";

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
      setToast(`${unlocked} message${unlocked > 1 ? "s" : ""} unlocked`);
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

  const others = roster.filter((m) => m.uid !== meUid && m.spot);
  const pct = (sp: Spot) => `${(minutesOf(sp) / total) * 100}%`;

  return (
    <div className="shell">
      <nav className="topnav">
        <button className="wordmark" onClick={onLeave} aria-label="Back to lobby">Spoilsport</button>
        <span className="nav-link">Watch party</span>
        <div className="nav-right">
          <button
            className="btn-outline"
            onClick={() => {
              navigator.clipboard?.writeText(`${location.origin}/?room=${code}`).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Link copied" : "Copy invite link"}
          </button>
          <Avatar uid={meUid} name={me.getName()} size={32} />
        </div>
      </nav>

      <div className="room">
        <section className="title-block">
          <h1>{group.getName()}</h1>
          <div className="meta">
            {lockedCount > 0 ? (
              <span className="flag">{lockedCount} spoiler{lockedCount > 1 ? "s" : ""} hidden</span>
            ) : (
              <span className="flag ok">All caught up</span>
            )}
            <span>{episodes} Episodes</span>
            <span>{epLength}m each</span>
            <span className="box">Room {code}</span>
          </div>
        </section>

        <section className="progress">
          <div className="progress-top">
            <div>
              <span className="muted">You're on </span>
              <strong>Episode {mySpot.ep}</strong>
              <span className="muted"> · {String(mySpot.min).padStart(2, "0")}m in</span>
            </div>
            <div className="steppers">
              <button className="btn-quiet" onClick={() => setMySpot(spotOf(minutesOf(mySpot) - 5))}>−5 min</button>
              <button className="btn-quiet" onClick={() => setMySpot(spotOf(minutesOf(mySpot) + 5))}>+5 min</button>
              <button className="btn-quiet" onClick={() => setMySpot(spotOf(mySpot.ep * epLength))}>Finished E{mySpot.ep}</button>
            </div>
          </div>
          <div className="track">
            <div className="pins">
              {others.map((m) => (
                <div key={m.uid} className="pin" style={{ left: pct(m.spot!) }} title={`${m.name} · ${spotLabel(m.spot!)}`}>
                  <Avatar uid={m.uid} name={m.name} size={24} />
                </div>
              ))}
            </div>
            <div className="rail">
              {Array.from({ length: episodes - 1 }, (_, i) => (
                <i key={i} className="tick" style={{ left: `${((i + 1) / episodes) * 100}%` }} />
              ))}
              <div className="fill" style={{ width: pct(mySpot) }} />
              <div className="knob" style={{ left: pct(mySpot) }} />
            </div>
            <div className="ep-labels">
              {Array.from({ length: episodes }, (_, i) => (
                <span key={i} className={i + 1 === mySpot.ep ? "cur" : ""} style={{ left: `${((i + 0.5) / episodes) * 100}%` }}>
                  E{i + 1}
                </span>
              ))}
            </div>
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
        </section>

        <div className="room-body">
          <main className="chat">
            <div className="messages" ref={listRef}>
              {chat.length === 0 && (
                <div className="empty">
                  <strong>No messages yet</strong>
                  Say something about what you just watched. It'll be tagged {spotLabel(mySpot)}.
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
                        {!mine && <b>{m.name}</b>}
                        <span className={`stamp ${ahead && !mine ? "ahead" : ""}`}>{spotLabel(m.spot)}</span>
                      </div>
                      <div className={`bubble ${locked ? "locked" : ""}`}>
                        {locked ? (
                          <>
                            <span className="scrambled" aria-hidden>{scramble(m.text)}</span>
                            <span className="lock-overlay">
                              <span>Hidden until you reach {spotLabel(m.spot)}</span>
                              <button className="peek" onClick={() => setPeeked((p) => new Set(p).add(m.id))}>Reveal</button>
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
                  {t.name} is typing
                  {spotValue(t.spot) > myValue ? <em> from {spotLabel(t.spot)}, ahead of you</em> : "…"}
                </span>
              ))}
            </div>

            <form className="composer" onSubmit={send}>
              <span className="composer-stamp">{spotLabel(mySpot)}</span>
              <input value={draft} onChange={(e) => onType(e.target.value)} placeholder="Say something about what you've seen…" maxLength={500} />
              <button className="btn-red" disabled={!draft.trim()}>Send</button>
            </form>
          </main>

          <aside className="roster">
            <h3>Who's watching</h3>
            {roster.map((m) => {
              const ahead = m.spot && spotValue(m.spot) > myValue;
              return (
                <div key={m.uid} className="member">
                  <Avatar uid={m.uid} name={m.name} size={40} online={m.online} />
                  <div className="member-info">
                    <div className="member-name">
                      {m.name} {m.uid === meUid && <span className="you">You</span>}
                    </div>
                    <div className="member-bar">
                      <i style={{ width: m.spot ? pct(m.spot) : 0 }} />
                    </div>
                    <div className={`member-spot ${ahead ? "ahead" : ""}`}>
                      {m.spot ? spotLabel(m.spot) : "Hasn't started"}
                      {ahead && " · ahead of you"}
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
