import {
  Clock3,
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

      <SidebarFooter className="relative flex min-w-0 items-center justify-center border-t border-border px-8 py-3">
        <div className="flex min-w-0 flex-col items-center text-center">
          <strong className="truncate text-xs font-semibold text-[#c9cbc5]">
            {connected ? "Bandcamp synced" : "Not connected"}
          </strong>
          <span className="mt-0.5 hidden truncate text-xs text-[#727670] lg:block">
            {connected
              ? "Official Subsonic beta"
              : "Connect to hear your music"}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                aria-label="Connection settings"
                className="absolute right-0"
                onClick={onConnect}
                size="icon"
                variant="ghost"
              />
            )}
          >
            <Settings2 size={17} />
          </TooltipTrigger>
          <TooltipContent side="right">Connection settings</TooltipContent>
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  )
}

export { AppSidebar }
