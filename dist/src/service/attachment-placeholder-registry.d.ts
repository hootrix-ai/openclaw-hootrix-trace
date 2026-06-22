export type RegisteredMediaRef = {
    placeholder: string;
    contentHash: string;
    fileName: string;
    fileSize: number;
};
export declare function registerMediaRef(sourceRef: string, meta: RegisteredMediaRef): void;
/** @deprecated Prefer {@link registerMediaRef} with full metadata. */
export declare function registerMediaPlaceholder(sourceRef: string, placeholder: string): void;
export declare function lookupMediaRefByPlaceholder(placeholder: string): RegisteredMediaRef | undefined;
export declare function lookupMediaRefByHashPrefix(hashPrefix: string, fileName: string): RegisteredMediaRef | undefined;
export declare function applyRegisteredMediaPlaceholders(value: string): string;
export declare function normalizeMediaRefPlaceholders(value: string): string;
export declare function resetMediaPlaceholderRegistry(): void;
