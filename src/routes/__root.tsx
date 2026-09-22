import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SessionProvider, useSession } from "../lib/session";
import baseCss from "../styles/base.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OpenServoCore" },
    ],
    links: [{ rel: "stylesheet", href: baseCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <SessionProvider>
        <Nav />
        <main>
          <Outlet />
        </main>
      </SessionProvider>
    </RootDocument>
  );
}

function Nav() {
  const { client } = useSession();
  const connected = client !== undefined;
  return (
    <nav className="nav">
      <Link to="/">Connect</Link>
      <Link to="/servo">Servo</Link>
      <Link to="/table">Control Table</Link>
      <Link to="/live">Live</Link>
      <span className="badge" data-connected={connected}>
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
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
