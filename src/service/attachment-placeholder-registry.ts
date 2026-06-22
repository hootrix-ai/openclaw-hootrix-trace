export type RegisteredMediaRef = {
  placeholder: string;
  contentHash: string;
  fileName: string;
  fileSize: number;
};

const mediaRefBySource = new Map<string, RegisteredMediaRef>();
const mediaRefByPlaceholder = new Map<string, RegisteredMediaRef>();

function normalizeSourceKey(sourceRef: string): string {
  return sourceRef.trim();
}

function indexMediaRef(sourceRef: string, meta: RegisteredMediaRef): void {
  const key = normalizeSourceKey(sourceRef);
  if (!key) return;
  mediaRefBySource.set(key, meta);
  mediaRefByPlaceholder.set(meta.placeholder, meta);
  const parsedPrefix = meta.contentHash.slice(0, 16).toLowerCase();
  mediaRefByPlaceholder.set(`${parsedPrefix}:${meta.fileName.trim().toLowerCase()}`, meta);
  if (key.startsWith("/") && !key.startsWith("media:")) {
    mediaRefBySource.set(`media:${key}`, meta);
  }
}

export function registerMediaRef(sourceRef: string, meta: RegisteredMediaRef): void {
  const placeholder = meta.placeholder.trim();
  const contentHash = meta.contentHash.trim().toLowerCase();
  if (!placeholder || !contentHash) return;
  indexMediaRef(sourceRef, { ...meta, placeholder, contentHash });
}

/** @deprecated Prefer {@link registerMediaRef} with full metadata. */
export function registerMediaPlaceholder(sourceRef: string, placeholder: string): void {
  registerMediaRef(sourceRef, {
    placeholder,
    contentHash: "",
    fileName: "",
    fileSize: 0,
  });
}

export function lookupMediaRefByPlaceholder(placeholder: string): RegisteredMediaRef | undefined {
  const key = placeholder.trim();
  if (!key) return undefined;
  return mediaRefByPlaceholder.get(key);
}

export function lookupMediaRefByHashPrefix(hashPrefix: string, fileName: string): RegisteredMediaRef | undefined {
  const prefix = hashPrefix.trim().toLowerCase();
  const name = fileName.trim().toLowerCase();
  if (!prefix || !name) return undefined;
  return mediaRefByPlaceholder.get(`${prefix}:${name}`);
}

export function applyRegisteredMediaPlaceholders(value: string): string {
  if (!value || mediaRefBySource.size === 0) {
    return value;
  }
  let out = value;
  const entries = [...mediaRefBySource.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [sourceRef, meta] of entries) {
    if (!out.includes(sourceRef)) continue;
    out = out.split(sourceRef).join(meta.placeholder);
    const mediaPrefixed = sourceRef.startsWith("media:") ? sourceRef : `media:${sourceRef}`;
    if (mediaPrefixed !== sourceRef && out.includes(mediaPrefixed)) {
      out = out.split(mediaPrefixed).join(meta.placeholder);
    }
  }
  return normalizeMediaRefPlaceholders(out);
}

export function normalizeMediaRefPlaceholders(value: string): string {
  if (!value) return value;
  return value
    .replace(/media:\/\[(media-ref:[^\]]+)\]/gi, "[$1]")
    .replace(/media:\[(media-ref:[^\]]+)\]/gi, "[$1]");
}

export function resetMediaPlaceholderRegistry(): void {
  mediaRefBySource.clear();
  mediaRefByPlaceholder.clear();
}
