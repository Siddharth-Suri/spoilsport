# Spoilsport 🫥

**A watch-party chat that can't spoil the show.**

Spoilsport is a group chat for friends watching the same series at different speeds. Every message is stamped with where the sender is in the show (episode + minute). If a message comes from further ahead than you, it stays blurred until you catch up. Scrub your timeline forward and those messages unlock live.

Built for the **#ZeroToChat** challenge with Claude Code and the **CometChat MCP**.

## Features

- **Spot-stamped messages.** Each text message carries `metadata.spot = { ep, min }`.
- **Spoiler shield.** Messages from ahead of you render as scrambled, blurred bubbles. The real text never reaches the DOM until you unlock it, or you choose "Peek anyway".
- **Live unlocking.** Drag the episode timeline and messages unblur as you pass their spot, with an "N messages unlocked" toast.
- **Where's everyone?** Every member's avatar sits on the shared episode timeline. The roster shows progress bars and who's ahead of you.
- **Spoiler-aware typing.** "Maya is typing from E4 · 28m, ahead of you 🙈".
- **Presence.** Online/offline dots via CometChat presence.
- **Invite links.** `?room=abc123` joins the room directly.

## How it uses CometChat

| Feature | CometChat API |
| --- | --- |
| Sign-up on the fly | `CometChat.createUser` + `CometChat.login` (Auth Key, dev mode) |
| Rooms | Public groups: `createGroup` (show info in group metadata), `joinGroup` |
| Spot-stamped chat | `TextMessage` + `setMetadata({ spot })` |
| Progress pings | `CustomMessage` of type `progress`, `shouldUpdateConversation(false)` |
| History | `MessagesRequestBuilder` filtered to `text` + `progress` |
| Typing | `TypingIndicator` with `setMetadata({ spot })` |
| Presence / roster | `subscribePresenceForAllUsers`, `UserListener`, `GroupMembersRequestBuilder`, `GroupListener` |

### Built with the CometChat MCP

The agent (Claude Code) connected to `https://mcp.cometchat.com/mcp` and used it to build the app:

- `list_cometchat_bundles`: found the 10 verified bundles
- `get_cometchat_implementation_bundle`: `js-sdk-messaging-basics`, `presence-and-typing`
- `search_cometchat_docs`: user creation, groups, message metadata
- `fetch_cometchat_doc_page`: `create-group`, `user-management`, `send-message`, `join-group`

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in your App ID, Region, Auth Key
npm run dev
```

Get credentials from [app.cometchat.com](https://app.cometchat.com) (the free tier works), or run:

```bash
npx @cometchat/skills-cli@3 auth login && npx @cometchat/skills-cli@3 provision run
```

## Deploy to Vercel

1. Import the repo in Vercel. It auto-detects Vite.
2. Add the env vars `VITE_COMETCHAT_APP_ID`, `VITE_COMETCHAT_REGION` and `VITE_COMETCHAT_AUTH_KEY`.
3. Deploy.

Or from the CLI:

```bash
vercel --prod
```

> ⚠️ This demo uses the Auth Key in the browser, which CometChat recommends for development only. For production, mint Auth Tokens server-side (for example in a Vercel function) and log in with `CometChat.login(authToken)`.

## Demo video

`demo/` holds the scripted demo pipeline:

- `record.mjs` drives two real users through the app with Playwright and captures 2× screencast frames.
- `compose.html` / `compose.mjs` composite them Screen Studio-style: gradient stage, window chrome, cursor, captions and eased zooms. The output is `demo/out/spoilsport-demo.mp4`.

```bash
cd demo && npm install && npx playwright install chromium
node record.mjs     # needs the app running on :5173
node compose.mjs    # optional: drop an agent screen recording at demo/clip.mov
```

## Stack

Vite · React 19 · TypeScript · `@cometchat/chat-sdk-javascript` v4
