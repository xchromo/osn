import { createGraphClient, createOrgClient } from "@osn/client";

import { OSN_ISSUER_URL } from "./auth";

export const graphClient = createGraphClient({ issuerUrl: OSN_ISSUER_URL });
export const orgClient = createOrgClient({ issuerUrl: OSN_ISSUER_URL });

const base = OSN_ISSUER_URL.replace(/\/$/, "");

export async function fetchRecommendations(
  token: string,
  limit = 10,
): Promise<{
  suggestions: {
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    mutualCount: number;
  }[];
}> {
  const res = await fetch(`${base}/recommendations/connections?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<{
    suggestions: {
      handle: string;
      displayName: string | null;
      avatarUrl: string | null;
      mutualCount: number;
    }[];
  }>;
}
