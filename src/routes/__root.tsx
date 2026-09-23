import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { BusDebug } from "@/components/bus-debug";
import { UnsupportedBrowser } from "@/components/unsupported-browser";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyTheme } from "@/lib/prefs";
import { SessionProvider } from "@/lib/session";
import { usbSupported } from "@/lib/support";
import { usePanePref, useThemePref } from "@/lib/use-pref";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OpenServoCore" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

const never = () => () => undefined;

function RootComponent() {
  // The prerendered shell assumes support; the client corrects after hydration.
  const supported = useSyncExternalStore(
    never,
    () => usbSupported(navigator, location.search),
    () => true,
  );
  return (
    <RootDocument>
      {supported ? (
        <SessionProvider>
          <TooltipProvider>
            <AppShell />
          </TooltipProvider>
          <div className="fixed inset-0 z-50 hidden items-center justify-center bg-bg max-lg:flex">
            Use a larger window
          </div>
          <BusDebug />
        </SessionProvider>
      ) : (
        <UnsupportedBrowser />
      )}
    </RootDocument>
  );
}

function AppShell() {
  const [theme] = useThemePref();
  const [pane, setPane] = usePanePref();

  // Set after mount: a data-theme written before hydration is dropped when
  // TanStack Start hydrates <html>.
  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);

  return (
    <SidebarProvider
      open={pane === "open"}
      onOpenChange={(open) => {
        setPane(open ? "open" : "collapsed");
      }}
    >
      <AppSidebar />
      <SidebarInset className="px-6 py-4">
        <SidebarTrigger className="-ml-2" />
        <div className="mx-auto w-full max-w-content-w pt-2">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg font-sans text-text">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
