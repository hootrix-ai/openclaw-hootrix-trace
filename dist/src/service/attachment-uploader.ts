import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { ATTACHMENT_UPLOADS_ENABLED } from "./constants.js";
import {
  lookupMediaRefByHashPrefix,
  registerMediaRef,
  type RegisteredMediaRef,
} from "./attachment-placeholder-registry.js";
import { sha256FileHex } from "./media-hash.js";
import {
  collectMediaPathsFromUnknown,
  guessMimeType,
  normalizeLocalMediaPath,
  resolveEntityId,
} from "./media.js";
import {
  collectMediaRefsFromUnknown,
  mediaRefDedupeKey,
  type ParsedMediaRef,
} from "./media-ref.js";

type AttachmentUpsertResponse = {
  status: "referenced" | "upload_required";
  attachment_id: string;
  canonical_attachment_id?: string;
  file_name: string;
  file_size: number;
  mime_type?: string;
  content_hash: string;
  upload_kind: "primary" | "reference";
  placeholder: string;
  upload_token?: string;
  upload_url?: string;
};

type AttachmentUploaderDeps = {
  getApiKey: () => string | undefined;
  getWorkspaceName: () => string;
  getAttachmentBaseUrl: () => string;
  onWarn: (message: string) => void;
  formatError: (err: unknown) => string;
  attachmentsEnabled?: boolean;
};

export type ScheduledMediaUpload = {
  entityType: "trace" | "span";
  entity: unknown;
  projectName: string;
  reason: string;
  payloads: unknown[];
  traceId?: string;
};

function buildCollectorHeaders(apiKey: string, workspaceName: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Comet-Workspace": workspaceName,
    "X-API-Key": apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

function rewriteLocalUploadUrl(rawUrl: string, apiBase: string): string {
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
  } catch {
    return rawUrl;
  }
}

function entityBindingKey(entityType: string, entityId: string, contentHash: string): string {
  return `${entityType}:${entityId}:${contentHash}`;
}

function registerPlaceholderMappings(
  sourceRef: string,
  resolvedPath: string | undefined,
  meta: RegisteredMediaRef,
): void {
  registerMediaRef(sourceRef, meta);
  if (resolvedPath && resolvedPath !== sourceRef) {
    registerMediaRef(resolvedPath, meta);
    registerMediaRef(`media:${resolvedPath}`, meta);
  }
  if (sourceRef.startsWith("/")) {
    registerMediaRef(`media:${sourceRef}`, meta);
  }
}

function mediaRefMetaFromUpsert(result: AttachmentUpsertResponse): RegisteredMediaRef {
  return {
    placeholder: result.placeholder,
    contentHash: result.content_hash,
    fileName: result.file_name,
    fileSize: result.file_size,
  };
}

export function createAttachmentUploader(deps: AttachmentUploaderDeps) {
  let attachmentQueue: Promise<void> = Promise.resolve();
  const attachmentsEnabled = deps.attachmentsEnabled ?? ATTACHMENT_UPLOADS_ENABLED;
  const inFlightBindingKeys = new Set<string>();
  const boundAttachmentKeys = new Set<string>();

  function scheduleAttachmentUpload(job: () => Promise<void>): void {
    attachmentQueue = attachmentQueue.then(job).catch((err: unknown) => {
      deps.onWarn(`hootrix: attachment upload task failed: ${deps.formatError(err)}`);
    });
  }

  async function callUpsert(params: {
    entityType: "trace" | "span";
    entityId: string;
    projectName: string;
    traceId?: string;
    contentHash: string;
    fileSize: number;
    fileName: string;
    mimeType: string;
    sourceRef: string;
    reason: string;
  }): Promise<AttachmentUpsertResponse | undefined> {
    const apiKey = deps.getApiKey()?.trim();
    const baseUrl = deps.getAttachmentBaseUrl().replace(/\/+$/, "");
    const workspaceName = deps.getWorkspaceName().trim() || "default";
    if (!apiKey || !baseUrl) return undefined;

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
    return (await upsertRes.json()) as AttachmentUpsertResponse;
  }

  async function upsertAttachment(params: {
    entityType: "trace" | "span";
    entityId: string;
    projectName: string;
    traceId?: string;
    filePath: string;
    resolvedPath: string;
    reason: string;
  }): Promise<void> {
    const stats = await stat(params.resolvedPath);
    if (!stats.isFile() || stats.size <= 0) return;

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
      if (!result) return;

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
    } catch (err) {
      deps.onWarn(
        `hootrix: attachment upload failed (${params.reason}, entity=${params.entityType}:${params.entityId}, path=${params.filePath}, resolved=${params.resolvedPath}): ${deps.formatError(err)}`,
      );
    } finally {
      inFlightBindingKeys.delete(bindingKey);
    }
  }

  async function bindReferenceAttachment(params: {
    entityType: "trace" | "span";
    entityId: string;
    projectName: string;
    traceId?: string;
    mediaRef: ParsedMediaRef;
    reason: string;
  }): Promise<void> {
    const registered =
      lookupMediaRefByHashPrefix(params.mediaRef.hashPrefix, params.mediaRef.fileName) ??
      undefined;
    if (!registered?.contentHash) {
      return;
    }

    const bindingKey = entityBindingKey(
      params.entityType,
      params.entityId,
      registered.contentHash,
    );
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
      if (!result) return;

      if (result.placeholder) {
        registerMediaRef(params.mediaRef.placeholder, mediaRefMetaFromUpsert(result));
      }

      if (result.status === "upload_required") {
        deps.onWarn(
          `hootrix: attachment reference bind skipped (${params.reason}, entity=${params.entityType}:${params.entityId}, ref=${params.mediaRef.placeholder}): primary bytes not ready`,
        );
        return;
      }

      boundAttachmentKeys.add(bindingKey);
    } catch (err) {
      deps.onWarn(
        `hootrix: attachment reference bind failed (${params.reason}, entity=${params.entityType}:${params.entityId}, ref=${params.mediaRef.placeholder}): ${deps.formatError(err)}`,
      );
    } finally {
      inFlightBindingKeys.delete(bindingKey);
    }
  }

  async function uploadFileAttachment(params: {
    entityType: "trace" | "span";
    entityId: string;
    projectName: string;
    traceId?: string;
    filePath: string;
    reason: string;
  }): Promise<void> {
    if (!attachmentsEnabled) return;

    const resolvedPath = normalizeLocalMediaPath(params.filePath);
    if (!resolvedPath) return;

    await upsertAttachment({
      ...params,
      resolvedPath,
    });
  }

  function scheduleMediaAttachmentUploads(params: ScheduledMediaUpload): void {
    if (!attachmentsEnabled) return;
    const entityId = resolveEntityId(params.entity);
    if (!entityId) return;

    const mediaPaths = new Set<string>();
    const mediaRefs = new Set<ParsedMediaRef>();
    for (const payload of params.payloads) {
      collectMediaPathsFromUnknown(payload, mediaPaths);
      collectMediaRefsFromUnknown(payload, mediaRefs);
    }

    for (const filePath of mediaPaths) {
      scheduleAttachmentUpload(() =>
        uploadFileAttachment({
          entityType: params.entityType,
          entityId,
          projectName: params.projectName,
          traceId: params.traceId,
          filePath,
          reason: params.reason,
        }),
      );
    }

    const seenRefs = new Set<string>();
    for (const mediaRef of mediaRefs) {
      const dedupe = mediaRefDedupeKey(mediaRef);
      if (seenRefs.has(dedupe)) continue;
      seenRefs.add(dedupe);
      scheduleAttachmentUpload(() =>
        bindReferenceAttachment({
          entityType: params.entityType,
          entityId,
          projectName: params.projectName,
          traceId: params.traceId,
          mediaRef,
          reason: `${params.reason} (media-ref)`,
        }),
      );
    }
  }

  async function waitForUploads(): Promise<void> {
    await attachmentQueue.catch(() => undefined);
  }

  function reset(): void {
    inFlightBindingKeys.clear();
    boundAttachmentKeys.clear();
  }

  return {
    scheduleMediaAttachmentUploads,
    waitForUploads,
    reset,
  };
}
