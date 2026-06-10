export declare function normalizeLocalMediaPath(candidate: string): string | undefined;
export declare function collectMediaPathsFromString(value: string, target: Set<string>): void;
export declare function collectMediaPathsFromUnknown(value: unknown, target: Set<string>): void;
export declare function guessMimeType(filePath: string): string;
export declare function resolveEntityId(entity: unknown): string | undefined;
