import {
  Clock3,
  Cloud,
  CloudOff,
  Compass,
  Heart,
  Library,
  ListMusic,
  Radio,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { MouseEvent } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import {
  handleCodaLinkActivation,
  isUnmodifiedPrimaryActivation,
} from "@/routing/linkActivation";
import {
  validateCollectionSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";

export type AppSidebarDestination =
  | "/collection"
  | "/favorites"
  | "/playlists"
  | "/recent"
  | "/discover"
  | "/radio";

export type AppSidebarNavigationRequest = Readonly<{
  destination: AppSidebarDestination;
  navigate: (viewTransition?: boolean) => Promise<void>;
  trigger: HTMLAnchorElement;
}>;

type AppSidebarProps = Readonly<{
  connected: boolean;
  onConnect: () => void;
  onDiscoverNavigate?: () => boolean;
  onNavigate?: (request: AppSidebarNavigationRequest) => void | Promise<void>;
}>;

const navigationLinkClass = cn(
  buttonVariants({ size: "default", variant: "ghost" }),
  "relative h-10 w-full justify-start gap-2 rounded-md px-2 text-left text-xs font-medium text-[#a8aaa5] hover:bg-white/4 hover:text-[#e3e1db] lg:gap-3 lg:px-3 lg:text-sm data-active:bg-accent data-active:text-[#f0b09f] data-active:before:absolute data-active:before:-left-3.5 data-active:before:h-5 data-active:before:w-1 data-active:before:bg-primary data-active:before:content-['']",
);

const navigationLinkProps = {
  activeOptions: { includeSearch: false },
  activeProps: { "data-active": "" },
  className: navigationLinkClass,
  "data-slot": "sidebar-menu-button",
} as const;

function NavigationLinkContent({
  icon: Icon,
  label,
}: Readonly<{
  icon: LucideIcon;
  label: string;
}>) {
  return (
    <>
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
    </>
  );
}

function AppSidebar({
  connected,
  onConnect,
  onDiscoverNavigate,
  onNavigate,
}: AppSidebarProps) {
  const navigate = useNavigate();
  const currentSearch = useRouterState({
    select: (state) => state.location.search,
  });
  const collectionSearch = validateCollectionSearch(currentSearch);
  const discoverSearch = validateDiscoverSearch(currentSearch);
  const activateNavigation = (
    event: MouseEvent<HTMLAnchorElement>,
    destination: AppSidebarDestination,
    navigateToDestination: (viewTransition?: boolean) => Promise<void>,
    beforeNavigate?: () => boolean,
  ) => {
    if (!isUnmodifiedPrimaryActivation(event)) return;
    if (beforeNavigate?.()) {
      event.preventDefault();
      return;
    }
    if (!onNavigate) return;
    handleCodaLinkActivation(event, (trigger) => {
      void onNavigate({
        destination,
        navigate: navigateToDestination,
        trigger,
      });
    });
  };

  return (
    <Sidebar className="border-r border-sidebar-border px-2 pt-6 pb-3.5 lg:px-3.5">
      <SidebarContent>
        <nav aria-label="Primary navigation">
          <SidebarGroup>
            <SidebarGroupLabel className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">
              Your music
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <SidebarMenuItem>
                  <Link
                    {...navigationLinkProps}
                    onClick={(event) =>
                      activateNavigation(
                        event,
                        "/collection",
                        async (viewTransition = true) => {
                          await navigate({
                            search: collectionSearch,
                            to: "/collection",
                            viewTransition,
                          });
                        },
                      )
                    }
                    search={collectionSearch}
                    to="/collection"
                  >
                    <NavigationLinkContent icon={Library} label="Collection" />
                  </Link>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Link
                    {...navigationLinkProps}
                    onClick={(event) =>
                      activateNavigation(
                        event,
                        "/favorites",
                        async (viewTransition = true) => {
                          await navigate({
                            to: "/favorites",
                            viewTransition,
                          });
                        },
                      )
                    }
                    to="/favorites"
                  >
                    <NavigationLinkContent icon={Heart} label="Favorites" />
                  </Link>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Link
                    {...navigationLinkProps}
                    onClick={(event) =>
                      activateNavigation(
                        event,
                        "/playlists",
                        async (viewTransition = true) => {
                          await navigate({
                            to: "/playlists",
                            viewTransition,
                          });
                        },
                      )
                    }
                    preload={connected ? undefined : false}
                    to="/playlists"
                  >
                    <NavigationLinkContent icon={ListMusic} label="Playlists" />
                  </Link>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Link
                    {...navigationLinkProps}
                    onClick={(event) =>
                      activateNavigation(
                        event,
                        "/recent",
                        async (viewTransition = true) => {
                          await navigate({
                            search: collectionSearch,
                            to: "/recent",
                            viewTransition,
                          });
                        },
                      )
                    }
                    search={collectionSearch}
                    to="/recent"
                  >
                    <NavigationLinkContent
                      icon={Clock3}
                      label="Recently added"
                    />
                  </Link>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Link
                    {...navigationLinkProps}
                    onClick={(event) =>
                      activateNavigation(
                        event,
                        "/discover",
                        async (viewTransition = true) => {
                          await navigate({
                            search: discoverSearch,
                            to: "/discover",
                            viewTransition,
                          });
                        },
                        onDiscoverNavigate,
                      )
                    }
                    search={discoverSearch}
                    to="/discover"
                  >
                    <NavigationLinkContent icon={Compass} label="Discover" />
                  </Link>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">
              Listen
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <SidebarMenuItem>
                  <Link
                    {...navigationLinkProps}
                    onClick={(event) =>
                      activateNavigation(
                        event,
                        "/radio",
                        async (viewTransition = true) => {
                          await navigate({
                            to: "/radio",
                            viewTransition,
                          });
                        },
                      )
                    }
                    to="/radio"
                  >
                    <NavigationLinkContent
                      icon={Radio}
                      label={BANDCAMP_RADIO_PROVIDER}
                    />
                  </Link>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="min-w-0 pt-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Connection settings"
                className="group h-auto w-full min-w-0 justify-start gap-2 rounded-lg px-2 py-2"
                data-sidebar-connection=""
                onClick={onConnect}
                size="compact"
                variant="secondary"
              />
            }
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-md bg-muted",
                connected ? "text-primary" : "text-muted-foreground",
              )}
              data-slot="connection-status-icon"
            >
              {connected ? <Cloud size={16} /> : <CloudOff size={16} />}
            </span>
            <span className="grid min-w-0 flex-1 justify-items-center text-center">
              <strong
                className="w-full truncate text-center text-xs font-semibold text-[#c9cbc5]"
                data-slot="connection-provider"
              >
                Bandcamp
              </strong>
              <span
                className="mt-0.5 hidden w-full truncate text-center text-coda-compact font-medium text-[#727670] lg:block"
                data-slot="connection-state"
              >
                {connected ? "Synced" : "Not connected"}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center text-muted-foreground group-hover:text-foreground"
              data-slot="connection-settings-icon"
            >
              <Settings2 size={17} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Connection settings</TooltipContent>
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  );
}

export { AppSidebar };
