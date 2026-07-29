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
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type AppSidebarView =
  | "library"
  | "favorites"
  | "playlists"
  | "recent"
  | "discover"
  | "radio"

type SidebarDestination = {
  icon: LucideIcon
  label: string
  view: AppSidebarView
}

const MUSIC_DESTINATIONS: readonly SidebarDestination[] = [
  { icon: Library, label: "Collection", view: "library" },
  { icon: Heart, label: "Favorites", view: "favorites" },
  { icon: ListMusic, label: "Playlists", view: "playlists" },
  { icon: Clock3, label: "Recently added", view: "recent" },
  { icon: Compass, label: "Discover", view: "discover" },
]

const LISTEN_DESTINATIONS: readonly SidebarDestination[] = [
  { icon: Radio, label: "Bandcamp Radio", view: "radio" },
]

const navigationButtonClass =
  "relative h-10 w-full justify-start gap-2 rounded-md px-2 text-left text-xs font-medium text-[#a8aaa5] hover:bg-white/4 hover:text-[#e3e1db] lg:gap-3 lg:px-3 lg:text-sm data-active:bg-accent data-active:text-[#f0b09f] data-active:before:absolute data-active:before:-left-3.5 data-active:before:h-5 data-active:before:w-1 data-active:before:bg-primary data-active:before:content-['']"

function AppSidebarMenu({
  destinations,
  onView,
  view,
}: {
  destinations: readonly SidebarDestination[]
  onView: (view: AppSidebarView) => void
  view: AppSidebarView
}) {
  return (
    <SidebarMenu className="gap-1">
      {destinations.map((destination) => {
        const Icon = destination.icon
        return (
          <SidebarMenuItem key={destination.view}>
            <SidebarMenuButton
              className={navigationButtonClass}
              isActive={view === destination.view}
              onClick={() => onView(destination.view)}
            >
              <Icon size={18} />
              <span>{destination.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function AppSidebar({
  view,
  onView,
  connected,
  onConnect,
}: {
  view: AppSidebarView
  onView: (view: AppSidebarView) => void
  connected: boolean
  onConnect: () => void
}) {
  return (
    <Sidebar className="border-r border-sidebar-border px-2 pt-6 pb-3.5 lg:px-3.5">
      <SidebarContent>
        <nav aria-label="Primary navigation">
          <SidebarGroup>
            <SidebarGroupLabel className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">
              Your music
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <AppSidebarMenu
                destinations={MUSIC_DESTINATIONS}
                onView={onView}
                view={view}
              />
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">
              Listen
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <AppSidebarMenu
                destinations={LISTEN_DESTINATIONS}
                onView={onView}
                view={view}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="min-w-0 pt-3">
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                aria-label="Connection settings"
                className="group h-auto w-full min-w-0 justify-start gap-2 rounded-lg px-2 py-2"
                data-sidebar-connection=""
                onClick={onConnect}
                size="compact"
                variant="secondary"
              />
            )}
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
            <span className="flex min-w-0 flex-1 flex-col items-center text-center">
              <strong
                className="max-w-full truncate text-xs font-semibold text-[#c9cbc5]"
                data-slot="connection-provider"
              >
                Bandcamp
              </strong>
              <span
                className="mt-0.5 hidden max-w-full truncate text-coda-compact font-medium text-[#727670] lg:block"
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
  )
}

export { AppSidebar }
