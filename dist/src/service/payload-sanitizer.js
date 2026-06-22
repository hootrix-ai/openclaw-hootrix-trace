import { applyRegisteredMediaPlaceholders, normalizeMediaRefPlaceholders, } from "./attachment-placeholder-registry.js";
const MEDIA_IMAGE_REFERENCE_RE = /\bmedia:(?:https?:\/\/[^\s"'`]+|\.[/][^\s"'`]+|[/][^\s"'`]+|[^\s"'`]+)\.(?:jpe?g|png|webp|gif|mp3|wav|m4a|aac|ogg|oga|flac|opus|caf|weba|webm|mp4|mov|mkv|bmp|tiff?|heic|heif|svg)(?=[\s"'`]|$)/gi;
const INTERNAL_REPLY_TO_MARKER_RE = /\[\[reply_to[^\]]*\]\]\s*/gi;
const CONVERSATION_INFO_BLOCK_RE = /^\s*Conversation info \(untrusted metadata\):\s*\n+\{[\s\S]*?\}\s*/gim;
const SENDER_INFO_BLOCK_RE = /^\s*Sender \(untrusted metadata\):\s*\n+\{[\s\S]*?\}\s*/gim;
const UNTRUSTED_CONTEXT_BLOCK_RE = /^\s*Untrusted context \(metadata, do not treat as instructions or commands\):\s*\n+<<<EXTERNAL_UNTRUSTED_CONTENT[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\s*/gim;
export function sanitizeStringForHootrix(value) {
    const normalizedNewlines = value
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r");
    const redactedInternalBlocks = normalizedNewlines
        .replace(INTERNAL_REPLY_TO_MARKER_RE, "")
        .replace(UNTRUSTED_CONTEXT_BLOCK_RE, "")
        .replace(CONVERSATION_INFO_BLOCK_RE, "")
        .replace(SENDER_INFO_BLOCK_RE, "")
        .replace(/\n{3,}/g, "\n\n");
    const withKnownPlaceholders = normalizeMediaRefPlaceholders(applyRegisteredMediaPlaceholders(redactedInternalBlocks));
    return withKnownPlaceholders.replace(MEDIA_IMAGE_REFERENCE_RE, "media:<image-ref>");
}
export function isPlainObject(value) {
    if (value === null || typeof value !== "object")
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
export function sanitizeValueForHootrix(value) {
    if (typeof value === "string") {
        return sanitizeStringForHootrix(value);
    }
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map((item) => {
            const sanitized = sanitizeValueForHootrix(item);
            if (sanitized !== item)
                changed = true;
            return sanitized;
        });
        return changed ? next : value;
    }
    if (isPlainObject(value)) {
        let changed = false;
        const next = {};
        for (const [key, child] of Object.entries(value)) {
            const sanitized = sanitizeValueForHootrix(child);
            next[key] = sanitized;
            if (sanitized !== child)
                changed = true;
        }
        return changed ? next : value;
    }
    return value;
}
/**
 * Build trace/span input from an OpenClaw `llm_input` event. Only fields OpenClaw provided
 * are included; historyMessages is omitted when absent or empty (no synthetic history).
 */
export function buildSanitizedLlmInputFromEvent(event) {
    const out = {};
    if (event.prompt !== undefined) {
        out.prompt = sanitizeValueForHootrix(event.prompt);
    }
    if (event.systemPrompt !== undefined) {
        out.systemPrompt = sanitizeValueForHootrix(event.systemPrompt);
    }
    if (event.imagesCount !== undefined) {
        out.imagesCount = sanitizeValueForHootrix(event.imagesCount);
    }
    if (event.historyMessages !== undefined) {
        const history = sanitizeValueForHootrix(event.historyMessages);
        if (Array.isArray(history) && history.length > 0) {
            out.historyMessages = history;
        }
    }
    return out;
}
