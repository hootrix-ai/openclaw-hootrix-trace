import { isPlainObject } from "./payload-sanitizer.js";
/** Matches [media-ref:16hex:filename] including nested media:/[media-ref:...] */
export const MEDIA_REF_PLACEHOLDER_RE = /\[(media-ref:[a-f0-9]{16}:[^\]]+)\]/gi;
export function parseMediaRefPlaceholder(token) {
    const inner = token.replace(/^\[/, "").replace(/\]$/, "").trim();
    const match = /^media-ref:([a-f0-9]{16}):(.+)$/i.exec(inner);
    if (!match?.[1] || !match[2])
        return undefined;
    const fileName = match[2].trim();
    if (!fileName)
        return undefined;
    return {
        placeholder: `[${inner}]`,
        hashPrefix: match[1].toLowerCase(),
        fileName,
    };
}
export function collectMediaRefsFromString(value, target) {
    for (const match of value.matchAll(MEDIA_REF_PLACEHOLDER_RE)) {
        const raw = match[0] ?? "";
        const parsed = parseMediaRefPlaceholder(raw);
        if (parsed) {
            target.add(parsed);
        }
    }
}
export function collectMediaRefsFromUnknown(value, target) {
    if (typeof value === "string") {
        collectMediaRefsFromString(value, target);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectMediaRefsFromUnknown(item, target);
        }
        return;
    }
    if (isPlainObject(value)) {
        for (const child of Object.values(value)) {
            collectMediaRefsFromUnknown(child, target);
        }
    }
}
export function mediaRefDedupeKey(parsed) {
    return `${parsed.hashPrefix}:${parsed.fileName.trim().toLowerCase()}`;
}
