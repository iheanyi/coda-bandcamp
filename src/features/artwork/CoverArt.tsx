import { type CSSProperties, useEffect, useRef, useState } from "react";
import { invalidateCoverArt, useCoverArtSource } from "@/coverArtSource";
import { initials } from "@/lib";
import { cn } from "@/lib/utils";
import {
  forgetPaintedCoverSource,
  hasPaintedCoverSource,
  rememberPaintedCoverSource,
} from "@/paintedCoverSources";
import type { Album } from "@/types";

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

function viewTransitionOwnsArtwork() {
  return document.documentElement.classList.contains("coda-view-transitioning");
}

export function CoverArt({
  album,
  albumArtworkDetail,
  size = "card",
  fallbackArtworkUrl,
  animateChanges = false,
  artistArtworkDetail,
  className,
}: CoverArtProps) {
  const localArtworkUrl = useCoverArtSource(album.coverArt);
  const [, setFailureVersion] = useState(0);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [revealingUrl, setRevealingUrl] = useState<string>();
  const imageRef = useRef<HTMLImageElement>(null);
  const mountedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryPendingRef = useRef(false);
  const retryRequestRef = useRef(0);
  const failedImageUrlsRef = useRef(new Set<string>());
  const sourceConfigurationRef = useRef({
    albumId: album.id,
    artworkUrl: album.artworkUrl,
    coverArt: album.coverArt,
    fallbackArtworkUrl,
  });

  useEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      retryRequestRef.current += 1;
      retryCountRef.current = 0;
      retryPendingRef.current = false;
      failedImageUrlsRef.current.clear();
      setFailureVersion((version) => version + 1);
    };
    window.addEventListener("coda:refresh-artwork", refresh);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("coda:refresh-artwork", refresh);
    };
  }, []);

  if (
    sourceConfigurationRef.current.albumId !== album.id ||
    sourceConfigurationRef.current.coverArt !== album.coverArt ||
    (!album.coverArt &&
      (sourceConfigurationRef.current.artworkUrl !== album.artworkUrl ||
        sourceConfigurationRef.current.fallbackArtworkUrl !==
          fallbackArtworkUrl))
  ) {
    sourceConfigurationRef.current = {
      albumId: album.id,
      artworkUrl: album.artworkUrl,
      coverArt: album.coverArt,
      fallbackArtworkUrl,
    };
    retryRequestRef.current += 1;
    failedImageUrlsRef.current.clear();
    retryCountRef.current = 0;
    retryPendingRef.current = false;
  }

  const url = (
    album.coverArt ? [localArtworkUrl] : [album.artworkUrl, fallbackArtworkUrl]
  ).find((candidate) =>
    Boolean(candidate && !failedImageUrlsRef.current.has(candidate)),
  );

  const retryImage = () => {
    if (!url) return;
    failedImageUrlsRef.current.add(url);
    forgetPaintedCoverSource(url);

    if (!album.coverArt || retryCountRef.current >= 1) {
      retryPendingRef.current = false;
      setFailureVersion((version) => version + 1);
      return;
    }
    retryCountRef.current += 1;
    const retryRequest = ++retryRequestRef.current;
    retryPendingRef.current = true;
    if (localArtworkUrl) failedImageUrlsRef.current.add(localArtworkUrl);
    setFailureVersion((version) => version + 1);
    void invalidateCoverArt(album.coverArt)
      .catch(() => undefined)
      .finally(() => {
        if (!mountedRef.current || retryRequestRef.current !== retryRequest) {
          return;
        }
        retryPendingRef.current = false;
        setFailureVersion((version) => version + 1);
      });
  };

  const sizeClassName =
    size === "card"
      ? "aspect-square w-full rounded-md shadow-[0_10px_24px_rgba(0,0,0,0.24)]"
      : size === "small"
        ? "size-10 rounded-sm"
        : "size-52 rounded-md shadow-[0_20px_42px_rgba(0,0,0,0.35)]";
  const warm = Boolean(url && hasPaintedCoverSource(url));
  const revealPending = Boolean(
    url &&
    !viewTransitionOwnsArtwork() &&
    (animateChanges || !warm) &&
    loadedUrl !== url,
  );
  const revealing = Boolean(
    url && !viewTransitionOwnsArtwork() && revealingUrl === url,
  );
  const showFallback = !url && !retryPendingRef.current;
  const finishReveal = () => {
    setRevealingUrl((current) => (current === url ? undefined : current));
  };
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const handleAnimationCancel = () => {
      setRevealingUrl((current) => (current === url ? undefined : current));
    };
    image.addEventListener("animationcancel", handleAnimationCancel);
    return () => {
      image.removeEventListener("animationcancel", handleAnimationCancel);
    };
  }, [url]);

  return (
    <div
      data-slot="cover"
      data-cover-size={size}
      data-coda-album-artwork-detail={albumArtworkDetail}
      data-coda-artist-artwork-detail={artistArtworkDetail}
      className={cn(
        "relative isolate shrink-0 overflow-hidden bg-(--cover-base) text-[#f7f3e8]",
        sizeClassName,
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
          ref={imageRef}
          src={url}
          alt={`${album.title} cover`}
          loading="eager"
          decoding={warm ? "sync" : "async"}
          draggable={false}
          onError={retryImage}
          onLoad={() => {
            const shouldReveal =
              !viewTransitionOwnsArtwork() &&
              (animateChanges || !hasPaintedCoverSource(url));
            rememberPaintedCoverSource(url);
            setLoadedUrl(url);
            setRevealingUrl(shouldReveal ? url : undefined);
          }}
          onAnimationEnd={finishReveal}
          data-cover-art-pending={revealPending ? "" : undefined}
          data-cover-art-reveal={revealing ? "" : undefined}
          className="relative z-10 block size-full object-cover"
        />
      ) : null}
      {showFallback ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
