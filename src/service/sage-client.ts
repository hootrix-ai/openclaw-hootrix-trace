export type SageRefreshOptions = {
  mainApiUrl: string;
  apiKey: string;
  experimentId: string;
  workspaceId?: string;
};

export async function refreshSageExperiment(opts: SageRefreshOptions): Promise<Record<string, unknown>> {
  const base = opts.mainApiUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (opts.workspaceId) params.set("workspace_id", opts.workspaceId);
  const qs = params.toString();
  const url = `${base}/api/v1/sage/experiments/${encodeURIComponent(opts.experimentId)}/refresh${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Api-Key": opts.apiKey,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sage experiment refresh failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as Record<string, unknown>;
}
