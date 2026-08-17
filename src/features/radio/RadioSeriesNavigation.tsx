import { Link } from "@tanstack/react-router";
import { memo } from "react";

import { ScrollableLinkSelectionRail } from "@/components/ScrollableLinkSelectionRail";
import { Badge } from "@/components/ui/badge";
import {
  BANDCAMP_RADIO_PROVIDER,
  radioSeriesForShow,
  radioShowIdentity,
} from "@/radioIdentity";
import { BANDCAMP_RADIO_SERIES } from "@/radioSeries";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  stringifyRadioSeriesIdParam,
  type RadioSeriesId,
} from "@/routing/routeContracts";
import type { RadioShowSummary } from "@/types";

import { radioSeriesId } from "./radioRouteIds";

const radioSeriesLayoutGroupId = "coda-radio-series-navigation";
const radioSeriesNavItems = [
  { label: "All shows", value: "all" },
  ...BANDCAMP_RADIO_SERIES.map((series) => ({
    label: series.title,
    value: String(series.id),
  })),
];

export const RadioSeriesLink = memo(function RadioSeriesLink({
  show,
  onBrowse,
}: {
  show: RadioShowSummary;
  onBrowse: (seriesId?: RadioSeriesId) => void;
}) {
  const identity = radioShowIdentity(show);
  const series = radioSeriesForShow(show);
  if (!series) {
    if (identity.seriesTitle) {
      return (
        <span className="inline-flex max-w-full items-center truncate">
          {identity.seriesTitle}
        </span>
      );
    }
    return (
      <Link
        activeOptions={{ exact: true }}
        className="inline-flex max-w-full items-center truncate outline-none hover:text-[#f09a83] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={(event) => handleCodaLinkActivation(event, () => onBrowse())}
        to="/radio"
      >
        {identity.provider}
      </Link>
    );
  }
  const seriesId = radioSeriesId(series.id);
  if (!seriesId) {
    return (
      <span className="inline-flex max-w-full items-center truncate">
        {series.title}
      </span>
    );
  }
  return (
    <Link
      activeOptions={{ exact: true }}
      aria-label={`Browse ${series.title} episodes`}
      className="inline-flex h-auto max-w-full justify-start overflow-hidden p-0 text-left text-inherit hover:bg-transparent hover:text-[#f09a83]"
      onClick={(event) =>
        handleCodaLinkActivation(event, () => onBrowse(seriesId))
      }
      params={{ seriesId: stringifyRadioSeriesIdParam(seriesId) }}
      title={`Browse ${series.title} in Coda`}
      to="/radio/series/$seriesId"
    >
      <span className="truncate">{series.title}</span>
    </Link>
  );
});

export const RadioSeriesNav = memo(function RadioSeriesNav({
  selectedSeriesId,
  pending,
  onSelect,
  seriesTravelSteps,
}: {
  selectedSeriesId?: RadioSeriesId;
  pending: boolean;
  onSelect: (seriesId?: RadioSeriesId) => void;
  seriesTravelSteps?: number;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-6 max-xl:flex-col max-xl:items-start max-xl:gap-2.5">
      <div className="grid shrink-0 gap-1">
        <Badge
          variant="artwork"
          className="h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase"
        >
          Browse by show
        </Badge>
        <strong className="font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-lg/tight font-semibold tracking-tight text-[#e5e3dc]">
          {BANDCAMP_RADIO_PROVIDER}
        </strong>
      </div>
      <ScrollableLinkSelectionRail
        aria-label={`${BANDCAMP_RADIO_PROVIDER} shows`}
        busy={pending}
        className="min-w-0 max-xl:w-full"
        indicatorDataAttributes={{
          "data-radio-series-active-indicator": "",
        }}
        indicatorMotionDataAttribute="data-radio-series-indicator-motion"
        items={radioSeriesNavItems}
        layoutGroupId={radioSeriesLayoutGroupId}
        linkClassName="text-[#858984] hover:text-[#c8c8c2]"
        navClassName="p-0.5"
        navDataAttributes={{
          "data-radio-series-layout-group": radioSeriesLayoutGroupId,
        }}
        renderLink={(item, state) => {
          if (item.value === "all") {
            return (
              <Link
                activeOptions={{ exact: true }}
                aria-current={state.selected ? "page" : undefined}
                className={state.className}
                key={item.value}
                onClick={(event) =>
                  handleCodaLinkActivation(event, () => onSelect())
                }
                preload="intent"
                ref={state.ref}
                to="/radio"
              >
                {state.children}
              </Link>
            );
          }
          const series = BANDCAMP_RADIO_SERIES.find(
            (candidate) => String(candidate.id) === item.value,
          );
          if (!series) return null;
          return (
            <Link
              activeOptions={{ exact: true }}
              aria-current={state.selected ? "page" : undefined}
              className={state.className}
              key={item.value}
              onClick={(event) =>
                handleCodaLinkActivation(event, () => onSelect(series.id))
              }
              params={{
                seriesId: stringifyRadioSeriesIdParam(series.id),
              }}
              preload="intent"
              ref={state.ref}
              to="/radio/series/$seriesId"
            >
              {state.children}
            </Link>
          );
        }}
        travelSteps={seriesTravelSteps}
        value={
          selectedSeriesId === undefined ? "all" : String(selectedSeriesId)
        }
      />
    </div>
  );
});
