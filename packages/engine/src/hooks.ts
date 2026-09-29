/**
 * The extension point the save pipeline calls around each DML event. Apex triggers and
 * record-triggered Flows will be implementations of this interface; so are plugins.
 */
import type { SObjectDef } from "@orglet/metadata";
import type { RecordData } from "@orglet/formula";

export type DmlOperation = "insert" | "update" | "delete" | "undelete";

export interface Session {
  userId: string;
  organizationId: string;
  profileId: string;
}

export interface TriggerContext {
  sobject: SObjectDef;
  operation: DmlOperation;
  /** `before` hooks may modify `records` in place (insert/update only). */
  timing: "before" | "after";
  /** New values, one per record in the batch. Empty for delete. */
  records: RecordData[];
  /** Previous values, aligned with `records` (update) or the deleted records (delete/undelete). */
  old: RecordData[];
  session: Session;
  /** Mark a record as failed with a FIELD_CUSTOM_VALIDATION_EXCEPTION. */
  addError(index: number, message: string, field?: string): void;
}

export interface TriggerExecutor {
  /** Called for every event; implementations filter on sobject/operation/timing themselves. */
  run(ctx: TriggerContext): Promise<void>;
}
