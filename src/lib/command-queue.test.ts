import { expect, test } from "vitest";
import { CommandQueue } from "./command-queue";

interface Fake {
  log: string[];
  busy: boolean;
  command(name: string, gate?: Promise<void>): Promise<string>;
}

function fake(): Fake {
  return {
    log: [],
    busy: false,
    async command(name, gate) {
      if (this.busy) throw new Error("busy");
      this.busy = true;
      this.log.push(`start ${name}`);
      await gate;
      this.log.push(`end ${name}`);
      this.busy = false;
      return name;
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("jobs run one at a time in submission order", async () => {
  const client = fake();
  const queue = new CommandQueue(() => client);
  const gate = deferred();
  const a = queue.run((c) => c.command("a", gate.promise));
  const b = queue.run((c) => c.command("b"));
  const c = queue.run((c) => c.command("c"));
  await Promise.resolve();
  expect(client.log).toEqual(["start a"]);
  gate.resolve();
  expect(await Promise.all([a, b, c])).toEqual(["a", "b", "c"]);
  expect(client.log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("a rejected job does not block the next", async () => {
  const client = fake();
  const queue = new CommandQueue(() => client);
  const failed = queue.run(() => Promise.reject(new Error("range")));
  const next = queue.run((c) => c.command("next"));
  await expect(failed).rejects.toThrow("range");
  expect(await next).toBe("next");
});

test("a job sees the client open when its turn comes, not when it was queued", async () => {
  let client: Fake | undefined = fake();
  const queue = new CommandQueue(() => client);
  const gate = deferred();
  const first = queue.run((c) => c.command("first", gate.promise));
  const second = queue.run((c) => c.command("second"));
  await Promise.resolve();
  expect(client.log).toEqual(["start first"]);
  client = undefined;
  gate.resolve();
  expect(await first).toBe("first");
  await expect(second).rejects.toThrow("not connected");
});

test("run rejects while nothing is open", async () => {
  const queue = new CommandQueue<Fake>(() => undefined);
  await expect(queue.run((c) => c.command("x"))).rejects.toThrow("not connected");
});
