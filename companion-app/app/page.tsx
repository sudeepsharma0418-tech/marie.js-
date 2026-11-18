import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { ensureSetup } from "@/lib/official";
import { Avatar } from "@/components/Avatar";
import { BrainIcon, ChatIcon, GlobeIcon, LockIcon, Logo, SparkIcon, UsersIcon } from "@/components/Icons";

export default async function Landing() {
  if (await getSession()) redirect("/home");
  await ensureSetup();

  const featured = await db.companion.findMany({
    where: { isOfficial: true },
    orderBy: { createdAt: "asc" },
    take: 8,
    select: { id: true, name: true, avatar: true, tagline: true, category: true },
  });

  return (
    <div className="landing">
      <header className="land-nav">
        <div className="inner">
          <Link href="/" className="brand" style={{ padding: 0 }}><Logo /> {APP_NAME}</Link>
          <nav className="links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#companions">Explore</a>
            <a href="#community">Family</a>
            <a href="#trust">Privacy</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="row">
            <Link href="/login" className="btn quiet sm">Log in</Link>
            <Link href="/signup" className="btn primary sm">Get started</Link>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="badge"><SparkIcon className="" /> Now in early access</span>
            <h1 style={{ marginTop: 22 }}>
              Some memories deserve to <em>live forever.</em>
            </h1>
            <p className="lead">
              Preserve their stories, remember their voices, and keep the moments that matter close.
              Create a personal AI companion inspired by the memories you share.
            </p>
            <div className="ctas">
              <Link href="/signup" className="btn primary lg">Create your companion</Link>
              <Link href="/discover" className="btn outline lg">Explore companions</Link>
            </div>
            <div className="proof">
              <div className="stack-av">
                {featured.slice(0, 5).map((c) => (
                  <Avatar key={c.id} name={c.name} avatar={c.avatar} size={30} />
                ))}
              </div>
              <span>Private by default. Free during early access.</span>
            </div>
          </div>

          <div className="phone" aria-label="Example conversation">
            <div className="chat-head">
              <Avatar name="Grandpa Joe" avatar="slate" size={36} />
              <div className="grow">
                <strong className="small">Grandpa Joe</strong>
                <div className="sub">AI companion · made by Maya</div>
              </div>
            </div>
            <div className="demo">
              <div className="bubble-row user fade-in"><div className="bubble user">I made your pancakes this morning. They didn&apos;t taste the same.</div></div>
              <div className="memory-pill fade-in"><BrainIcon /> From the story Maya shared: Sunday breakfasts</div>
              <div className="bubble-row fade-in"><div className="bubble assistant">Did you forget the pinch of cinnamon? Your grandma never knew about that. Our little secret, kiddo.</div></div>
              <div className="bubble-row user fade-in"><div className="bubble user">I did forget it. Next Sunday then.</div></div>
            </div>
          </div>
        </div>
      </section>

      <div className="logos">
        <div className="container row wrap">
          <span>Stories and personality</span>
          <span>·</span>
          <span>Long term memory</span>
          <span>·</span>
          <span>Share with family</span>
          <span>·</span>
          <span>Private by default</span>
        </div>
      </div>

      <section className="band" id="how">
        <div className="container">
          <span className="eyebrow">How it works</span>
          <h2 style={{ marginTop: 12 }}>People are more than <em>a chat history.</em></h2>
          <p className="lead">They are the stories they told, the way they laughed, the advice they gave. {APP_NAME} helps you keep that close, gently and privately.</p>
          <div className="features">
            <div className="feature">
              <span className="num">01</span>
              <h3>Share what you remember</h3>
              <p>Their personality, favorite sayings, the stories they loved to tell. As much or as little as you like.</p>
            </div>
            <div className="feature">
              <span className="num">02</span>
              <h3>Talk, whenever you need</h3>
              <p>A companion that speaks in their spirit. Always clearly an AI, never pretending to be them.</p>
            </div>
            <div className="feature">
              <span className="num">03</span>
              <h3>It remembers you too</h3>
              <p>Every conversation adds private notes, so it knows what you shared last time. See and wipe them any time.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="companions" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow">Explore</span>
              <h2 style={{ marginTop: 12 }}>Mentors, storytellers, <em>and friends.</em></h2>
            </div>
          </div>
          <div className="grid" style={{ marginTop: 32 }}>
            {featured.map((c) => (
              <Link key={c.id} href={`/c/${c.id}`} className="card">
                <div className="card-top">
                  <Avatar name={c.name} avatar={c.avatar} size={48} />
                  <div className="grow">
                    <h3>{c.name}</h3>
                    <span className="tiny faint">{c.category}</span>
                  </div>
                </div>
                <p className="small muted clamp2">{c.tagline}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="band" id="community" style={{ paddingTop: 0 }}>
        <div className="container hero-grid" style={{ alignItems: "start" }}>
          <div>
            <span className="eyebrow">Community</span>
            <h2 style={{ marginTop: 12 }}>Remembering is <em>better together.</em></h2>
            <p className="lead">Share a companion with family through a private link, or publish a mentor or storyteller for everyone. Each person&apos;s conversations stay their own.</p>
          </div>
          <div className="features" style={{ gridTemplateColumns: "1fr", marginTop: 0 }}>
            <div className="feature row" style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}>
              <GlobeIcon className="faint" />
              <div><h3>Share with a link</h3><p>Every shared companion gets its own page, ready to send to family.</p></div>
            </div>
            <div className="feature" style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}>
              <UsersIcon className="faint" />
              <div><h3>Profiles and people</h3><p>See who made what and visit the profiles of creators you like.</p></div>
            </div>
            <div className="feature" style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}>
              <ChatIcon className="faint" />
              <div><h3>Talk to each other</h3><p>Private messages between people, with blocking built in.</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="trust" style={{ paddingTop: 0 }}>
        <div className="container">
          <span className="eyebrow">Trust</span>
          <h2 style={{ marginTop: 12 }}>Gentle, private, <em>and honest.</em></h2>
          <div className="features">
            <div className="feature"><LockIcon className="faint" /><h3>Private by default</h3><p>Nothing is public unless you choose. Creators never see other people&apos;s chats.</p></div>
            <div className="feature"><BrainIcon className="faint" /><h3>Memory you control</h3><p>See exactly what a companion remembers and wipe it in one click.</p></div>
            <div className="feature"><SparkIcon className="faint" /><h3>Honest by design</h3><p>Always an AI representation, never the real person. It won&apos;t invent memories, and it points to real help in hard moments.</p></div>
          </div>
        </div>
      </section>

      <section className="band" id="pricing" style={{ paddingTop: 0 }}>
        <div className="container">
          <span className="eyebrow">Pricing</span>
          <h2 style={{ marginTop: 12 }}>Free while we <em>grow together.</em></h2>
          <p className="lead">Everything is free during early access. If paid plans come later, you will hear about it well before anything changes.</p>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 100 }}>
        <div className="cta-box">
          <h2 className="display" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>Keep their stories <em>close.</em></h2>
          <p className="muted">Free to start. No credit card.</p>
          <Link href="/signup" className="btn light lg">Create your companion</Link>
        </div>
      </section>

      <footer className="footer">
        <div className="container row between wrap">
          <span className="row"><Logo /> {APP_NAME}</span>
          <span>© {new Date().getFullYear()} {APP_NAME}. Companions are AI and can make mistakes.</span>
        </div>
      </footer>
    </div>
  );
}
