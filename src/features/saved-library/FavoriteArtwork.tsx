import { Music2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { invalidateCoverArt, useCoverArtSource } from "@/coverArtSource";
import { cn } from "@/lib/utils";
import {
  forgetPaintedCoverSource,
  hasPaintedCoverSource,
  rememberPaintedCoverSource,
} from "@/paintedCoverSources";
import type { Album } from "@/types";

export function FavoriteArtwork({
  className,
  fallback,
  item,
}: {
  className?: string;
  fallback?: React.ReactNode;
  item: Pick<Album, "title" | "coverArt" | "artworkUrl" | "palette">;
}) {
  const localArtworkUrl = useCoverArtSource(item.coverArt);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [revealingUrl, setRevealingUrl] = useState<string>();
  const [, setFailureVersion] = useState(0);
  const mountedRef = useRef(false);
  const coverIdRef = useRef(item.coverArt);
  const directArtworkUrlRef = useRef(item.artworkUrl);
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const retryCountRef = useRef(0);
  const retryPendingRef = useRef(false);
  const retryRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      retryRequestRef.current += 1;
      failedUrlsRef.current.clear();
      retryCountRef.current = 0;
      retryPendingRef.current = false;
      setFailureVersion((version) => version + 1);
    };
    window.addEventListener("coda:refresh-artwork", refresh);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("coda:refresh-artwork", refresh);
    };
  }, []);

  if (
    coverIdRef.current !== item.coverArt ||
    (!item.coverArt && directArtworkUrlRef.current !== item.artworkUrl)
  ) {
    coverIdRef.current = item.coverArt;
    directArtworkUrlRef.current = item.artworkUrl;
    retryRequestRef.current += 1;
    failedUrlsRef.current.clear();
    retryCountRef.current = 0;
    retryPendingRef.current = false;
  }

  const url = (item.coverArt ? [localArtworkUrl] : [item.artworkUrl]).find(
    (candidate) => Boolean(candidate && !failedUrlsRef.current.has(candidate)),
  );

  const retryImage = (failedUrl: string) => {
    failedUrlsRef.current.add(failedUrl);
    forgetPaintedCoverSource(failedUrl);
    setLoadedUrl((current) => (current === failedUrl ? undefined : current));
    if (!item.coverArt || retryCountRef.current >= 1) {
      retryPendingRef.current = false;
      setFailureVersion((version) => version + 1);
      return;
    }
    retryCountRef.current += 1;
    const retryRequest = ++retryRequestRef.current;
    retryPendingRef.current = true;
    if (localArtworkUrl) failedUrlsRef.current.add(localArtworkUrl);
    setFailureVersion((version) => version + 1);
    void invalidateCoverArt(item.coverArt)
      .catch(() => undefined)
      .finally(() => {
        if (!mountedRef.current || retryRequestRef.current !== retryRequest) {
          return;
        }
        retryPendingRef.current = false;
        setFailureVersion((version) => version + 1);
      });
  };

  const localSource = Boolean(item.coverArt && url === localArtworkUrl);
  const warm = Boolean(localSource && url && hasPaintedCoverSource(url));
  const revealPending = Boolean(
    localSource && url && !warm && loadedUrl !== url,
  );
  const revealing = Boolean(localSource && url && revealingUrl === url);
  const showFallback = item.coverArt
    ? !url && !retryPendingRef.current
    : !url || loadedUrl !== url;

  return (
    <span
      className={cn(
        "relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]",
        className,
      )}
      data-slot="cover"
      style={{
        background: `linear-gradient(145deg, ${item.palette[0]}, ${item.palette[1]})`,
      }}
      aria-hidden="true"
    >
      {url ? (
        <img
          key={url}
          className={cn(
            "col-start-1 row-start-1 size-full object-cover",
            !localSource && loadedUrl !== url && "invisible",
          )}
          src={url}
          alt=""
          loading="eager"
          decoding={warm ? "sync" : localSource ? "async" : undefined}
          onError={() => retryImage(url)}
          onLoad={() => {
            if (localSource) {
              const shouldReveal = !hasPaintedCoverSource(url);
              rememberPaintedCoverSource(url);
              setRevealingUrl(shouldReveal ? url : undefined);
            }
            setLoadedUrl(url);
          }}
          onAnimationEnd={() => {
            setRevealingUrl((current) =>
              current === url ? undefined : current,
            );
          }}
          data-cover-art-pending={revealPending ? "" : undefined}
          data-cover-art-reveal={revealing ? "" : undefined}
        />
      ) : null}
      {showFallback ? (
        <span
          className="col-start-1 row-start-1 grid place-items-center"
          data-favorite-artwork-fallback=""
        >
          {fallback ?? <Music2 size={20} />}
        </span>
      ) : null}
    </span>
  );
}
