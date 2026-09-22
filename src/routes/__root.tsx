import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SessionProvider, useSession } from "../lib/session";
import { TooltipProvider } from "@/components/ui/tooltip";
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

function RootComponent() {
  return (
    <RootDocument>
      <SessionProvider>
        <TooltipProvider>
          <Nav />
          <main className="p-6">
            <Outlet />
          </main>
        </TooltipProvider>
      </SessionProvider>
    </RootDocument>
  );
}

const navLink = "text-text-2 data-[status=active]:font-semibold data-[status=active]:text-text";

function Nav() {
  const { client } = useSession();
  const connected = client !== undefined;
  return (
    <nav className="flex items-center gap-4 border-b border-border bg-surface px-6 py-3">
      <Link to="/" className={navLink}>
        Connect
      </Link>
      <Link to="/servo" className={navLink}>
        Servo
      </Link>
      <Link to="/table" className={navLink}>
        Control Table
      </Link>
      <Link to="/live" className={navLink}>
        Live
      </Link>
      <span
        className="ml-auto rounded-sm border border-border px-2 py-1 text-xs text-text-3 data-[connected=true]:border-success data-[connected=true]:text-success"
        data-connected={connected}
      >
        {connected ? "connected" : "disconnected"}
      </span>
    </nav>
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
