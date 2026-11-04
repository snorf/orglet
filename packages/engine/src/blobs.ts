/**
 * The one seam for file bytes: inline bytea on the ContentVersion row today, an external checksum-addressed store in
 * archive mode later. Callers (the engine's file step, the download route) never know which one is behind the interface.
 */
import { Readable } from "node:stream";
import { columnName, isBlob, quote, type Queryable } from "@orglet/schema";
import type { Store } from "./store.js";

/** What a stored blob belongs to. checksum/extension feed the external store's key (Phase 17/18); the inline store addresses by id. */
export interface BlobRef {
  object: string;
  field: string;
  /** 18-character record Id. */
  id: string;
  /** Lowercase MD5 hex, as stored in Checksum. */
  checksum: string | null;
  /** FileExtension. */
  extension: string | null;
}

export interface OpenedBlob {
  stream: Readable;
  /** Bytes the store will deliver; the authority for Content-Length. */
  size: number;
}

export interface BlobStore {
  readonly kind: "inline" | "external";
  /** Writes the bytes for ref. Inline: joins the caller's transaction through `client`. */
  put(client: Queryable, ref: BlobRef, bytes: Buffer): Promise<void>;
  /** undefined when no bytes are behind ref (never an empty stream). */
  open(client: Queryable, ref: BlobRef): Promise<OpenedBlob | undefined>;
}

const CHECKSUM = /^[0-9a-f]{32}$/;
const EXTENSION = /^[A-Za-z0-9]{0,16}$/;

/**
 * Object key `files/<checksum[0:4]>/<checksum>.<extension>` (layout from HEIMDALL-FORMAT.md section 4). Inputs are
 * rejected, never sanitised: the key becomes a filesystem path or an S3 key. An empty extension yields no trailing dot;
 * that choice must be confirmed against Heimdall in Phase 16/18 before the fixture layout is frozen.
 */
export function blobKey(checksum: string, extension: string): string {
  if (!CHECKSUM.test(checksum)) throw new RangeError("blobKey: checksum must be 32 lowercase hex characters");
  if (!EXTENSION.test(extension)) throw new RangeError("blobKey: extension must be 0-16 ASCII letters or digits");
  return `files/${checksum.slice(0, 4)}/${checksum}${extension === "" ? "" : `.${extension}`}`;
}

/** One bytea value per row, read and written by Id. */
export class InlineBlobStore implements BlobStore {
  readonly kind = "inline" as const;

  constructor(private readonly store: Store) {}

  private target(ref: BlobRef): { table: string; column: string } {
    const obj = this.store.schema.getObject(ref.object);
    const field = this.store.schema.getField(ref.object, ref.field);
    if (!obj || !field || !isBlob(field)) throw new Error(`InlineBlobStore: ${ref.object}.${ref.field} is not a modelled Base64 field`);
    return { table: this.store.table(obj), column: quote(columnName(field)) };
  }

  async put(client: Queryable, ref: BlobRef, bytes: Buffer): Promise<void> {
    const { table, column } = this.target(ref);
    const res = await client.query(`UPDATE ${table} SET ${column} = $2 WHERE "id" = $1`, [ref.id, bytes]);
    if (res.rowCount === 0) throw new Error(`InlineBlobStore: no ${ref.object} row ${ref.id}`);
  }

  async open(client: Queryable, ref: BlobRef): Promise<OpenedBlob | undefined> {
    const { table, column } = this.target(ref);
    const res = await client.query<{ b: Buffer }>(`SELECT ${column} AS b FROM ${table} WHERE "id" = $1 AND ${column} IS NOT NULL`, [ref.id]);
    const row = res.rows[0];
    if (!row) return undefined;
    // The value is already fully in memory once pg returns it, so the client can be released before the stream is consumed.
    return { stream: Readable.from([row.b]), size: row.b.length };
  }
}
