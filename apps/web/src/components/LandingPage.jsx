/**
 * Landing page shown to unauthenticated visitors.
 * Edit CONTACT_EMAIL / REPO_URL / ACCESS_REQUEST_URL to match your deployment.
 */

const CONTACT_EMAIL = 'brendan0jacobs@gmail.com';
const REPO_URL = 'https://github.com/bren182/papier';
const ACCESS_REQUEST_URL = `mailto:${CONTACT_EMAIL}?subject=Papier%20access%20request`;

const dockerCompose = `\
services:
  papier:
    image: ghcr.io/bren182/papier:latest
    restart: unless-stopped
    environment:
      PAPIER_SETUP_TOKEN: changeme
    volumes:
      - papier_data:/app/data
    ports:
      - "3000:3000"

volumes:
  papier_data:`;

/** @param {{ onSignIn: () => void }} props */
export function LandingPage({ onSignIn }) {
  return (
    <div className="relative min-h-full overflow-y-auto" style={{ minHeight: '100svh' }}>
      {/* Full-bleed background */}
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login_bg.png')", backgroundColor: '#0d0f0d' }}
        aria-hidden="true"
      />
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />

      <div className="relative mx-auto max-w-[860px] px-5 py-16 sm:py-24">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <header className="mb-14 flex flex-col items-center gap-5 text-center">
          <img src="/pwa-192x192.png" alt="" className="size-20 rounded-[22px] shadow-xl" />
          <div>
            <h1 className="font-display text-[42px] font-semibold leading-tight tracking-tight text-white sm:text-[52px]">
              Papier
            </h1>
            <p className="mt-2 text-[17px] text-white/60">
              A block‑based workspace — your notes, pages and databases, hosted by you.
            </p>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="mt-2 h-11 rounded-xl bg-white px-8 text-[15px] font-semibold text-black shadow-lg transition hover:bg-white/90 active:scale-95"
          >
            Sign in
          </button>
        </header>

        {/* ── Feature grid ───────────────────────────────────────────── */}
        <section className="mb-14 grid gap-4 sm:grid-cols-3" aria-label="Features">
          <FeatureCard
            icon={<BlocksIcon />}
            title="Pages &amp; blocks"
            body="Write in a clean block editor. Toggle lists, callouts, code, embeds — the whole toolkit."
          />
          <FeatureCard
            icon={<DatabaseIcon />}
            title="Databases &amp; views"
            body="Organise anything in tables, grouped views and calendars. Relations, rollups and formulas included."
          />
          <FeatureCard
            icon={<LockIcon />}
            title="Fully self-hosted"
            body="One Docker container, your data. No accounts on external servers; no usage limits."
          />
        </section>

        {/* ── Deploy your own ────────────────────────────────────────── */}
        <section className="mb-10 rounded-2xl border border-white/10 bg-black/30 p-7 backdrop-blur-md">
          <h2 className="mb-1 text-[18px] font-semibold text-white">Deploy your own instance</h2>
          <p className="mb-5 text-[14px] text-white/50">
            Papier runs as a single Docker container. You need a server (a $5 VPS works) and optionally a domain with HTTPS via Caddy or nginx.
          </p>

          <ol className="mb-5 flex flex-col gap-4 text-[14px] text-white/70">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold text-white">1</span>
              <span>
                Copy the <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-white/80">docker-compose.yml</code> below onto your server and set a secure <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-white/80">PAPIER_SETUP_TOKEN</code>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold text-white">2</span>
              <span>
                Run <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-white/80">docker compose up -d</code>. The first visit to the server will show the setup screen — create your owner account there.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold text-white">3</span>
              <span>
                Point a domain at the server and terminate TLS with Caddy or nginx. Add it to your home screen as a PWA from Safari/Chrome.
              </span>
            </li>
          </ol>

          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 px-5 py-4 font-mono text-[12.5px] leading-relaxed text-white/70">
            {dockerCompose}
          </pre>

          <p className="mt-4 text-[13px] text-white/40">
            Full documentation and the source code are on{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-white/60 underline underline-offset-2 hover:text-white">
              GitHub
            </a>
            .
          </p>
        </section>

        {/* ── Request access ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-white/10 bg-black/30 p-7 backdrop-blur-md">
          <h2 className="mb-1 text-[18px] font-semibold text-white">Request access to this instance</h2>
          <p className="mb-5 text-[14px] text-white/50">
            This is a private Papier server. If the owner has invited you, use the sign-in button above. To request access, send a message below.
          </p>
          <a
            href={ACCESS_REQUEST_URL}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-5 text-[14px] font-medium text-white transition hover:bg-white/20 active:scale-95"
          >
            <MailIcon />
            Request access
          </a>
        </section>

        <footer className="mt-12 text-center text-[12px] text-white/25">
          Papier — self-hosted block workspace
        </footer>
      </div>
    </div>
  );
}

/** @param {{ icon: import('react').ReactNode, title: string, body: string }} props */
function FeatureCard({ icon, title, body }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
      <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-white/10 text-white/70">
        {icon}
      </div>
      {/* eslint-disable-next-line react/no-danger */}
      <h3 className="mb-1.5 text-[15px] font-semibold text-white" dangerouslySetInnerHTML={{ __html: title }} />
      <p className="text-[13px] leading-relaxed text-white/50">{body}</p>
    </div>
  );
}

function BlocksIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 7l10 7 10-7" />
    </svg>
  );
}
