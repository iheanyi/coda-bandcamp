import type { NextConfig } from "next";

const isGitHubPagesBuild = process.env.CODA_GITHUB_PAGES === "true";
const githubPagesBasePath =
  process.env.NEXT_PUBLIC_BASE_PATH ?? "/coda-bandcamp";

const nextConfig: NextConfig = isGitHubPagesBuild
  ? {
      output: "export",
      basePath: githubPagesBasePath,
      trailingSlash: true,
      images: {
        unoptimized: true,
      },
      typescript: {
        tsconfigPath: "tsconfig.pages.json",
      },
      turbopack: {
        root: process.cwd(),
      },
    }
  : {};

export default nextConfig;
