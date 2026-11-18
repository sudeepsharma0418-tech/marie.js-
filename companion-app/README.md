# Companion App

A web app where people sign up, create their own AI companion, and chat with it one to one.

Each user can:
- Sign up and log in with email and password
- Create companions with a name, avatar, vibe, personality, backstory and first message
- Chat with each companion. Replies stream in live, and the full chat history is saved
- Edit a companion any time, start a fresh chat, or delete it
- See (and wipe) what a companion remembers about them

What makes the chat feel good:
- Long term memory: every 12 messages the companion updates short notes about you, so it remembers things even in very long chats
- Replies stream in, with a Stop button and a Try again button if something fails
- If you close the tab mid reply, the part that was written is still saved
- Quick start ideas (Luna, Max, Pip) on the create page

Built with Next.js 15, Prisma (Postgres) and the Claude API.

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
| `NEXT_PUBLIC_APP_NAME` | `Companion` | The app's name |

## Put it online (Vercel)

1. Make a free Postgres database at https://neon.tech and copy its connection string.
2. Go to https://vercel.com, sign in with GitHub, click **Add New Project** and import this repo.
3. Set **Root Directory** to `companion-app`.
4. Under **Environment Variables** add `DATABASE_URL`, `AUTH_SECRET` and `ANTHROPIC_API_KEY` (plus any optional settings above).
5. Click **Deploy**. The tables are created automatically during the build.

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
