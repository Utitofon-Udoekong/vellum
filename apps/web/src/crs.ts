import { get, set } from "idb-keyval";

const CRS_ORIGIN = import.meta.env.DEV ? "/crs-proxy" : "https://crs.aztec.network";

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || response.status === 206) return response;
      lastError = new Error(`CRS download failed (HTTP ${response.status})`);
    } catch (e) {
      lastError = e;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  const detail =
    lastError instanceof TypeError && lastError.message === "Failed to fetch"
      ? "Could not reach Aztec CRS CDN — check network, disable blockers, restart dev server"
      : lastError instanceof Error
        ? lastError.message
        : "Unknown error";
  throw new Error(`CRS download failed: ${detail}`);
}

function crsUrl(path: string): string {
  return `${CRS_ORIGIN}${path}`;
}

/** Load BN254 CRS slices keyed by circuit size (bb.js browser cache is not size-aware). */
export async function loadCrs(numPoints: number): Promise<{ g1: Uint8Array; g2: Uint8Array }> {
  if (numPoints <= 0) {
    return { g1: new Uint8Array(0), g2: new Uint8Array(0) };
  }

  const g1Key = `vellum:crs:g1:${numPoints}`;
  const g2Key = "vellum:crs:g2";
  const g1Length = numPoints * 64;

  let g1 = await get<Uint8Array>(g1Key);
  if (!g1 || g1.length < g1Length) {
    const g1End = g1Length - 1;
    const response = await fetchWithRetry(crsUrl("/g1.dat"), {
      headers: { Range: `bytes=0-${g1End}` },
      cache: "force-cache",
    });
    g1 = new Uint8Array(await response.arrayBuffer());
    if (g1.length < g1Length) {
      throw new Error(`CRS g1 truncated (${g1.length} bytes, need ${g1Length})`);
    }
    await set(g1Key, g1);
  }

  let g2 = await get<Uint8Array>(g2Key);
  if (!g2 || g2.length !== 128) {
    const response = await fetchWithRetry(crsUrl("/g2.dat"), { cache: "force-cache" });
    g2 = new Uint8Array(await response.arrayBuffer());
    await set(g2Key, g2);
  }

  return { g1: g1.slice(0, g1Length), g2 };
}
