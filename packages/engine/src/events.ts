/**
 * Change events emitted after a transaction commits, shaped like Change Data Capture's
 * ChangeEventHeader so downstream sinks (Kafka, SQS, webhooks) can mirror Salesforce.
 */
export type ChangeType = "CREATE" | "UPDATE" | "DELETE" | "UNDELETE";

export interface ChangeEvent {
  entityName: string;
  changeType: ChangeType;
  recordIds: string[];
  changedFields: string[];
  commitTimestamp: string;
  commitUser: string;
  transactionKey: string;
}

export type ChangeListener = (events: ChangeEvent[]) => void | Promise<void>;

export class ChangeBus {
  private readonly listeners: ChangeListener[] = [];

  subscribe(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async publish(events: ChangeEvent[]): Promise<void> {
    if (events.length === 0) return;
    for (const l of this.listeners) await l(events);
  }
}
