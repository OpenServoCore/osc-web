import type * as Ident from "@openservocore/client-ident";

let loaded: Promise<typeof Ident> | undefined;

/** The identification module, fetched on the run screen only: it is about 1 MB gzipped. */
export function loadIdent(): Promise<typeof Ident> {
  loaded ??= import("@openservocore/client-ident").then(
    async (m) => {
      await m.default();
      return m;
    },
    (e: unknown) => {
      loaded = undefined;
      throw e;
    },
  );
  return loaded;
}
