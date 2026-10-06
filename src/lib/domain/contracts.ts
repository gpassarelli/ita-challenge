import type { DataRecord, Workspace } from "./types";

export function contractFor(state: Workspace, record: DataRecord) {
  if (!record.companyId || !record.productId) return undefined;
  return state.records.find(
    (candidate) =>
      candidate.dataset === "Clientes_Atuais" &&
      candidate.companyId === record.companyId &&
      candidate.productId === record.productId,
  );
}

export function originatingContract(state: Workspace, opportunityId: string) {
  return state.records.find(
    (record) =>
      record.dataset === "Clientes_Atuais" &&
      record.data.opportunity_id === opportunityId,
  );
}

export function customerOpportunityKey(customerId: string) {
  return "CLI-" + customerId;
}

export function productName(state: Workspace, record: DataRecord) {
  return (
    state.records.find(
      (product) =>
        product.dataset === "Portfolio" && product.id === record.productId,
    )?.data.name ??
    record.data.solution_external_id ??
    null
  );
}
