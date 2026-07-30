import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const title = "Coda — Your Bandcamp library, built for listening";
const description =
  "A fast, open-source desktop player for your Bandcamp collection, with a persistent queue, library navigation, Radio, Discover, playlists, and Last.fm.";
const isGitHubPagesBuild = process.env.CODA_GITHUB_PAGES === "true";
const defaultSiteUrl = isGitHubPagesBuild
  ? "https://iheanyi.github.io/coda-bandcamp/"
  : "https://coda-bandcamp-desktop.iekechukwu.chatgpt.site/";
const configuredSiteUrl =
  process.env.NEXT_PUBLIC_CODA_SITE_URL ?? defaultSiteUrl;
const siteUrl = new URL(
  configuredSiteUrl.endsWith("/")
    ? configuredSiteUrl
    : `${configuredSiteUrl}/`,
);
const socialImage = new URL("og.png", siteUrl).href;

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  icons: {
    icon: new URL("coda-icon.svg", siteUrl).href,
    shortcut: new URL("coda-icon.svg", siteUrl).href,
    apple: new URL("coda-icon.png", siteUrl).href,
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    title,
    description,
    siteName: "Coda",
    images: [
      {
        url: socialImage,
        width: 1536,
        height: 1024,
        alt: "Coda — Your Bandcamp library, built for listening.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scheme-only-dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
