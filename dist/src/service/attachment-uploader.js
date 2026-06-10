import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { ATTACHMENT_UPLOADS_ENABLED, ATTACHMENT_UPLOAD_PART_SIZE_BYTES, DEFAULT_UPLOADED_ATTACHMENT_CACHE_MAX_KEYS, LOCAL_ATTACHMENT_UPLOAD_MAGIC_ID, } from "./constants.js";
import { collectMediaPathsFromUnknown, guessMimeType, resolveEntityId } from "./media.js";
export function createAttachmentUploader(deps) {
    let attachmentQueue = Promise.resolve();
    const attachmentsEnabled = deps.attachmentsEnabled ?? ATTACHMENT_UPLOADS_ENABLED;
    const inFlightAttachmentKeys = new Set();
    const uploadedAttachmentKeys = new Map();
    const uploadedAttachmentCacheMaxKeys = Math.max(1, Math.floor(deps.uploadedAttachmentCacheMaxKeys ?? DEFAULT_UPLOADED_ATTACHMENT_CACHE_MAX_KEYS));
    function markUploadedAttachmentKey(key) {
        uploadedAttachmentKeys.delete(key);
        uploadedAttachmentKeys.set(key, Date.now());
        while (uploadedAttachmentKeys.size > uploadedAttachmentCacheMaxKeys) {
            const oldestKey = uploadedAttachmentKeys.keys().next().value;
            if (!oldestKey)
                break;
            uploadedAttachmentKeys.delete(oldestKey);
        }
    }
    function scheduleAttachmentUpload(job) {
        attachmentQueue = attachmentQueue.then(job).catch((err) => {
            deps.onWarn(`opik: attachment upload task failed: ${deps.formatError(err)}`);
        });
    }
    async function uploadFileAttachment(params) {
        if (!attachmentsEnabled)
            return;
        const baseClient = deps.getClient();
        if (!baseClient)
            return;
        const existingKey = `${params.entityType}:${params.entityId}:${params.filePath}`;
        if (uploadedAttachmentKeys.has(existingKey) || inFlightAttachmentKeys.has(existingKey))
            return;
        const client = baseClient;
        const attachmentsApi = client.api?.attachments;
        if (!attachmentsApi)
            return;
        inFlightAttachmentKeys.add(existingKey);
        try {
            const stats = await stat(params.filePath);
            if (!stats.isFile() || stats.size <= 0)
                return;
            const totalSize = stats.size;
            const mimeType = guessMimeType(params.filePath);
            const fileName = basename(params.filePath) || "attachment.bin";
            const partCount = Math.max(1, Math.ceil(totalSize / ATTACHMENT_UPLOAD_PART_SIZE_BYTES));
            const pathBase64 = Buffer.from(deps.getAttachmentBaseUrl(), "utf8").toString("base64url");
            const fileBlob = await openAsBlob(params.filePath, { type: mimeType });
            const started = await attachmentsApi.startMultiPartUpload({
                fileName,
                numOfFileParts: partCount,
                mimeType,
                projectName: params.projectName,
                entityType: params.entityType,
                entityId: params.entityId,
                path: pathBase64,
            });
            const urls = started.preSignUrls ?? [];
            if (urls.length === 0)
                return;
            if (started.uploadId === LOCAL_ATTACHMENT_UPLOAD_MAGIC_ID) {
                const localResponse = await fetch(urls[0], {
                    method: "PUT",
                    body: fileBlob,
                });
                if (!localResponse.ok) {
                    throw new Error(`local attachment upload failed status=${localResponse.status}`);
                }
                markUploadedAttachmentKey(existingKey);
                return;
            }
            if (urls.length < partCount) {
                throw new Error(`insufficient pre-signed URLs (got ${urls.length}, expected ${partCount})`);
            }
            const uploadedParts = [];
            for (let partNumber = 1; partNumber <= partCount; partNumber++) {
                const start = (partNumber - 1) * ATTACHMENT_UPLOAD_PART_SIZE_BYTES;
                const end = Math.min(start + ATTACHMENT_UPLOAD_PART_SIZE_BYTES, totalSize);
                const chunk = fileBlob.slice(start, end, mimeType);
                const url = urls[partNumber - 1];
                const partResponse = await fetch(url, {
                    method: "PUT",
                    body: chunk,
                });
                if (!partResponse.ok) {
                    throw new Error(`attachment part upload failed status=${partResponse.status} part=${partNumber}/${partCount}`);
                }
                const eTag = partResponse.headers.get("etag") ??
                    partResponse.headers.get("ETag") ??
                    "";
                uploadedParts.push({ eTag, partNumber });
            }
            await attachmentsApi.completeMultiPartUpload({
                fileName,
                projectName: params.projectName,
                entityType: params.entityType,
                entityId: params.entityId,
                fileSize: totalSize,
                mimeType,
                uploadId: started.uploadId,
                uploadedFileParts: uploadedParts,
            });
            markUploadedAttachmentKey(existingKey);
        }
        catch (err) {
            deps.onWarn(`opik: attachment upload failed (${params.reason}, entity=${params.entityType}:${params.entityId}, path=${params.filePath}): ${deps.formatError(err)}`);
        }
        finally {
            inFlightAttachmentKeys.delete(existingKey);
        }
    }
    function scheduleMediaAttachmentUploads(params) {
        if (!attachmentsEnabled)
            return;
        const entityId = resolveEntityId(params.entity);
        if (!entityId)
            return;
        const mediaPaths = new Set();
        for (const payload of params.payloads) {
            collectMediaPathsFromUnknown(payload, mediaPaths);
        }
        if (mediaPaths.size === 0)
            return;
        for (const filePath of mediaPaths) {
            scheduleAttachmentUpload(() => uploadFileAttachment({
                entityType: params.entityType,
                entityId,
                projectName: params.projectName,
                filePath,
                reason: params.reason,
            }));
        }
    }
    async function waitForUploads() {
        await attachmentQueue.catch(() => undefined);
    }
    function reset() {
        inFlightAttachmentKeys.clear();
        uploadedAttachmentKeys.clear();
    }
    return {
        scheduleMediaAttachmentUploads,
        waitForUploads,
        reset,
    };
}
