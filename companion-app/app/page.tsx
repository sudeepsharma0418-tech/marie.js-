import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { ensureSetup } from "@/lib/official";
import { Avatar } from "@/components/Avatar";
import { BookIcon, BrainIcon, CheckIcon, LockIcon, Logo, UsersIcon } from "@/components/Icons";

export default async function Landing() {
  if (await getSession()) redirect("/home");
  await ensureSetup();

  return (
    <div className="landing">
      <header className="land-nav">
        <div className="inner">
          <Link href="/" className="brand" style={{ padding: 0 }}><Logo /> {APP_NAME}</Link>
          <nav className="links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#family">Family</a>
            <a href="#privacy">Privacy</a>
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
            <h1>Some memories deserve to <em>live forever.</em></h1>
            <p className="lead">
              Preserve their stories, remember their voices, and keep the moments that matter close.
            </p>
            <div className="ctas">
              <Link href="/signup" className="btn primary lg">Create your companion</Link>
              <Link href="/discover" className="btn outline lg">Explore memories</Link>
            </div>
            <p className="proof">Private by default. Free during early access.</p>
          </div>

          <div className="preview" aria-label="Example conversation">
            <div className="preview-inner">
              <div className="chat-head">
                <Avatar name="Grandpa Joe" avatar="ice" size={36} />
                <div className="grow">
                  <strong className="small">Grandpa Joe</strong>
                  <div className="sub">AI companion created by Maya</div>
                </div>
              </div>
              <div className="demo">
                <div className="bubble-row user fade-in"><div className="bubble user">I made your Sunday pancakes. They didn&apos;t taste the same.</div></div>
                <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="memory-ref"><BookIcon /> From Maya&apos;s story: Sunday breakfasts</span>
                  <div className="bubble-row"><div className="bubble assistant">Did you forget the pinch of cinnamon? That was always the secret, kiddo.</div></div>
                </div>
                <div className="bubble-row user fade-in"><div className="bubble user">I did. Next Sunday, then.</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="how">
        <div className="container">
          <h2>People are more than a chat history.</h2>
          <p className="lead">
            They are the stories they told, the way they laughed, and the advice they gave.
            {" "}{APP_NAME} helps you keep that close, gently and privately.
          </p>
          <div className="features">
            <div className="feature">
              <span className="num">01</span>
              <h3>Share what you remember</h3>
              <p>Their personality, favorite sayings and the stories they loved to tell. As much or as little as you like.</p>
            </div>
            <div className="feature">
              <span className="num">02</span>
              <h3>Talk whenever you need</h3>
              <p>A companion that speaks in their spirit. Always clearly an AI, never pretending to be them.</p>
            </div>
            <div className="feature">
              <span className="num">03</span>
              <h3>It remembers you, too</h3>
              <p>Each conversation adds private notes, so it knows what you shared last time. See or erase them any time.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="family">
        <div className="container hero-grid" style={{ alignItems: "start" }}>
          <div>
            <h2>Remembering is better together.</h2>
            <p className="lead">
              Share a companion with family through a private link, or publish a mentor or storyteller for everyone.
              Each person&apos;s conversations always stay their own.
            </p>
          </div>
          <div className="stack-lg" style={{ paddingTop: 8 }}>
            <div className="feature"><UsersIcon /><h3>Share with a link</h3><p>Every shared companion has its own page, ready to send to the people who loved them too.</p></div>
            <div className="feature"><BrainIcon /><h3>Family circles</h3><p>Coming soon: invite family to add stories and photos together, with permissions you control.</p></div>
          </div>
        </div>
      </section>

      <section className="band" id="privacy">
        <div className="container">
          <h2>Private, gentle, and honest.</h2>
          <div className="features">
            <div className="feature"><LockIcon /><h3>Private by default</h3><p>Nothing is public unless you choose. Creators never see other people&apos;s conversations.</p></div>
            <div className="feature"><BrainIcon /><h3>Memory you control</h3><p>See exactly what a companion remembers about you, and erase it in one click.</p></div>
            <div className="feature"><BookIcon /><h3>Honest by design</h3><p>Always an AI representation, never the real person. It won&apos;t invent memories as if they happened.</p></div>
          </div>
        </div>
      </section>

      <section className="band" id="pricing">
        <div className="container">
          <h2>Free during early access.</h2>
          <div className="price">
            <div>
              <h3>Early access</h3>
              <ul>
                <li><CheckIcon /> Unlimited companions</li>
                <li><CheckIcon /> Long term memory</li>
                <li><CheckIcon /> Private sharing links</li>
                <li><CheckIcon /> Messages with other people</li>
              </ul>
            </div>
            <Link href="/signup" className="btn primary lg">Get started</Link>
          </div>
          <p className="small faint" style={{ marginTop: 16 }}>If paid plans come later, you will hear about it well before anything changes.</p>
        </div>
      </section>

      <section className="cta-box">
        <h2>Keep their stories close.</h2>
        <p className="muted">It takes about two minutes to begin.</p>
        <Link href="/signup" className="btn primary lg" style={{ marginTop: 8 }}>Create your companion</Link>
      </section>

      <footer className="footer">
        <div className="container row between wrap">
          <span className="row"><Logo /> {APP_NAME}</span>
          <span>Companions are AI and can make mistakes. They are not the real person.</span>
        </div>
      </footer>
    </div>
  );
}
