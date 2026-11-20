# MemoryLane

A premium AI companion and memory platform. People create companions inspired by the people and stories that matter to them, chat privately, share companions publicly, and message each other.

What's in it:
- Landing page, sign up with username, and a calm dark glass design (palette in `app/globals.css`)
- Home with your chats, official companions, community companions and your own
- 8 ready made official companions, created automatically on first run (`lib/official.ts`)
- Explore page with search, categories, official and community tabs
- A public page and share link for every public companion (`/c/...`)
- Private chat with any companion: streaming replies, stop, regenerate, try again, conversation starters
- Memory per conversation, with a side panel to see and wipe it
- Create and edit companions, with a private or public switch
- Profiles (`/u/username`), a people directory, and private messaging between people with blocking
- Photo memories: upload photos with a title, date, place and story, in a gallery or a life timeline
- Companion photos, and memories connected to a companion so it can bring them up in chat
- Rate limits for AI chat and for direct messages

Photos are shrunk in the browser and stored in the Postgres database (`Photo` table), so no extra storage service is needed. Memory photos are only visible to their owner; a companion's picture is visible to everyone when the companion is public.

## Run it on your computer

You need Node.js 20 or newer.

1. Install packages
   ```
   npm install
   ```
2. Make your settings file
   ```
   cp .env.example .env
   ```
   Open `.env` and fill in:
   - `DATABASE_URL`: a Postgres connection string. Make a free database at https://neon.tech and copy its connection string
   - `AUTH_SECRET`: any long random string. You can make one with `openssl rand -base64 32`
   - `ANTHROPIC_API_KEY`: your key from https://console.anthropic.com
3. Create the database
   ```
   npm run db:push
   ```
4. Start the app
   ```
   npm run dev
   ```
5. Open http://localhost:3000, make an account and create your first companion.

To look inside the database, run `npm run db:studio`.

## Change the name

The app is called "Companion" for now. To rename it, set `NEXT_PUBLIC_APP_NAME="Your Name"` in `.env`, or change `APP_NAME` in `lib/config.ts`.

## Settings you can change in `.env`

| Setting | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Which Claude model the companions use. `claude-haiku-5-5` is about 20 times cheaper |
| `ANTHROPIC_EFFORT` | `low` | How hard the model thinks. `low` is fast and cheap and fine for chat. Try `medium` for deeper replies |
| `CHAT_LIMIT_PER_MINUTE` | `15` | Messages one user can send per minute |
| `CHAT_LIMIT_PER_DAY` | `400` | Messages one user can send per day |
| `NEXT_PUBLIC_APP_NAME` | `MemoryLane` | The app's name |

## Put it online (Vercel)

1. Make a free Postgres database at https://neon.tech and copy its connection string.
2. Go to https://vercel.com, sign in with GitHub, click **Add New Project** and import this repo.
3. Set **Root Directory** to `companion-app`.
4. Under **Environment Variables** add `DATABASE_URL`, `AUTH_SECRET` and `ANTHROPIC_API_KEY` (plus any optional settings above).
5. Click **Deploy**. The tables are created or updated automatically during the build (`prisma/pre-push.sql`, then `prisma db push`).

Vercel gives you a link like `your-app.vercel.app` that anyone can open.

## Where things are

| File | What it does |
| --- | --- |
| `prisma/schema.prisma` | Database tables: User, Companion, Message |
| `lib/auth.ts`, `lib/jwt.ts` | Login sessions (signed cookie, 30 days) |
| `middleware.ts` | Sends logged out people to the login page |
| `app/actions.ts` | Sign up, log in, log out, create, edit, delete, fresh chat, forget memory |
| `lib/ai.ts` | The companion's instructions (system prompt) and the memory notes |
| `lib/config.ts` | App name, avatars, vibes, length limits, rate limits |
| `app/api/chat/route.ts` | Rate limits, saves messages, streams the reply from Claude, refreshes memory |
| `app/companions/...` | Companion list, create form and chat screen |
| `app/globals.css` | All the styling |

## Good next steps

- Voice chat (speech to text and text to speech)
- Companion photos instead of emoji
- Message limits per user and a paid plan with Stripe
- Password reset by email
- Swap the simple database based rate limit for Redis (Upstash) if you get lots of traffic

## Updating from the first version

The app now uses Postgres instead of a local SQLite file, and the database has two new columns (`greeting` and `memory`). Set `DATABASE_URL` to a Postgres database, then run `npm install` and `npm run db:push` once.
