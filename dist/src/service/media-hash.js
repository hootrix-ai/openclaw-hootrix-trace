import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
export async function sha256FileHex(filePath) {
    const hash = createHash("sha256");
    await pipeline(createReadStream(filePath), hash);
    return hash.digest("hex");
}
export function mediaRefPlaceholder(contentHash, fileName) {
    const prefix = contentHash.slice(0, 16);
    const safeName = basename(fileName).replace(/[\[\]]/g, "_") || "attachment.bin";
    return `[media-ref:${prefix}:${safeName}]`;
}
