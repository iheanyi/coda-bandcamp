import { Link } from "@tanstack/react-router";
import { ExternalLink, Heart, ListMusic, ListPlus } from "lucide-react";
import { AnimatePresence, useReducedMotionConfig } from "motion/react";
import * as m from "motion/react-m";
import {
  memo,
  type MouseEvent,
  useState,
  useSyncExternalStore,
} from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { radioEpisodeUrl } from "@/radioSeries";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  stringifyRadioShowIdParam,
  type RadioSeriesId,
} from "@/routing/routeContracts";
import type { RadioShowSummary } from "@/types";

import { RadioArtwork } from "./RadioArtwork";
import { showDate } from "./radioPresentationFormatting";
import { radioShowId } from "./radioRouteIds";
import { RadioSeriesLink } from "./RadioSeriesNavigation";

const hoverCapabilityQuery = "(hover: hover) and (pointer: fine)";

function getHoverCapability() {
  return window.matchMedia?.(hoverCapabilityQuery).matches ?? true;
}

function subscribeToHoverCapability(onChange: () => void) {
  if (!window.matchMedia) return () => undefined;
  const query = window.matchMedia(hoverCapabilityQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useHoverCapability() {
  return useSyncExternalStore(
    subscribeToHoverCapability,
    getHoverCapability,
    () => true,
  );
}

export const RadioCard = memo(function RadioCard({
  show,
  busyAction,
  active,
  playing,
  onPlay,
  onTogglePlayback,
  onQueue,
  onDetails,
  favorite,
  onToggleFavorite,
  onOpenItem,
  onBrowseSeries,
}: {
  show: RadioShowSummary;
  busyAction?: "play" | "queue";
  active: boolean;
  playing: boolean;
  onPlay: (show: RadioShowSummary) => void;
  onTogglePlayback: () => void;
  onQueue: (show: RadioShowSummary) => void;
  onDetails: (show: RadioShowSummary, trigger: HTMLAnchorElement) => void;
  favorite: boolean;
  onToggleFavorite: (show: RadioShowSummary) => void;
  onOpenItem: (url: string) => void;
  onBrowseSeries: (seriesId?: RadioSeriesId) => void;
}) {
  const showId = radioShowId(show.id);
  const showIdParam = showId ? stringifyRadioShowIdParam(showId) : undefined;
  const canHover = useHoverCapability();
  const reduceMotion = useReducedMotionConfig() === true;
  const [hovered, setHovered] = useState(false);
  const [keyboardFocusWithin, setKeyboardFocusWithin] = useState(false);
  const actionsExpanded =
    canHover && (hovered || keyboardFocusWithin || Boolean(busyAction));
  const motionTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, bounce: 0.06, visualDuration: 0.32 };
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!showId) return;
    handleCodaLinkActivation(event, (trigger) => onDetails(show, trigger));
  };

  const playbackControl = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-compact"
            className={cn(
              "group/action size-8 rounded-md text-[#f09a83] hover:text-[#ffc0b0]",
              active && "bg-primary/20 text-[#ffc0b0]",
            )}
            onClick={active ? onTogglePlayback : () => onPlay(show)}
            disabled={Boolean(busyAction)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${show.subtitle}`
                : `Play ${show.subtitle}`
            }
            aria-pressed={active && playing}
          />
        }
      >
        {busyAction === "play" ? (
          <Spinner
            aria-hidden="true"
            className="size-4 text-current motion-reduce:animate-none"
          />
        ) : (
          <PlaybackIcon
            className="size-4 transition-transform duration-300 ease-out group-hover/action:scale-110 group-focus-visible/action:scale-110 group-active/action:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
            playing={active && playing}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {active ? (playing ? "Pause" : "Resume") : "Play show"}
      </TooltipContent>
    </Tooltip>
  );

  const auxiliaryActionControls = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-compact"
              className={cn(
                "group/action size-8 rounded-md",
                favorite && "text-coda-favorite",
              )}
              onClick={() => onToggleFavorite(show)}
              disabled={Boolean(busyAction)}
              aria-label={
                favorite
                  ? `Remove ${show.subtitle} from favorites`
                  : `Add ${show.subtitle} to favorites`
              }
              aria-pressed={favorite}
            />
          }
        >
          <Heart
            className="transition-transform duration-300 ease-out group-hover/action:-rotate-6 group-hover/action:scale-110 group-focus-visible/action:-rotate-6 group-focus-visible/action:scale-110 group-active/action:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
            size={15}
            fill={favorite ? "currentColor" : "none"}
          />
        </TooltipTrigger>
        <TooltipContent>
          {favorite ? "Remove from favorites" : "Add to favorites"}
        </TooltipContent>
      </Tooltip>
      {showIdParam ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                aria-label={`View tracklist for ${show.subtitle}`}
                className={cn(
                  buttonVariants({
                    variant: "ghost",
                    size: "icon-compact",
                  }),
                  "group/action size-8 rounded-md",
                )}
                data-radio-show-navigation-slot="tracklist"
                data-radio-show-open={show.id}
                onClick={openDetails}
                params={{ showId: showIdParam }}
                to="/radio/shows/$showId"
              />
            }
          >
            <ListMusic
              className="transition-transform duration-300 ease-out group-hover/action:-translate-y-0.5 group-focus-visible/action:-translate-y-0.5 group-active/action:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
              size={15}
            />
          </TooltipTrigger>
          <TooltipContent>View tracklist</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-compact"
              className="group/action size-8 rounded-md"
              onClick={() => onQueue(show)}
              disabled={Boolean(busyAction)}
              aria-label={`Add ${show.subtitle} to queue`}
            />
          }
        >
          {busyAction === "queue" ? (
            <Spinner
              aria-hidden="true"
              className="size-4 text-current motion-reduce:animate-none"
            />
          ) : (
            <ListPlus
              className="transition-transform duration-300 ease-out group-hover/action:rotate-6 group-hover/action:scale-110 group-focus-visible/action:rotate-6 group-focus-visible/action:scale-110 group-active/action:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
              size={15}
            />
          )}
        </TooltipTrigger>
        <TooltipContent>Add show to queue</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-compact"
              className="group/action size-8 rounded-md"
              onClick={() => onOpenItem(radioEpisodeUrl(show.id))}
              aria-label={`Open ${show.subtitle} on Bandcamp`}
            />
          }
        >
          <ExternalLink
            className="transition-transform duration-300 ease-out group-hover/action:translate-x-0.5 group-hover/action:-translate-y-0.5 group-focus-visible/action:translate-x-0.5 group-focus-visible/action:-translate-y-0.5 group-active/action:translate-x-0 group-active/action:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
            size={14}
          />
        </TooltipTrigger>
        <TooltipContent>Open on Bandcamp</TooltipContent>
      </Tooltip>
    </>
  );

  const actionControls = (
    <div
      className="flex items-center justify-between gap-0.5"
      data-radio-card-actions=""
    >
      {playbackControl}
      {auxiliaryActionControls}
    </div>
  );

  return (
    <m.article
      className={cn(
        "group/card relative min-w-0 overflow-hidden rounded-lg border border-(--line) bg-[#151719] transition-[border-color,background-color,box-shadow] duration-(--duration-coda-standard) ease-coda-enter motion-reduce:transition-none",
        actionsExpanded &&
          "border-(--line-strong) bg-[#181b1d] shadow-[0_12px_30px_rgba(0,0,0,0.3)]",
      )}
      data-radio-card=""
      onBlurCapture={(event) => {
        const relatedTarget = event.relatedTarget;
        if (
          !(relatedTarget instanceof Node) ||
          !event.currentTarget.contains(relatedTarget)
        ) {
          setKeyboardFocusWithin(false);
        }
      }}
      onFocusCapture={(event) =>
        setKeyboardFocusWithin(event.target.matches(":focus-visible"))
      }
      onHoverEnd={() => setHovered(false)}
      onHoverStart={() => setHovered(true)}
    >
      <div className="relative overflow-hidden">
        <m.div
          animate={{
            transform: actionsExpanded ? "scale(1.018)" : "scale(1)",
          }}
          initial={false}
          transition={motionTransition}
        >
          <RadioArtwork
            show={show}
            className="rounded-none border-x-0 border-t-0 text-3xl"
          />
        </m.div>
        {showIdParam ? (
          <Link
            aria-label={`Open ${show.subtitle}`}
            className="absolute inset-0 rounded-t-lg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            data-radio-show-navigation-slot="artwork"
            data-radio-show-open={show.id}
            onClick={openDetails}
            params={{ showId: showIdParam }}
            to="/radio/shows/$showId"
          />
        ) : null}
        {canHover ? (
          <>
            <m.div
              animate={{ opacity: actionsExpanded ? 1 : 0 }}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_46%,rgba(7,8,9,0.78)_100%)]"
              initial={false}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
              }
            />
            <m.div
              animate={{
                opacity: actionsExpanded ? 1 : 0,
                transform: actionsExpanded
                  ? "translateY(0px)"
                  : "translateY(10px)",
              }}
              className={cn(
                "absolute bottom-2 left-2 z-10 overflow-hidden rounded-lg border border-white/10 bg-[#101214]/92 p-1.5 shadow-[0_8px_22px_rgba(0,0,0,0.34)] backdrop-blur-md transition-[width] duration-300 ease-coda-enter motion-reduce:transition-none",
                actionsExpanded ? "pointer-events-auto" : "pointer-events-none",
              )}
              initial={false}
              style={{
                width: actionsExpanded ? "calc(100% - 1rem)" : "2.75rem",
              }}
              transition={motionTransition}
            >
              <div
                className="flex items-center gap-0.5"
                data-radio-card-actions=""
                data-radio-card-actions-expanded={actionsExpanded}
              >
                {playbackControl}
                <AnimatePresence initial={false}>
                  {actionsExpanded ? (
                    <m.div
                      animate={{
                        opacity: 1,
                        transform: "translateX(0px)",
                      }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-0.5"
                      exit={{
                        opacity: 0,
                        transform: "translateX(-8px)",
                      }}
                      initial={{
                        opacity: 0,
                        transform: "translateX(-8px)",
                      }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
                      }
                    >
                      {auxiliaryActionControls}
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </m.div>
          </>
        ) : null}
      </div>
      <div className="relative flex min-h-44 flex-col p-3.5">
        <div className="min-h-3.5 text-xs font-bold tracking-widest text-[#cb7560] uppercase">
          <RadioSeriesLink show={show} onBrowse={onBrowseSeries} />
        </div>
        <h3
          className="mt-1.5 mb-1 min-w-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base/tight font-semibold text-[#ebe9e3]"
          data-radio-show-title={show.id}
        >
          {showIdParam ? (
            <Link
              className="block min-w-0 outline-none hover:text-[#f09a83] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              data-radio-show-navigation-slot="title"
              data-radio-show-open={show.id}
              onClick={openDetails}
              params={{ showId: showIdParam }}
              to="/radio/shows/$showId"
            >
              <OverflowMarquee text={show.subtitle} />
            </Link>
          ) : (
            <OverflowMarquee text={show.subtitle} />
          )}
        </h3>
        <time className="text-xs text-[#737772]" dateTime={show.publishedAt}>
          {showDate(show.publishedAt)}
        </time>
        <p
          className={cn(
            "mt-2.5 text-xs/normal text-[#8d918b]",
            canHover ? "mb-0 line-clamp-4" : "mb-3.5 line-clamp-3 min-h-11",
          )}
        >
          {show.description}
        </p>
        {!canHover ? <div className="mt-auto">{actionControls}</div> : null}
      </div>
    </m.article>
  );
});
