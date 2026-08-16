import { memo, useState } from "react";

import { initials } from "@/lib";
import { cn } from "@/lib/utils";
import {
  forgetPaintedCoverSource,
  hasPaintedCoverSource,
  rememberPaintedCoverSource,
} from "@/paintedCoverSources";
import type { RadioShowSummary } from "@/types";

export const RadioArtwork = memo(function RadioArtwork({
  show,
  eager = false,
  className,
  detail = false,
}: {
  show: RadioShowSummary;
  eager?: boolean;
  className?: string;
  detail?: boolean;
}) {
  const artworkUrl = show.artworkUrl;
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string>();
  const [loadedArtworkUrl, setLoadedArtworkUrl] = useState<string>();
  const artworkEligible = Boolean(
    artworkUrl && failedArtworkUrl !== artworkUrl,
  );
  const artworkLoaded = Boolean(
    artworkEligible &&
      artworkUrl &&
      (loadedArtworkUrl === artworkUrl || hasPaintedCoverSource(artworkUrl)),
  );

  return (
    <div
      className={cn(
        "grid aspect-square place-items-center overflow-hidden rounded-lg border border-white/7 bg-coda-hover text-6xl font-bold text-[#a2a49f]",
        className,
      )}
      data-radio-show-artwork={show.id}
      data-coda-radio-artwork-detail={detail ? show.id : undefined}
    >
      {artworkEligible && artworkUrl ? (
        <img
          key={artworkUrl}
          className={cn(
            "col-start-1 row-start-1 size-full object-cover",
            !artworkLoaded && "invisible",
          )}
          data-radio-show-artwork-image={artworkUrl}
          src={artworkUrl}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => {
            forgetPaintedCoverSource(artworkUrl);
            setFailedArtworkUrl(artworkUrl);
          }}
          onLoad={() => {
            rememberPaintedCoverSource(artworkUrl);
            setLoadedArtworkUrl(artworkUrl);
            setFailedArtworkUrl((current) =>
              current === artworkUrl ? undefined : current,
            );
          }}
        />
      ) : null}
      {!artworkLoaded ? (
        <span
          className="col-start-1 row-start-1"
          data-radio-show-artwork-fallback={artworkUrl ?? "missing"}
        >
          {initials(show.subtitle)}
        </span>
      ) : null}
    </div>
  );
});
