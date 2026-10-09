// @orglet/metadata: SFDX source format + built-in standard objects -> OrgSchema
export * from "./types.js";
export { readSourceProject, UnsupportedMetadataError } from "./sfdx.js";
export type { SourceProject, SourceObject, SourceField, SourceFilterItem } from "./sfdx.js";
export { loadBaseline, buildOrgSchema } from "./build.js";
export type { Baseline, BuildResult } from "./build.js";
export { OrgSchemaImpl } from "./schema.js";

import { readSourceProject } from "./sfdx.js";
import { loadBaseline, buildOrgSchema, type BuildResult } from "./build.js";

export interface LoadOptions {
  /** SFDX project root (directory containing sfdx-project.json, or any directory with `objects/` folders). */
  projectDir?: string;
}

/** Load the standard baseline, optionally merged with an SFDX project on disk. */
export async function loadOrgSchema(options: LoadOptions = {}): Promise<BuildResult> {
  const baseline = await loadBaseline();
  const project = options.projectDir === undefined ? undefined : await readSourceProject(options.projectDir);
  return buildOrgSchema(baseline, project);
}
