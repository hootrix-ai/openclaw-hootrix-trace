const mediaRefBySource = new Map();
const mediaRefByPlaceholder = new Map();
function normalizeSourceKey(sourceRef) {
    return sourceRef.trim();
}
function indexMediaRef(sourceRef, meta) {
    const key = normalizeSourceKey(sourceRef);
    if (!key)
        return;
    mediaRefBySource.set(key, meta);
    mediaRefByPlaceholder.set(meta.placeholder, meta);
    const parsedPrefix = meta.contentHash.slice(0, 16).toLowerCase();
    mediaRefByPlaceholder.set(`${parsedPrefix}:${meta.fileName.trim().toLowerCase()}`, meta);
    if (key.startsWith("/") && !key.startsWith("media:")) {
        mediaRefBySource.set(`media:${key}`, meta);
    }
}
export function registerMediaRef(sourceRef, meta) {
    const placeholder = meta.placeholder.trim();
    const contentHash = meta.contentHash.trim().toLowerCase();
    if (!placeholder || !contentHash)
        return;
    indexMediaRef(sourceRef, { ...meta, placeholder, contentHash });
}
/** @deprecated Prefer {@link registerMediaRef} with full metadata. */
export function registerMediaPlaceholder(sourceRef, placeholder) {
    registerMediaRef(sourceRef, {
        placeholder,
        contentHash: "",
        fileName: "",
        fileSize: 0,
    });
}
export function lookupMediaRefByPlaceholder(placeholder) {
    const key = placeholder.trim();
    if (!key)
        return undefined;
    return mediaRefByPlaceholder.get(key);
}
export function lookupMediaRefByHashPrefix(hashPrefix, fileName) {
    const prefix = hashPrefix.trim().toLowerCase();
    const name = fileName.trim().toLowerCase();
    if (!prefix || !name)
        return undefined;
    return mediaRefByPlaceholder.get(`${prefix}:${name}`);
}
export function applyRegisteredMediaPlaceholders(value) {
    if (!value || mediaRefBySource.size === 0) {
        return value;
    }
    let out = value;
    const entries = [...mediaRefBySource.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [sourceRef, meta] of entries) {
        if (!out.includes(sourceRef))
            continue;
        out = out.split(sourceRef).join(meta.placeholder);
        const mediaPrefixed = sourceRef.startsWith("media:") ? sourceRef : `media:${sourceRef}`;
        if (mediaPrefixed !== sourceRef && out.includes(mediaPrefixed)) {
            out = out.split(mediaPrefixed).join(meta.placeholder);
        }
    }
    return normalizeMediaRefPlaceholders(out);
}
export function normalizeMediaRefPlaceholders(value) {
    if (!value)
        return value;
    return value
        .replace(/media:\/\[(media-ref:[^\]]+)\]/gi, "[$1]")
        .replace(/media:\[(media-ref:[^\]]+)\]/gi, "[$1]");
}
export function resetMediaPlaceholderRegistry() {
    mediaRefBySource.clear();
    mediaRefByPlaceholder.clear();
}
