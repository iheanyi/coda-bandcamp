import Image from "next/image";

const releaseUrl = "https://github.com/iheanyi/coda-bandcamp/releases/latest";
const repositoryUrl = "https://github.com/iheanyi/coda-bandcamp";
const isGitHubPagesBuild = process.env.CODA_GITHUB_PAGES === "true";
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH ??
  (isGitHubPagesBuild ? "/coda-bandcamp" : "");
const withBasePath = (path: string) => `${basePath}${path}`;

const features = [
  {
    number: "01",
    title: "A queue that stays with you",
    description:
      "Build the night’s listening once. Coda restores your queue, current track, playhead, repeat setting, and volume when you return.",
  },
  {
    number: "02",
    title: "Your collection, made navigable",
    description:
      "Move through releases, artists, albums, singles, genres, and recent additions without losing the thread of what is playing.",
  },
  {
    number: "03",
    title: "Discover without the detour",
    description:
      "Explore Bandcamp Discover and complete Radio show archives beside the music you already own.",
  },
  {
    number: "04",
    title: "Playlists that stay in sync",
    description:
      "Manage Bandcamp playlists from the desktop, while keeping quick favorites private to the device in front of you.",
  },
  {
    number: "05",
    title: "Scrobbling that respects listening",
    description:
      "Connect Last.fm through its desktop flow. Tracks scrobble only after genuine listening time reaches the threshold.",
  },
  {
    number: "06",
    title: "Native where it matters",
    description:
      "Use system title bars, media controls, tray actions, secure credential storage, and AirPlay on supported macOS hosts.",
  },
];

const securityDetails = [
  {
    title: "Your normal Bandcamp password never enters Coda",
    description:
      "Coda connects with separate credentials generated from Bandcamp Fan Settings through Bandcamp’s official Subsonic endpoint.",
  },
  {
    title: "Credentials stay in the operating system vault",
    description:
      "Generated credentials are stored in Keychain, Windows Credential Manager, or Linux Secret Service—not local app files.",
  },
  {
    title: "Signed media links are treated as temporary",
    description:
      "Stream and artwork URLs are refreshed when needed and never written into your persisted player session.",
  },
];

function Brand() {
  return (
    <a
      href={withBasePath("/")}
      aria-label="Homepage"
      className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec6848]"
    >
      <Image
        src={withBasePath("/coda-icon.png")}
        alt=""
        width={512}
        height={512}
        className="size-7 shrink-0 rounded-[min(1vw,0.45rem)]"
      />
      <div className="text-lg font-semibold tracking-tight text-[#f6f2e9]">
        Coda
      </div>
    </a>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-[#101213]/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center">
          <Brand />
        </div>

        <nav
          aria-label="Primary navigation"
          className="flex items-center gap-8 max-lg:hidden"
        >
          <div className="text-sm font-normal text-[#aaa9a5]">
            <a href="#features" className="hover:text-[#f6f2e9]">
              Features
            </a>
          </div>
          <div className="text-sm font-normal text-[#aaa9a5]">
            <a href="#security" className="hover:text-[#f6f2e9]">
              Security
            </a>
          </div>
          <div className="text-sm font-normal text-[#aaa9a5]">
            <a href="#open-source" className="hover:text-[#f6f2e9]">
              Open source
            </a>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <div className="text-sm max-sm:hidden">
            <a
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-2 font-medium text-[#d6d2ca] ring-1 ring-white/12 hover:bg-white/6 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ec6848]"
            >
              View on GitHub
            </a>
          </div>

          <details className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-base font-medium text-[#d6d2ca] ring-1 ring-white/12 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ec6848] sm:text-sm">
              Menu
              <span
                className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                aria-hidden="true"
              />
            </summary>
            <nav
              aria-label="Mobile navigation"
              className="absolute top-[calc(100%+--spacing(3))] right-0 grid w-52 gap-1 rounded-xl bg-[#191b1c] p-2 ring-1 ring-white/10"
            >
              <div className="text-base text-[#d6d2ca] sm:text-sm">
                <a
                  href="#features"
                  className="flex rounded-lg px-3 py-2.5 hover:bg-white/6 hover:text-white"
                >
                  Features
                </a>
              </div>
              <div className="text-base text-[#d6d2ca] sm:text-sm">
                <a
                  href="#security"
                  className="flex rounded-lg px-3 py-2.5 hover:bg-white/6 hover:text-white"
                >
                  Security
                </a>
              </div>
              <div className="text-base text-[#d6d2ca] sm:text-sm">
                <a
                  href="#open-source"
                  className="flex rounded-lg px-3 py-2.5 hover:bg-white/6 hover:text-white"
                >
                  Open source
                </a>
              </div>
              <div className="text-base text-[#d6d2ca] sm:text-sm">
                <a
                  href={repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex rounded-lg px-3 py-2.5 hover:bg-white/6 hover:text-white"
                >
                  GitHub
                </a>
              </div>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <main className="isolate overflow-hidden bg-[#101213] text-[#f6f2e9]">
      <Header />

      <section className="relative py-20 sm:py-28 lg:py-32">
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_76%_24%,rgba(236,104,72,0.18),transparent_34%)]"
          aria-hidden="true"
        />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[5fr_7fr] lg:px-8">
          <div className="grid gap-6">
            <p className="font-mono text-base font-medium uppercase tracking-wide text-[#ec6848] sm:text-sm">
              Coda for desktop
            </p>
            <h1 className="max-w-[30ch] text-balance text-5xl font-semibold tracking-tight sm:max-w-[24ch] sm:text-6xl lg:max-w-[20ch] lg:text-7xl">
              Your Bandcamp library, built for listening
            </h1>
            <p className="max-w-[40ch] text-pretty text-xl text-[#b9b7b1] sm:max-w-[48ch] sm:text-lg">
              Coda turns your collection into a focused desktop player with a
              persistent queue, fast navigation, Radio, Discover, playlists,
              and Last.fm scrobbling.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-base sm:text-sm">
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-lg bg-[#ec6848] px-4 py-3 font-semibold text-[#17191b] ring-1 ring-[#ec6848] hover:bg-[#f1785b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ec6848] sm:py-2.5"
                >
                  Download Coda v0.2.0
                </a>
              </div>
              <div className="text-base sm:text-sm">
                <a
                  href="#demo"
                  className="font-medium text-[#d6d2ca] underline decoration-white/25 underline-offset-4 hover:text-white hover:decoration-[#ec6848] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec6848]"
                >
                  See it in motion
                </a>
              </div>
            </div>
            <p className="max-w-[56ch] text-pretty text-base text-[#858581] sm:text-sm">
              Free and open source. Available for macOS, Windows, and Linux.
            </p>
          </div>

          <div id="demo" className="min-w-0 scroll-mt-24">
            <div className="overflow-hidden rounded-[min(1vw,1rem)] bg-[#17191b] outline-1 -outline-offset-1 outline-white/10">
              <Image
                src={withBasePath("/coda-demo.gif")}
                alt="Coda browsing a Bandcamp collection, playing an album, opening the queue, and moving through Now Playing, Favorites, and Discover."
                width={1200}
                height={752}
                unoptimized
                priority
                className="h-auto w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Platform support"
        className="border-y border-white/8 py-6"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 sm:px-6 lg:px-8">
          <p className="text-base font-medium text-[#f6f2e9] sm:text-sm">
            macOS · Windows · Linux
          </p>
          <p className="text-base text-[#858581] sm:text-sm">
            Official Bandcamp Subsonic connection.
          </p>
          <p className="text-base text-[#858581] sm:text-sm">
            MIT licensed and open source.
          </p>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6">
            <p className="font-mono text-base font-medium uppercase tracking-wide text-[#ec6848] sm:text-sm">
              Listen without losing your place
            </p>
            <h2 className="max-w-[35ch] text-balance text-4xl font-semibold tracking-tight sm:max-w-[30ch] sm:text-5xl">
              Made for collections that deserve more than a browser tab
            </h2>
            <p className="max-w-[40ch] text-pretty text-xl text-[#aaa9a5] sm:max-w-[48ch] sm:text-lg">
              Coda keeps the rituals that matter—browsing, queuing, replaying,
              and discovering—close together without flattening your library
              into an endless feed.
            </p>
          </div>

          <dl className="grid gap-12 pt-14 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.number}
                className="grid gap-3 border-t border-white/10 pt-5"
              >
                <p className="tabular-nums font-mono text-base text-[#ec6848] sm:text-sm">
                  {feature.number}
                </p>
                <dt className="text-xl font-semibold text-[#f6f2e9]">
                  {feature.title}
                </dt>
                <dd className="text-pretty text-lg text-[#91908c] sm:text-base">
                  {feature.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="security" className="scroll-mt-20 border-t border-white/8 py-24 sm:py-32">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[5fr_7fr] lg:px-8">
          <div className="grid gap-6">
            <p className="font-mono text-base font-medium uppercase tracking-wide text-[#ec6848] sm:text-sm">
              A small security surface
            </p>
            <h2 className="max-w-[35ch] text-balance text-4xl font-semibold tracking-tight sm:max-w-[30ch] sm:text-5xl">
              The music comes through. Your secrets stay put
            </h2>
            <p className="max-w-[40ch] text-pretty text-xl text-[#aaa9a5] sm:max-w-[48ch] sm:text-lg">
              Coda keeps account and network work behind the native boundary,
              where desktop credential storage and strict URL validation can do
              their jobs.
            </p>
          </div>

          <dl className="grid gap-12">
            {securityDetails.map((detail) => (
              <div
                key={detail.title}
                className="grid gap-12 border-t border-white/10 pt-5 sm:grid-cols-[5fr_7fr]"
              >
                <dt className="text-lg font-semibold text-[#f6f2e9]">
                  {detail.title}
                </dt>
                <dd className="text-pretty text-lg text-[#91908c] sm:text-base">
                  {detail.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="open-source" className="scroll-mt-20 border-t border-white/8 py-24 sm:py-32">
        <div className="mx-auto grid max-w-7xl items-end gap-12 px-4 sm:px-6 lg:grid-cols-[7fr_5fr] lg:px-8">
          <div className="grid gap-6">
            <p className="font-mono text-base font-medium uppercase tracking-wide text-[#ec6848] sm:text-sm">
              Yours to inspect
            </p>
            <h2 className="max-w-[35ch] text-balance text-4xl font-semibold tracking-tight sm:max-w-[30ch] sm:text-5xl">
              Open source, cross-platform, and independent
            </h2>
            <p className="max-w-[40ch] text-pretty text-xl text-[#aaa9a5] sm:max-w-[48ch] sm:text-lg">
              Coda is built in the open with Tauri, Rust, React, and TypeScript.
              Read the security model, follow development, or contribute the
              feature your library needs next.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 lg:justify-end">
            <div className="text-base sm:text-sm">
              <a
                href={repositoryUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-lg px-4 py-3 font-semibold text-[#f6f2e9] ring-1 ring-white/15 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ec6848] sm:py-2.5"
              >
                Explore the repository
              </a>
            </div>
            <div className="text-base sm:text-sm">
              <a
                href={releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[#d6d2ca] underline decoration-white/25 underline-offset-4 hover:text-white hover:decoration-[#ec6848] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec6848]"
              >
                Get the latest release
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/8 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Brand />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="text-base font-normal text-[#858581] sm:text-sm">
              <a href={repositoryUrl} className="hover:text-[#f6f2e9]">
                GitHub
              </a>
            </div>
            <div className="text-base font-normal text-[#858581] sm:text-sm">
              <a
                href={`${repositoryUrl}/blob/main/SECURITY.md`}
                className="hover:text-[#f6f2e9]"
              >
                Security
              </a>
            </div>
            <p className="text-base text-[#858581] sm:text-sm">
              Independent of Bandcamp and Last.fm.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
