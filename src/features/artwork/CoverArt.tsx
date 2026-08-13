import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  fetchCoverUrl,
  initials,
  invalidateCoverUrl,
  isDesktop,
  readCachedCoverUrl,
} from "@/lib";
import { cn } from "@/lib/utils";
import type { Album } from "@/types";

const MAX_WARM_COVER_URLS = 512;
const warmCoverUrls = new Set<string>();

function rememberWarmCoverUrl(url: string) {
  warmCoverUrls.delete(url);
  warmCoverUrls.add(url);
  if (warmCoverUrls.size <= MAX_WARM_COVER_URLS) return;
  const oldest = warmCoverUrls.values().next().value;
  if (oldest) warmCoverUrls.delete(oldest);
}

export type CoverArtAlbum = Pick<
  Album,
  "id" | "title" | "artist" | "coverArt" | "artworkUrl" | "palette"
>;

type CoverArtProps = {
  album: CoverArtAlbum;
  albumArtworkDetail?: string;
  animateChanges?: boolean;
  artistArtworkDetail?: string;
  className?: string;
  fallbackArtworkUrl?: string;
  size?: "card" | "small" | "large";
};

export function CoverArt({
  album,
  albumArtworkDetail,
  size = "card",
  fallbackArtworkUrl,
  animateChanges = false,
  artistArtworkDetail,
  className,
}: CoverArtProps) {
  const [url, setUrl] = useState<string | undefined>(
    () =>
      album.artworkUrl ||
      fallbackArtworkUrl ||
      (album.coverArt ? readCachedCoverUrl(album.coverArt) : undefined),
  );
  const [requestVersion, setRequestVersion] = useState(0);
  const retryCountRef = useRef(0);
  const coverIdRef = useRef(album.coverArt);
  const failedImageUrlsRef = useRef(new Set<string>());
  const sourceConfigurationRef = useRef({
    albumId: album.id,
    artworkUrl: album.artworkUrl,
    coverArt: album.coverArt,
    fallbackArtworkUrl,
  });

  useEffect(() => {
    const refresh = () => {
      retryCountRef.current = 0;
      setRequestVersion((version) => version + 1);
    };
    window.addEventListener("coda:refresh-artwork", refresh);
    return () => window.removeEventListener("coda:refresh-artwork", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    const sourceConfiguration = sourceConfigurationRef.current;
    if (
      sourceConfiguration.albumId !== album.id ||
      sourceConfiguration.artworkUrl !== album.artworkUrl ||
      sourceConfiguration.coverArt !== album.coverArt ||
      sourceConfiguration.fallbackArtworkUrl !== fallbackArtworkUrl
    ) {
      sourceConfigurationRef.current = {
        albumId: album.id,
        artworkUrl: album.artworkUrl,
        coverArt: album.coverArt,
        fallbackArtworkUrl,
      };
      failedImageUrlsRef.current.clear();
      retryCountRef.current = 0;
    }
    if (coverIdRef.current !== album.coverArt) {
      coverIdRef.current = album.coverArt;
      retryCountRef.current = 0;
    }
    if (album.artworkUrl && !failedImageUrlsRef.current.has(album.artworkUrl)) {
      setUrl(album.artworkUrl);
      return;
    }
    if (
      fallbackArtworkUrl &&
      !failedImageUrlsRef.current.has(fallbackArtworkUrl)
    ) {
      setUrl(fallbackArtworkUrl);
      return;
    }
    if (!album.coverArt || !isDesktop()) {
      setUrl(undefined);
      return;
    }
    const cachedUrl = readCachedCoverUrl(album.coverArt);
    if (cachedUrl && !failedImageUrlsRef.current.has(cachedUrl)) {
      setUrl(cachedUrl);
      return;
    }
    fetchCoverUrl(album.coverArt)
      .then((value) => {
        if (active) setUrl(value);
      })
      .catch(() => {
        if (active) setUrl(undefined);
      });
    return () => {
      active = false;
    };
  }, [
    album.artworkUrl,
    album.coverArt,
    album.id,
    fallbackArtworkUrl,
    requestVersion,
  ]);

  const retryImage = () => {
    if (url) failedImageUrlsRef.current.add(url);
    if (
      fallbackArtworkUrl &&
      url !== fallbackArtworkUrl &&
      !failedImageUrlsRef.current.has(fallbackArtworkUrl)
    ) {
      setUrl(fallbackArtworkUrl);
      return;
    }
    setUrl(undefined);
    if (!album.coverArt || retryCountRef.current >= 1) return;
    retryCountRef.current += 1;
    invalidateCoverUrl(album.coverArt);
    setRequestVersion((version) => version + 1);
  };

  const sizeClassName =
    size === "card"
      ? "aspect-square w-full rounded-md shadow-[0_10px_24px_rgba(0,0,0,0.24)]"
      : size === "small"
        ? "size-10 rounded-sm"
        : "size-52 rounded-md shadow-[0_20px_42px_rgba(0,0,0,0.35)]";
  const warm = Boolean(url && warmCoverUrls.has(url));

  return (
    <div
      data-slot="cover"
      data-cover-size={size}
      data-coda-album-artwork-detail={albumArtworkDetail}
      data-coda-artist-artwork-detail={artistArtworkDetail}
      className={cn(
        "relative isolate shrink-0 overflow-hidden bg-(--cover-base) text-[#f7f3e8]",
        sizeClassName,
        animateChanges &&
          "[&>img]:animate-[cover-artwork-in_var(--duration-coda-standard)_var(--ease-coda-enter)]",
        className,
      )}
      style={
        {
          "--cover-accent": album.palette[0],
          "--cover-base": album.palette[1],
        } as CSSProperties
      }
    >
      {url ? (
        <img
          key={url}
          src={url}
          alt={`${album.title} cover`}
          loading={size === "card" && !warm ? "lazy" : "eager"}
          decoding={warm ? "sync" : "async"}
          draggable={false}
          onError={() => {
            warmCoverUrls.delete(url);
            retryImage();
          }}
          onLoad={() => rememberWarmCoverUrl(url)}
          className="relative z-10 block size-full object-cover"
        />
      ) : null}
      <span
        aria-hidden="true"
        className="absolute top-[12%] left-[9%] h-1 w-[31%] bg-(--cover-accent)"
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-[9%] font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] leading-none font-semibold tracking-[-0.08em]",
          size === "small"
            ? "top-[22%] text-xs"
            : "top-[24%] text-[clamp(18px,4vw,38px)]",
        )}
      >
        {initials(album.title)}
      </span>
      {size === "small" ? null : (
        <span
          aria-hidden="true"
          className="absolute right-[8%] bottom-[8%] left-[9%] truncate text-left text-[clamp(6px,0.75vw,9px)] font-bold tracking-widest uppercase"
        >
          {album.artist}
        </span>
      )}
    </div>
  );
}
