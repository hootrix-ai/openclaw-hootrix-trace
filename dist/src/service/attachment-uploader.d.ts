import type { Opik } from "hootrix";
type AttachmentUploaderDeps = {
    getClient: () => Opik | null;
    getAttachmentBaseUrl: () => string;
    onWarn: (message: string) => void;
    formatError: (err: unknown) => string;
    uploadedAttachmentCacheMaxKeys?: number;
    attachmentsEnabled?: boolean;
};
export type ScheduledMediaUpload = {
    entityType: "trace" | "span";
    entity: unknown;
    projectName: string;
    reason: string;
    payloads: unknown[];
};
export declare function createAttachmentUploader(deps: AttachmentUploaderDeps): {
    scheduleMediaAttachmentUploads: (params: ScheduledMediaUpload) => void;
    waitForUploads: () => Promise<void>;
    reset: () => void;
};
export {};
