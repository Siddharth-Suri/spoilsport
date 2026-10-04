import { CometChat } from "@cometchat/chat-sdk-javascript";

const APP_ID = import.meta.env.VITE_COMETCHAT_APP_ID as string;
const REGION = import.meta.env.VITE_COMETCHAT_REGION as string;
const AUTH_KEY = import.meta.env.VITE_COMETCHAT_AUTH_KEY as string;

export const PROGRESS_TYPE = "progress";

/** A spot in the show. Encoded as a single comparable number: ep * 1000 + minute. */
export type Spot = { ep: number; min: number };
export const spotValue = (s: Spot) => s.ep * 1000 + s.min;
export const spotLabel = (s: Spot) => `E${s.ep} · ${String(s.min).padStart(2, "0")}m`;

export type ShowInfo = { show: string; episodes: number; epLength: number };

let initPromise: Promise<boolean> | null = null;
export function initCometChat() {
  if (!initPromise) {
    if (!APP_ID || !REGION || !AUTH_KEY) {
      return Promise.reject(new Error("Missing VITE_COMETCHAT_* env vars"));
    }
    const settings = new CometChat.AppSettingsBuilder()
      .subscribePresenceForAllUsers()
      .setRegion(REGION)
      .autoEstablishSocketConnection(true)
      .build();
    initPromise = CometChat.init(APP_ID, settings);
  }
  return initPromise;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "viewer";

/** Creates the user on the fly (dev-mode Auth Key flow) and logs them in. */
export async function signIn(name: string): Promise<CometChat.User> {
  await initCometChat();
  const existing = await CometChat.getLoggedinUser();
  if (existing) await CometChat.logout();

  const uid = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
  const user = new CometChat.User(uid);
  user.setName(name.trim());
  try {
    await CometChat.createUser(user, AUTH_KEY);
  } catch (e) {
    if ((e as { code?: string }).code !== "ERR_UID_ALREADY_EXISTS") throw e;
  }
  return CometChat.login(uid, AUTH_KEY);
}

export async function currentUser() {
  await initCometChat();
  return CometChat.getLoggedinUser();
}

export const signOut = () => CometChat.logout();

const roomGuid = (code: string) => `wp-${code.toLowerCase()}`;
export const newRoomCode = () => Math.random().toString(36).slice(2, 8);

export async function createRoom(info: ShowInfo): Promise<string> {
  const code = newRoomCode();
  const group = new CometChat.Group(roomGuid(code), info.show, CometChat.GROUP_TYPE.PUBLIC, "");
  group.setMetadata(info);
  group.setDescription(`Spoiler-safe watch party for ${info.show}`);
  await CometChat.createGroup(group);
  return code;
}

export async function joinRoom(code: string): Promise<CometChat.Group> {
  const guid = roomGuid(code);
  const group = await CometChat.getGroup(guid);
  if (group.getHasJoined()) return group;
  try {
    return await CometChat.joinGroup(guid, CometChat.GroupType.Public, "");
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_ALREADY_JOINED") return group;
    throw e;
  }
}

export async function fetchMembers(guid: string) {
  const req = new CometChat.GroupMembersRequestBuilder(guid).setLimit(50).build();
  return req.fetchNext();
}

export async function fetchHistory(guid: string) {
  const req = new CometChat.MessagesRequestBuilder()
    .setGUID(guid)
    .setLimit(100)
    .setCategories([CometChat.CATEGORY_MESSAGE, CometChat.CATEGORY_CUSTOM])
    .setTypes([CometChat.MESSAGE_TYPE.TEXT, PROGRESS_TYPE])
    .hideReplies(true)
    .build();
  return req.fetchPrevious();
}

/** Every chat message carries the sender's spot so receivers can decide whether it's a spoiler. */
export function sendStampedText(guid: string, text: string, spot: Spot) {
  const msg = new CometChat.TextMessage(guid, text, CometChat.RECEIVER_TYPE.GROUP);
  msg.setMetadata({ spot });
  msg.setTags([`ep-${spot.ep}`]);
  return CometChat.sendMessage(msg);
}

/** Progress updates are custom messages that don't bump the conversation's last message. */
export function sendProgress(guid: string, spot: Spot) {
  const msg = new CometChat.CustomMessage(guid, CometChat.RECEIVER_TYPE.GROUP, PROGRESS_TYPE, { spot });
  msg.shouldUpdateConversation(false);
  msg.setConversationText(`is now at ${spotLabel(spot)}`);
  return CometChat.sendCustomMessage(msg);
}

export function typingIndicator(guid: string, spot: Spot) {
  const t = new CometChat.TypingIndicator(guid, CometChat.RECEIVER_TYPE.GROUP);
  t.setMetadata({ spot });
  return t;
}

export { CometChat };
