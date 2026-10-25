/**
 * T029 — complete-page pagination (research R6; frozen port wording: "Pagination until
 * exhausted … Yields complete pages; failure after retries surfaces with no partial-inventory
 * consumption"). A page is fetched WHOLE before any of its rows is yielded; the cursor chain
 * is strictly sequential (`after = endCursor` of the previous page) until `hasNextPage` is
 * false; a failure — after the request site's retry budget — throws from the iterator with the
 * failed page entirely unconsumed. Teams proceed in configured `teamKeys` order (per-team
 * isolation); request fan-out stays bounded by the per-client semaphore at the request site.
 */
import { TrackerConfigError } from "./errors.js";

export interface PageSlice<T> {
  readonly rows: readonly T[];
  readonly endCursor: string | null;
  readonly hasNextPage: boolean;
}

export type PageFetcher<T> = (after: string | null) => Promise<PageSlice<T>>;

export async function* paginate<T>(fetchPage: PageFetcher<T>): AsyncIterableIterator<T> {
  let after: string | null = null;
  for (;;) {
    const page = await fetchPage(after);
    yield* page.rows;
    if (!page.hasNextPage) return;
    if (page.endCursor === null) {
      throw new TrackerConfigError("connection reported hasNextPage without endCursor — pagination cannot continue");
    }
    after = page.endCursor;
  }
}
