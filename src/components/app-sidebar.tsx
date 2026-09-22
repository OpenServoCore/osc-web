import type { BaudRate } from "@openservocore/client";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ChevronRight,
  CircleAlert,
  Cog,
  LayoutDashboard,
  Layers,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plug,
  RefreshCw,
  Settings2,
  Sun,
  Table,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBaud } from "@/lib/format";
import { isTheme } from "@/lib/prefs";
import { useSession, type Servo, type Status } from "@/lib/session";
import { useThemePref } from "@/lib/use-pref";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true, gated: false },
  { to: "/servo", label: "Servo", icon: Wrench, exact: false, gated: true },
  { to: "/table", label: "Control table", icon: Table, exact: false, gated: true },
  { to: "/live", label: "Live", icon: Activity, exact: false, gated: true },
] as const;

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Cog className="size-5 shrink-0" />
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
            OpenServoCore
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <NavItems />
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarMenu>
            <ServosItem />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <ConnectionItem />
          <SettingsItem />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavItems() {
  const { status, selected } = useSession();
  const gate =
    status !== "ready"
      ? "Connect the adapter first"
      : selected === undefined
        ? "Pick a servo"
        : undefined;
  return nav.map(({ to, label, icon: Icon, exact, gated }) => {
    const reason = gated ? gate : undefined;
    const item = (
      <SidebarMenuButton asChild tooltip={reason === undefined ? label : undefined}>
        <Link
          to={to}
          disabled={reason !== undefined}
          activeOptions={{ exact }}
          activeProps={{ "data-active": true }}
        >
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    );
    return (
      <SidebarMenuItem key={to}>
        {reason === undefined ? (
          item
        ) : (
          // The disabled button drops pointer events, so the wrapper hosts the tooltip.
          <Tooltip>
            <TooltipTrigger asChild>
              <div>{item}</div>
            </TooltipTrigger>
            <TooltipContent side="right">{reason}</TooltipContent>
          </Tooltip>
        )}
      </SidebarMenuItem>
    );
  });
}

function servosEmptyText(status: Status): string {
  switch (status) {
    case "connecting":
    case "scanning":
      return "Looking for servos ..";
    case "ready":
      return "No servos found";
    case "disconnected":
    case "error":
      return "Connect the adapter to see servos";
  }
}

function ServosItem() {
  const { status, servos, selected, select, discover } = useSession();
  const navigate = useNavigate();
  function open(servo: Servo) {
    void select(servo.id);
    void navigate({ to: "/servo" });
  }
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip="Servos">
            <Layers />
            <span>Servos</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {(status !== "ready" || servos.length === 0) && (
              <SidebarMenuSubItem className="px-2 text-sm text-text-3">
                {servosEmptyText(status)}
              </SidebarMenuSubItem>
            )}
            {status === "ready" &&
              servos.map((servo) => (
                <SidebarMenuSubItem key={servo.uid}>
                  <SidebarMenuSubButton asChild isActive={selected === servo.id}>
                    <button
                      type="button"
                      className="w-full"
                      onClick={() => {
                        open(servo);
                      }}
                    >
                      <Cog />
                      <span>ID {servo.id}</span>
                      <span className="ml-auto flex shrink-0 gap-1">
                        {servo.fault !== undefined && (
                          <Badge variant="destructive">
                            <CircleAlert />
                            fault
                          </Badge>
                        )}
                        {servo.unsaved === true && (
                          <Badge className="bg-warning-soft text-warning">
                            <Pencil />
                            unsaved
                          </Badge>
                        )}
                        {servo.calibrated === false && (
                          <Badge variant="outline" className="border-dashed text-text-3">
                            raw
                          </Badge>
                        )}
                      </span>
                    </button>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild>
                <button
                  type="button"
                  className="w-full"
                  disabled={status !== "ready"}
                  onClick={() => void discover()}
                >
                  <RefreshCw />
                  <span>Rescan</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function ConnectionItem() {
  const { status, baud } = useSession();
  const text = connectionText(status, baud);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={text}>
        <Plug />
        <span>{text}</span>
        <span
          className="ml-auto size-2 shrink-0 rounded-full bg-text-3 data-[connected=true]:bg-success"
          data-connected={status === "ready"}
        />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function connectionText(status: Status, baud: BaudRate | undefined): string {
  switch (status) {
    case "disconnected":
    case "error":
      return "Not connected";
    case "connecting":
      return "Connecting ..";
    case "scanning":
      return "Looking for servos ..";
    case "ready":
      return baud === undefined ? "Connected" : `Connected at ${formatBaud(baud)}`;
  }
}

function SettingsItem() {
  const [theme, setTheme] = useThemePref();
  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton tooltip="Settings">
            <Settings2 />
            <span>Settings</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end">
          <Tabs
            value={theme}
            onValueChange={(value) => {
              if (isTheme(value)) setTheme(value);
            }}
          >
            <span className="font-medium">Theme</span>
            <TabsList className="w-full">
              <TabsTrigger value="light">
                <Sun />
                Light
              </TabsTrigger>
              <TabsTrigger value="dark">
                <Moon />
                Dark
              </TabsTrigger>
              <TabsTrigger value="system">
                <Monitor />
                System
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="link" size="sm" className="justify-start px-0">
            <Palette />
            Design tokens
          </Button>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
