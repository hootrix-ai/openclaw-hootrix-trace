export type SageRefreshOptions = {
    mainApiUrl: string;
    apiKey: string;
    experimentId: string;
    workspaceId?: string;
};
export declare function refreshSageExperiment(opts: SageRefreshOptions): Promise<Record<string, unknown>>;
