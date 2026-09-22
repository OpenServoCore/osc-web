import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function UnsupportedBrowser() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>This browser cannot talk to USB</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            osc-web uses WebUSB, which only Chromium browsers provide. Use the latest Chrome or Edge
            on a computer.
          </p>
          <Button asChild variant="link" className="justify-start px-0">
            <a href="https://www.google.com/chrome/">Get Chrome</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
