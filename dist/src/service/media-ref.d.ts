/** Matches [media-ref:16hex:filename] including nested media:/[media-ref:...] */
export declare const MEDIA_REF_PLACEHOLDER_RE: RegExp;
export type ParsedMediaRef = {
    placeholder: string;
    hashPrefix: string;
    fileName: string;
};
export declare function parseMediaRefPlaceholder(token: string): ParsedMediaRef | undefined;
export declare function collectMediaRefsFromString(value: string, target: Set<ParsedMediaRef>): void;
export declare function collectMediaRefsFromUnknown(value: unknown, target: Set<ParsedMediaRef>): void;
export declare function mediaRefDedupeKey(parsed: ParsedMediaRef): string;
