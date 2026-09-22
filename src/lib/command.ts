let chain: Promise<unknown> = Promise.resolve();

/** The adapter takes one command at a time, so page reads queue behind each other. */
export function queued<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}
