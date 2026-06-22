import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { ATTACHMENT_UPLOADS_ENABLED } from "./constants.js";
import { lookupMediaRefByHashPrefix, registerMediaRef, } from "./attachment-placeholder-registry.js";
import { sha256FileHex } from "./media-hash.js";
import { collectMediaPathsFromUnknown, guessMimeType, normalizeLocalMediaPath, resolveEntityId, } from "./media.js";
import { collectMediaRefsFromUnknown, mediaRefDedupeKey, } from "./media-ref.js";
function buildCollectorHeaders(apiKey, workspaceName) {
    return {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Comet-Workspace": workspaceName,
        "X-API-Key": apiKey,
        Authorization: `Bearer ${apiKey}`,
    };
}
function rewriteLocalUploadUrl(rawUrl, apiBase) {
    try {
        const target = new URL(rawUrl);
        const base = new URL(apiBase.endsWith("/") ? apiBase : `${apiBase}/`);
        target.protocol = base.protocol;
        target.host = base.host;
        const basePath = base.pathname.replace(/\/$/, "");
        if (basePath && basePath !== "/" && !target.pathname.startsWith(basePath)) {
            target.pathname = `${basePath}${target.pathname}`;
        }
        return target.toString();
    }
    catch {
        return rawUrl;
    }
}
function entityBindingKey(entityType, entityId, contentHash) {
    return `${entityType}:${entityId}:${contentHash}`;
}
function registerPlaceholderMappings(sourceRef, resolvedPath, meta) {
    registerMediaRef(sourceRef, meta);
    if (resolvedPath && resolvedPath !== sourceRef) {
        registerMediaRef(resolvedPath, meta);
        registerMediaRef(`media:${resolvedPath}`, meta);
    }
    if (sourceRef.startsWith("/")) {
        registerMediaRef(`media:${sourceRef}`, meta);
    }
}
function mediaRefMetaFromUpsert(result) {
    return {
        placeholder: result.placeholder,
        contentHash: result.content_hash,
        fileName: result.file_name,
        fileSize: result.file_size,
    };
}
export function createAttachmentUploader(deps) {
    let attachmentQueue = Promise.resolve();
    const attachmentsEnabled = deps.attachmentsEnabled ?? ATTACHMENT_UPLOADS_ENABLED;
    const inFlightBindingKeys = new Set();
    const boundAttachmentKeys = new Set();
    function scheduleAttachmentUpload(job) {
        attachmentQueue = attachmentQueue.then(job).catch((err) => {
            deps.onWarn(`hootrix: attachment upload task failed: ${deps.formatError(err)}`);
        });
    }
    async function callUpsert(params) {
        const apiKey = deps.getApiKey()?.trim();
        const baseUrl = deps.getAttachmentBaseUrl().replace(/\/+$/, "");
        const workspaceName = deps.getWorkspaceName().trim() || "default";
        if (!apiKey || !baseUrl)
            return undefined;
        const upsertRes = await fetch(`${baseUrl}/v1/private/attachment/upsert`, {
            method: "POST",
            headers: buildCollectorHeaders(apiKey, workspaceName),
            body: JSON.stringify({
                content_hash: params.contentHash,
                file_size: params.fileSize,
                file_name: params.fileName,
                mime_type: params.mimeType,
                project_name: params.projectName,
                entity_type: params.entityType,
                entity_id: params.entityId,
                trace_id: params.traceId,
                source_ref: params.sourceRef,
            }),
        });
        if (!upsertRes.ok) {
            throw new Error(`attachment upsert failed status=${upsertRes.status}`);
        }
        return (await upsertRes.json());
    }
    async function upsertAttachment(params) {
        const stats = await stat(params.resolvedPath);
        if (!stats.isFile() || stats.size <= 0)
            return;
        const contentHash = await sha256FileHex(params.resolvedPath);
        const bindingKey = entityBindingKey(params.entityType, params.entityId, contentHash);
        if (boundAttachmentKeys.has(bindingKey) || inFlightBindingKeys.has(bindingKey)) {
            return;
        }
        inFlightBindingKeys.add(bindingKey);
        try {
            const mimeType = guessMimeType(params.resolvedPath);
            const fileName = basename(params.resolvedPath) || "attachment.bin";
            const result = await callUpsert({
                entityType: params.entityType,
                entityId: params.entityId,
                projectName: params.projectName,
                traceId: params.traceId,
                contentHash,
                fileSize: stats.size,
                fileName,
                mimeType,
                sourceRef: params.filePath,
                reason: params.reason,
            });
            if (!result)
                return;
            const meta = mediaRefMetaFromUpsert(result);
            if (result.placeholder) {
                registerPlaceholderMappings(params.filePath, params.resolvedPath, meta);
            }
            if (result.status === "referenced") {
                boundAttachmentKeys.add(bindingKey);
                return;
            }
            const uploadUrl = rewriteLocalUploadUrl(result.upload_url ?? "", deps.getAttachmentBaseUrl());
            if (!uploadUrl) {
                throw new Error("attachment upsert missing upload_url");
            }
            const fileBlob = await openAsBlob(params.resolvedPath, { type: mimeType });
            const uploadResponse = await fetch(uploadUrl, {
                method: "PUT",
                body: fileBlob,
            });
            if (!uploadResponse.ok) {
                throw new Error(`attachment upload failed status=${uploadResponse.status}`);
            }
            boundAttachmentKeys.add(bindingKey);
        }
        catch (err) {
            deps.onWarn(`hootrix: attachment upload failed (${params.reason}, entity=${params.entityType}:${params.entityId}, path=${params.filePath}, resolved=${params.resolvedPath}): ${deps.formatError(err)}`);
        }
        finally {
            inFlightBindingKeys.delete(bindingKey);
        }
    }
    async function bindReferenceAttachment(params) {
        const registered = lookupMediaRefByHashPrefix(params.mediaRef.hashPrefix, params.mediaRef.fileName) ??
            undefined;
        if (!registered?.contentHash) {
            return;
        }
        const bindingKey = entityBindingKey(params.entityType, params.entityId, registered.contentHash);
        if (boundAttachmentKeys.has(bindingKey) || inFlightBindingKeys.has(bindingKey)) {
            return;
        }
        inFlightBindingKeys.add(bindingKey);
        try {
            const fileName = params.mediaRef.fileName.trim() || registered.fileName;
            const fileSize = registered.fileSize > 0 ? registered.fileSize : 1;
            const result = await callUpsert({
                entityType: params.entityType,
                entityId: params.entityId,
                projectName: params.projectName,
                traceId: params.traceId,
                contentHash: registered.contentHash,
                fileSize,
                fileName,
                mimeType: guessMimeType(fileName),
                sourceRef: params.mediaRef.placeholder,
                reason: params.reason,
            });
            if (!result)
                return;
            if (result.placeholder) {
                registerMediaRef(params.mediaRef.placeholder, mediaRefMetaFromUpsert(result));
            }
            if (result.status === "upload_required") {
                deps.onWarn(`hootrix: attachment reference bind skipped (${params.reason}, entity=${params.entityType}:${params.entityId}, ref=${params.mediaRef.placeholder}): primary bytes not ready`);
                return;
            }
            boundAttachmentKeys.add(bindingKey);
        }
        catch (err) {
            deps.onWarn(`hootrix: attachment reference bind failed (${params.reason}, entity=${params.entityType}:${params.entityId}, ref=${params.mediaRef.placeholder}): ${deps.formatError(err)}`);
        }
        finally {
            inFlightBindingKeys.delete(bindingKey);
        }
    }
    async function uploadFileAttachment(params) {
        if (!attachmentsEnabled)
            return;
        const resolvedPath = normalizeLocalMediaPath(params.filePath);
        if (!resolvedPath)
            return;
        await upsertAttachment({
            ...params,
            resolvedPath,
        });
    }
    function scheduleMediaAttachmentUploads(params) {
        if (!attachmentsEnabled)
            return;
        const entityId = resolveEntityId(params.entity);
        if (!entityId)
            return;
        const mediaPaths = new Set();
        const mediaRefs = new Set();
        for (const payload of params.payloads) {
            collectMediaPathsFromUnknown(payload, mediaPaths);
            collectMediaRefsFromUnknown(payload, mediaRefs);
        }
        for (const filePath of mediaPaths) {
            scheduleAttachmentUpload(() => uploadFileAttachment({
                entityType: params.entityType,
                entityId,
                projectName: params.projectName,
                traceId: params.traceId,
                filePath,
                reason: params.reason,
            }));
        }
        const seenRefs = new Set();
        for (const mediaRef of mediaRefs) {
            const dedupe = mediaRefDedupeKey(mediaRef);
            if (seenRefs.has(dedupe))
                continue;
            seenRefs.add(dedupe);
            scheduleAttachmentUpload(() => bindReferenceAttachment({
                entityType: params.entityType,
                entityId,
                projectName: params.projectName,
                traceId: params.traceId,
                mediaRef,
                reason: `${params.reason} (media-ref)`,
            }));
        }
    }
    async function waitForUploads() {
        await attachmentQueue.catch(() => undefined);
    }
    function reset() {
        inFlightBindingKeys.clear();
        boundAttachmentKeys.clear();
    }
    return {
        scheduleMediaAttachmentUploads,
        waitForUploads,
        reset,
    };
}
