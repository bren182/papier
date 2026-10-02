/**
 * Landing page shown to unauthenticated visitors.
 * Edit CONTACT_EMAIL / REPO_URL / ACCESS_REQUEST_URL to match your deployment.
 */

import { useState } from 'react';

const CONTACT_EMAIL = 'brendan0jacobs@gmail.com';
const REPO_URL = 'https://github.com/bren182/papier';
const RELEASES_URL = 'https://github.com/bren182/papier/releases/latest';
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

/** @param {{ onSignIn: () => void, onDemo: () => void }} props */
export function LandingPage({ onSignIn, onDemo }) {
  return (
    <div className="relative min-h-full overflow-y-auto" style={{ minHeight: '100svh' }}>
      {/* Full-bleed background */}
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login_bg.webp')", backgroundColor: '#0d0f0d' }}
        aria-hidden="true"
      />
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />

      {/* ── Top nav ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/40 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <img src="/pwa-192x192.png" alt="" className="size-8 rounded-lg shadow" />
          <span className="font-semibold text-white">Papier</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden text-[14px] text-white/55 transition hover:text-white sm:block"
          >
            GitHub
          </a>
          <button
            type="button"
            onClick={onSignIn}
            className="h-8 rounded-lg bg-white px-5 text-[14px] font-semibold text-black shadow transition hover:bg-white/90 active:scale-95"
          >
            Sign in
          </button>
        </div>
      </nav>

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
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onSignIn}
              className="h-11 rounded-xl bg-white px-8 text-[15px] font-semibold text-black shadow-lg transition hover:bg-white/90 active:scale-95"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={onDemo}
              className="h-11 rounded-xl border border-white/30 bg-white/10 px-8 text-[15px] font-semibold text-white backdrop-blur transition hover:bg-white/20 active:scale-95"
            >
              Try demo
            </button>
          </div>
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
            body="One Docker container or a native app. Your data, your machine — no external accounts, no limits."
          />
        </section>

        {/* ── Get Papier ─────────────────────────────────────────────── */}
        <section className="mb-10 rounded-2xl border border-white/10 bg-black/30 p-7 backdrop-blur-md">
          <h2 className="mb-1 text-[18px] font-semibold text-white">Get Papier</h2>
          <p className="mb-6 text-[14px] text-white/50">
            Install on your machine or self-host on a server — pick the option that suits you.
          </p>
          <InstallTabs />
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

/** Tabbed installer panel: Windows | Linux | Docker */
function InstallTabs() {
  const [tab, setTab] = useState(/** @type {'windows'|'linux'|'docker'} */ ('windows'));
  const tabs = /** @type {const} */ ([
    { id: 'windows', label: 'Windows', icon: <WindowsIcon /> },
    { id: 'linux',   label: 'Linux',   icon: <LinuxIcon /> },
    { id: 'docker',  label: 'Docker',  icon: <DockerIcon /> },
  ]);
  return (
    <div>
      {/* Tab bar */}
      <div className="mb-5 flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-medium transition-colors ${
              tab === t.id
                ? 'bg-white/15 text-white shadow'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'windows' && <WindowsTab />}
      {tab === 'linux'   && <LinuxTab />}
      {tab === 'docker'  && <DockerTab />}
    </div>
  );
}

function WindowsTab() {
  return (
    <div className="flex flex-col gap-5">
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2.5 rounded-xl bg-white px-6 py-3 text-[15px] font-semibold text-black shadow-lg transition hover:bg-white/90 active:scale-95 sm:w-fit"
      >
        <DownloadIcon />
        Download for Windows
        <span className="text-[12px] font-normal text-black/50">(.exe installer)</span>
      </a>
      <ol className="flex flex-col gap-3 text-[14px] text-white/70">
        <Step n={1}>Run the <Mono>Papier-Setup-*.exe</Mono> installer. No admin rights required — installs per-user by default.</Step>
        <Step n={2}>Papier starts and adds itself to the system tray. Click the tray icon to open the window.</Step>
        <Step n={3}>On first launch a dialog shows your <strong className="text-white/90">setup token</strong>. Enter it on the setup screen to create your account.</Step>
        <Step n={4}>Your data lives in <Mono>%APPDATA%\Papier\</Mono>. Back up <Mono>papier.db</Mono> from there at any time.</Step>
      </ol>
      <Note>Local data only for now. Cross-device sync is on the roadmap.</Note>
    </div>
  );
}

function LinuxTab() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-3">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[14px] font-semibold text-black shadow-lg transition hover:bg-white/90 active:scale-95"
        >
          <DownloadIcon />
          AppImage
        </a>
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-white/20 active:scale-95"
        >
          <DownloadIcon />
          .deb (Debian / Ubuntu)
        </a>
      </div>
      <div className="flex flex-col gap-4 text-[14px] text-white/70">
        <div>
          <p className="mb-2 font-medium text-white/80">AppImage</p>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-white/70">
            {`chmod +x Papier-*.AppImage\n./Papier-*.AppImage`}
          </pre>
        </div>
        <div>
          <p className="mb-2 font-medium text-white/80">Debian / Ubuntu</p>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-white/70">
            {`sudo dpkg -i papier_*_amd64.deb\npapier`}
          </pre>
        </div>
      </div>
      <ol className="flex flex-col gap-3 text-[14px] text-white/70">
        <Step n={1}>Launch Papier. It runs in the background and shows a system tray icon.</Step>
        <Step n={2}>On first launch a dialog shows your <strong className="text-white/90">setup token</strong>. Enter it on the setup screen to create your account.</Step>
        <Step n={3}>Data lives in <Mono>~/.config/Papier/</Mono>. Back up <Mono>papier.db</Mono> from there at any time.</Step>
      </ol>
      <Note>Local data only for now. Cross-device sync is on the roadmap.</Note>
    </div>
  );
}

function DockerTab() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] text-white/60">
        Run Papier on any server — a $5 VPS is plenty. Optionally put Caddy or nginx in front for HTTPS and install it as a PWA from Safari or Chrome.
      </p>
      <ol className="flex flex-col gap-4 text-[14px] text-white/70">
        <Step n={1}>
          Copy the <Mono>docker-compose.yml</Mono> below onto your server and set a secure <Mono>PAPIER_SETUP_TOKEN</Mono>.
        </Step>
        <Step n={2}>
          Run <Mono>docker compose up -d</Mono>. The first visit shows the setup screen — create your owner account there.
        </Step>
        <Step n={3}>
          Point a domain at the server and terminate TLS with Caddy or nginx. Add it to your home screen as a PWA.
        </Step>
      </ol>
      <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 px-5 py-4 font-mono text-[12.5px] leading-relaxed text-white/70">
        {dockerCompose}
      </pre>
      <p className="text-[13px] text-white/40">
        Full docs and source on{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-white/60 underline underline-offset-2 hover:text-white">
          GitHub
        </a>.
      </p>
    </div>
  );
}

/** @param {{ n: number, children: import('react').ReactNode }} props */
function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold text-white">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/** @param {{ children: import('react').ReactNode }} props */
function Note({ children }) {
  return (
    <p className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-[12px] text-white/45">
      ℹ {children}
    </p>
  );
}

/** @param {{ children: import('react').ReactNode }} props */
function Mono({ children }) {
  return <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-white/80">{children}</code>;
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

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.6L10.7 4.5V11.5H3V5.6ZM11.6 4.4L21 3V11.4H11.6V4.4ZM3 12.5H10.7V19.5L3 18.4V12.5ZM11.6 12.5H21V21L11.6 19.6V12.5Z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2C8 2 6 6 6 9c0 2 .5 3.5 1.5 5L6 18c-.5 1 0 2 1 2h10c1 0 1.5-1 1-2l-1.5-4C17.5 12.5 18 11 18 9c0-3-2-7-6-7z" />
      <circle cx="9.5" cy="9" r="1" fill="currentColor" />
      <circle cx="14.5" cy="9" r="1" fill="currentColor" />
    </svg>
  );
}

function DockerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12.5c0 .8-.4 1.5-1.1 1.8-1.8.9-5.5 1.7-9.1 1.7S5 15.2 3.1 14.3C2.4 14 2 13.3 2 12.5" />
      <path d="M2 12.5V11c0-.8.4-1.5 1.1-1.8C4.9 8.3 8.6 7.5 12 7.5s7.1.8 8.9 1.7C21.6 9.5 22 10.2 22 11v1.5" />
      <rect x="6" y="4" width="3" height="3" rx=".5" />
      <rect x="10.5" y="4" width="3" height="3" rx=".5" />
      <rect x="15" y="4" width="3" height="3" rx=".5" />
      <rect x="6" y="8" width="3" height="3" rx=".5" />
      <rect x="10.5" y="8" width="3" height="3" rx=".5" />
    </svg>
  );
}
