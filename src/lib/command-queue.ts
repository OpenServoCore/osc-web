/**
 * One promise chain for every adapter command. The adapter takes one command
 * at a time and the wasm client rejects an overlapping call as "busy", so
 * every caller queues here and each job sees the state the previous one left.
 */
export class CommandQueue<C> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly client: () => C | undefined) {}

  /** Runs `fn` after every queued job; rejects if no client is open when its turn comes. */
  run<T>(fn: (client: C) => Promise<T>): Promise<T> {
    const job = this.chain.then(() => {
      const client = this.client();
      if (client === undefined) throw new Error("not connected");
      return fn(client);
    });
    this.chain = job.catch(() => undefined);
    return job;
  }
}
