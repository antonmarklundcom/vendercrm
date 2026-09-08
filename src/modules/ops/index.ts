// Claude Ops (PLAN.md §18). The public face of the module: the ops-token
// credential, the guard that makes it create-only, the batch/row bookkeeping
// and the five provisioning steps.
//
// The superadmin console (phase O2) reads through the `list*`/`get*` helpers
// re-exported here; the `/api/ops/v1` routes call the rest. Nothing outside
// this module may write `ops_objects` — that table is the guard's memory.

export {
  createOpsToken,
  generateOpsToken,
  getOpsToken,
  hashOpsToken,
  listOpsTokens,
  resolveOpsToken,
  revokeOpsToken,
  setOpsTokenAllowlist,
  allowedTenantIds,
  type CreatedOpsToken,
  type CreateOpsTokenInput,
  type OpsTokenRow,
  type OpsTokenSummary,
} from "./tokens";

export {
  assertMayCreateSiteInTenant,
  assertMayTouch,
  listOpsObjectsForRow,
  mayCreateSiteInTenant,
  mayTouch,
  OpsAccessError,
  registerOpsObject,
  type OpsEntity,
} from "./guard";

export {
  addOpsRows,
  createOpsBatch,
  findOwnBatch,
  getOpsRow,
  listAllOpsBatches,
  listOpsBatches,
  listOpsRows,
  listRowsAwaitingOwner,
  listRowsForBatch,
  markRowLive,
  markRowRejected,
  markStepDone,
  markStepFailed,
  OPS_STEPS,
  requireOwnBatch,
  requireOwnRow,
  rowDetails,
  rowSteps,
  setBatchStatus,
  updateOpsRow,
  type CreateOpsRowInput,
  type OpsBatchRow,
  type OpsLastError,
  type OpsRow,
  type OpsRowDetails,
  type OpsRowState,
  type OpsStep,
  type OpsStepState,
  type OpsStepStatus,
  type OpsSteps,
  type UpdateOpsRowInput,
} from "./batches";

export { opsVia, writeOpsAudit } from "./audit";

export {
  OPS_TEST_LEAD_NAME,
  provisionKey,
  provisionPipeline,
  provisionSite,
  provisionTenant,
  provisionTestLead,
  slugFromDomain,
  type KeyStepResult,
  type PipelineStepResult,
  type SiteStepResult,
  type TenantStepResult,
  type TestLeadStepResult,
} from "./provision";
