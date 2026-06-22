import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  registerMediaRef,
  resetMediaPlaceholderRegistry,
} from "./attachment-placeholder-registry.js";
import { createAttachmentUploader } from "./attachment-uploader.js";
import { sha256FileHex } from "./media-hash.js";

async function createTempMediaFile(
  ext = ".png",
  contents: string | Uint8Array = "test-bytes",
): Promise<{ dir: string; filePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "opik-attachment-uploader-"));
  const filePath = join(dir, `sample${ext}`);
  await writeFile(filePath, contents);
  return { dir, filePath };
}

describe("attachment uploader", () => {
  let tempDirs: string[] = [];
  const fetchMock = vi.fn();

  beforeEach(() => {
    tempDirs = [];
    resetMediaPlaceholderRegistry();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetMediaPlaceholderRegistry();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("uses upsert and skips PUT when attachment is referenced", async () => {
    const { dir, filePath } = await createTempMediaFile();
    tempDirs.push(dir);
    const contentHash = await sha256FileHex(filePath);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "referenced",
          attachment_id: "att-ref",
          canonical_attachment_id: "att-primary",
          file_name: "sample.png",
          file_size: 10,
          content_hash: contentHash,
          upload_kind: "reference",
          placeholder: `[media-ref:${contentHash.slice(0, 16)}:sample.png]`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const uploader = createAttachmentUploader({
      getApiKey: () => "test-key",
      getWorkspaceName: () => "default",
      getAttachmentBaseUrl: () => "http://127.0.0.1:9823",
      onWarn: () => undefined,
      formatError: (err) => String(err),
    });

    uploader.scheduleMediaAttachmentUploads({
      entityType: "trace",
      entity: { id: "trace-1" },
      projectName: "openclaw",
      reason: "test",
      payloads: [`media:${filePath}`],
    });
    await uploader.waitForUploads();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9823/v1/private/attachment/upsert");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { content_hash: string; source_ref: string };
    expect(body.content_hash).toBe(contentHash);
    expect(body.source_ref).toBe(filePath);
  });

  test("PUTs bytes after upload_required upsert", async () => {
    const { dir, filePath } = await createTempMediaFile();
    tempDirs.push(dir);
    const contentHash = await sha256FileHex(filePath);

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "upload_required",
            attachment_id: "att-new",
            file_name: "sample.png",
            file_size: 10,
            content_hash: contentHash,
            upload_kind: "primary",
            placeholder: `[media-ref:${contentHash.slice(0, 16)}:sample.png]`,
            upload_url: "http://127.0.0.1:9823/v1/private/attachment/upload?upload_token=tok",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const uploader = createAttachmentUploader({
      getApiKey: () => "test-key",
      getWorkspaceName: () => "default",
      getAttachmentBaseUrl: () => "http://127.0.0.1:9823",
      onWarn: () => undefined,
      formatError: (err) => String(err),
    });

    uploader.scheduleMediaAttachmentUploads({
      entityType: "span",
      entity: { id: "span-1" },
      projectName: "openclaw",
      traceId: "trace-1",
      reason: "test",
      payloads: [`media:${filePath}`],
    });
    await uploader.waitForUploads();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
  });

  test("does not upload incidental media paths embedded in plain text", async () => {
    const { dir, filePath } = await createTempMediaFile();
    tempDirs.push(dir);

    const uploader = createAttachmentUploader({
      getApiKey: () => "test-key",
      getWorkspaceName: () => "default",
      getAttachmentBaseUrl: () => "http://127.0.0.1:9823",
      onWarn: () => undefined,
      formatError: (err) => String(err),
    });

    uploader.scheduleMediaAttachmentUploads({
      entityType: "trace",
      entity: { id: "trace-1" },
      projectName: "openclaw",
      reason: "plain-text-path",
      payloads: [`debug dump: unexpected path ${filePath} from prior run`],
    });
    await uploader.waitForUploads();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("skips uploads when attachment uploads are disabled", async () => {
    const { dir, filePath } = await createTempMediaFile();
    tempDirs.push(dir);

    const uploader = createAttachmentUploader({
      getApiKey: () => "test-key",
      getWorkspaceName: () => "default",
      getAttachmentBaseUrl: () => "http://127.0.0.1:9823",
      onWarn: () => undefined,
      formatError: (err) => String(err),
      attachmentsEnabled: false,
    });

    uploader.scheduleMediaAttachmentUploads({
      entityType: "trace",
      entity: { id: "trace-1" },
      projectName: "openclaw",
      reason: "disabled",
      payloads: [`media:${filePath}`],
    });
    await uploader.waitForUploads();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rewrites upload URL with collector API path prefix", async () => {
    const { dir, filePath } = await createTempMediaFile();
    tempDirs.push(dir);
    const contentHash = await sha256FileHex(filePath);

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "upload_required",
            attachment_id: "att-new",
            file_name: "sample.png",
            file_size: 10,
            content_hash: contentHash,
            upload_kind: "primary",
            placeholder: `[media-ref:${contentHash.slice(0, 16)}:sample.png]`,
            upload_url: "https://trace.example.com/v1/private/attachment/upload?upload_token=tok",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const uploader = createAttachmentUploader({
      getApiKey: () => "test-key",
      getWorkspaceName: () => "default",
      getAttachmentBaseUrl: () => "https://trace.example.com/app/api",
      onWarn: () => undefined,
      formatError: (err) => String(err),
    });

    uploader.scheduleMediaAttachmentUploads({
      entityType: "span",
      entity: { id: "span-1" },
      projectName: "openclaw",
      reason: "prefix",
      payloads: [`media:${filePath}`],
    });
    await uploader.waitForUploads();

    const putUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(putUrl).toContain("/app/api/v1/private/attachment/upload");
  });

  test("binds reference attachment on a second entity with the same content hash", async () => {
    const { dir, filePath } = await createTempMediaFile();
    tempDirs.push(dir);
    const contentHash = await sha256FileHex(filePath);
    const placeholder = `[media-ref:${contentHash.slice(0, 16)}:sample.png]`;

    registerMediaRef(filePath, {
      placeholder,
      contentHash,
      fileName: "sample.png",
      fileSize: 10,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "referenced",
          attachment_id: "att-tool-ref",
          canonical_attachment_id: "att-primary",
          file_name: "sample.png",
          file_size: 10,
          content_hash: contentHash,
          upload_kind: "reference",
          placeholder,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const uploader = createAttachmentUploader({
      getApiKey: () => "test-key",
      getWorkspaceName: () => "default",
      getAttachmentBaseUrl: () => "http://127.0.0.1:9823",
      onWarn: () => undefined,
      formatError: (err) => String(err),
    });

    uploader.scheduleMediaAttachmentUploads({
      entityType: "span",
      entity: { id: "tool-span-1" },
      projectName: "openclaw",
      traceId: "trace-1",
      reason: "tool media-ref bind",
      payloads: [{ image: placeholder }],
    });
    await uploader.waitForUploads();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      entity_id: string;
      content_hash: string;
    };
    expect(body.entity_id).toBe("tool-span-1");
    expect(body.content_hash).toBe(contentHash);
  });

  test("uploads the same hash to another entity after primary upload", async () => {
    const { dir, filePath } = await createTempMediaFile(".png", "same-bytes");
    tempDirs.push(dir);
    const contentHash = await sha256FileHex(filePath);
    const placeholder = `[media-ref:${contentHash.slice(0, 16)}:sample.png]`;

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "upload_required",
            attachment_id: "att-primary",
            file_name: "sample.png",
            file_size: 10,
            content_hash: contentHash,
            upload_kind: "primary",
            placeholder,
            upload_url: "http://127.0.0.1:9823/v1/private/attachment/upload?upload_token=tok1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "referenced",
            attachment_id: "att-tool-ref",
            canonical_attachment_id: "att-primary",
            file_name: "sample.png",
            file_size: 10,
            content_hash: contentHash,
            upload_kind: "reference",
            placeholder,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const uploader = createAttachmentUploader({
      getApiKey: () => "test-key",
      getWorkspaceName: () => "default",
      getAttachmentBaseUrl: () => "http://127.0.0.1:9823",
      onWarn: () => undefined,
      formatError: (err) => String(err),
    });

    uploader.scheduleMediaAttachmentUploads({
      entityType: "span",
      entity: { id: "llm-span-1" },
      projectName: "openclaw",
      reason: "llm upload",
      payloads: [`media:${filePath}`],
    });
    uploader.scheduleMediaAttachmentUploads({
      entityType: "span",
      entity: { id: "tool-span-1" },
      projectName: "openclaw",
      reason: "tool upload",
      payloads: [`media:${filePath}`],
    });
    await uploader.waitForUploads();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondUpsertBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      entity_id: string;
    };
    expect(secondUpsertBody.entity_id).toBe("tool-span-1");
  });
});
