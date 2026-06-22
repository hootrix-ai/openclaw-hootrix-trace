type AttachmentUploaderDeps = {
    getApiKey: () => string | undefined;
    getWorkspaceName: () => string;
    getAttachmentBaseUrl: () => string;
    onWarn: (message: string) => void;
    formatError: (err: unknown) => string;
    attachmentsEnabled?: boolean;
};
export type ScheduledMediaUpload = {
    entityType: "trace" | "span";
    entity: unknown;
    projectName: string;
    reason: string;
    payloads: unknown[];
    traceId?: string;
};
export declare function createAttachmentUploader(deps: AttachmentUploaderDeps): {
    scheduleMediaAttachmentUploads: (params: ScheduledMediaUpload) => void;
    waitForUploads: () => Promise<void>;
    reset: () => void;
};
export {};
