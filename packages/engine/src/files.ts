/**
 * ContentVersion / ContentDocument / ContentDocumentLink semantics of a live org (FILE-03..05, D-08..D-12): the
 * document is a view of its latest version. Written as functions over a client and a Store, not as DmlEngine privates,
 * so code outside the engine (a Phase 17 stub-document path, D-03) can reuse the mirror.
 */
import { createHash } from "node:crypto";
import type { OrgSchema, SObjectDef } from "@orglet/metadata";
import type { RecordData } from "@orglet/formula";
import { generateId, type PoolClient, type Queryable } from "@orglet/schema";
import type { BlobStore } from "./blobs.js";
import { MAX_VERSION_DATA_BYTES } from "./coerce.js";
import { Errors, type SaveError } from "./errors.js";
import { fileExtensionOf, fileTypeFor } from "./filetypes.js";
import type { Store } from "./store.js";

export interface PreparedFile {
  blob?: Buffer | undefined;
  newDocument: boolean;
}

export interface FileStamp {
  now: string;
  userId: string;
}

function modelled(schema: OrgSchema, name: string): SObjectDef {
  const obj = schema.getObject(name);
  if (!obj) throw new Error(`${name} is not modelled`);
  return obj;
}

/** Insert path, before hooks and checkRequired. Removes VersionData from changes/next; outside import mode derives Checksum, ContentSize, ContentSizeLong, FileExtension, FileType and pre-assigns ContentDocumentId. */
export function prepareVersion(schema: OrgSchema, changes: RecordData, next: RecordData, importMode: boolean): { file: PreparedFile; errors: SaveError[] } {
  const raw = changes["VersionData"];
  delete changes["VersionData"];
  delete next["VersionData"];
  const file: PreparedFile = { newDocument: false };
  const errors: SaveError[] = [];
  if (typeof raw === "string") {
    const blob = Buffer.from(raw, "base64");
    if (blob.length > MAX_VERSION_DATA_BYTES) return { file, errors: [Errors.contentTooLarge("VersionData")] };
    file.blob = blob;
  }
  if (importMode) return { file, errors };

  const path = next["PathOnClient"];
  if (file.blob && (path === null || path === undefined || path === "")) errors.push(Errors.requiredMissing(["PathOnClient"]));
  next["FileExtension"] = typeof path === "string" ? fileExtensionOf(path) : null;
  next["FileType"] = fileTypeFor(next["FileExtension"]);
  if (file.blob) {
    next["Checksum"] = createHash("md5").update(file.blob).digest("hex");
    next["ContentSize"] = file.blob.length;
    next["ContentSizeLong"] = file.blob.length;
  }
  if (next["ContentDocumentId"] === null || next["ContentDocumentId"] === undefined) {
    // Assigned before checkRequired, which would otherwise report REQUIRED_FIELD_MISSING (the field is nillable:false since D-01);
    // the id is not in `changes`, so checkReferences does not look for the not-yet-written document.
    next["ContentDocumentId"] = generateId(modelled(schema, "ContentDocument").keyPrefix as string);
    file.newDocument = true;
    next["VersionNumber"] = "1";
    next["IsLatest"] = true;
  }
  return { file, errors };
}

/** Inside the record savepoint, before Store.insert of the version: creates or locks the document, flips IsLatest, numbers the version. */
export async function placeVersion(client: PoolClient, store: Store, next: RecordData, file: PreparedFile, stamp: FileStamp): Promise<void> {
  const doc = modelled(store.schema, "ContentDocument");
  const cv = modelled(store.schema, "ContentVersion");
  if (file.newDocument) {
    await store.insert(client, doc, {
      Id: next["ContentDocumentId"],
      OwnerId: next["OwnerId"],
      IsDeleted: false,
      CreatedDate: stamp.now,
      CreatedById: stamp.userId,
      LastModifiedDate: stamp.now,
      LastModifiedById: stamp.userId,
      SystemModstamp: stamp.now,
      Title: next["Title"],
    });
    return;
  }
  // Locking the document row serialises concurrent versions of one document, so they cannot share a number.
  const cvTable = store.table(cv);
  const docId = next["ContentDocumentId"];
  await client.query(`SELECT "id" FROM ${store.table(doc)} WHERE "id" = $1 FOR UPDATE`, [docId]);
  const res = await client.query<{ n: number }>(
    `SELECT coalesce(max(CASE WHEN "versionnumber" ~ '^[0-9]+$' THEN "versionnumber"::int END), 0) + 1 AS n FROM ${cvTable} WHERE "contentdocumentid" = $1`,
    [docId],
  );
  await client.query(`UPDATE ${cvTable} SET "islatest" = false WHERE "contentdocumentid" = $1 AND "islatest" = true`, [docId]);
  next["VersionNumber"] = String(Number(res.rows[0]?.n ?? 1));
  next["IsLatest"] = true;
}

/** After Store.insert: stores the bytes, mirrors the document and adds the FirstPublishLocationId link (outside import mode). */
export async function finishVersion(client: PoolClient, store: Store, blobs: BlobStore, next: RecordData, file: PreparedFile, stamp: FileStamp, importMode: boolean): Promise<void> {
  if (file.blob) {
    await blobs.put(
      client,
      { object: "ContentVersion", field: "VersionData", id: next["Id"] as string, checksum: (next["Checksum"] as string | null | undefined) ?? null, extension: (next["FileExtension"] as string | null | undefined) ?? null },
      file.blob,
    );
    file.blob = undefined;
  }
  if (importMode) return;
  await mirrorDocument(client, store, next, stamp);
  const cdl = store.schema.getObject("ContentDocumentLink");
  if (file.newDocument && typeof next["FirstPublishLocationId"] === "string" && cdl?.keyPrefix) {
    // D-10: one link to the publish location; the owner's implicit "I" link is deferred.
    await store.insert(client, cdl, {
      Id: generateId(cdl.keyPrefix),
      ContentDocumentId: next["ContentDocumentId"],
      LinkedEntityId: next["FirstPublishLocationId"],
      ShareType: "V",
      Visibility: "AllUsers",
      IsDeleted: false,
      CreatedDate: stamp.now,
      CreatedById: stamp.userId,
      LastModifiedDate: stamp.now,
      LastModifiedById: stamp.userId,
      SystemModstamp: stamp.now,
    });
  }
}

/** D-11: copies the version's Title, FileType, FileExtension, ContentSize, ContentSizeLong and Id (LatestPublishedVersionId) onto its document. */
export async function mirrorDocument(client: Queryable, store: Store, version: RecordData, stamp: FileStamp): Promise<void> {
  const doc = modelled(store.schema, "ContentDocument");
  const orNull = (k: string) => version[k] ?? null;
  await store.update(client, doc, version["ContentDocumentId"] as string, {
    Title: orNull("Title"),
    FileType: orNull("FileType"),
    FileExtension: orNull("FileExtension"),
    ContentSize: orNull("ContentSize"),
    ContentSizeLong: orNull("ContentSizeLong"),
    LatestPublishedVersionId: version["Id"] ?? null,
    LastModifiedDate: stamp.now,
    LastModifiedById: stamp.userId,
    SystemModstamp: stamp.now,
  });
}
