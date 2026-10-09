import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// Keep local workflow checkpoints outside Next's disposable build directory.
// withWorkflow otherwise defaults to .next/workflow-data, which next build clears.
if (!process.env.VERCEL_DEPLOYMENT_ID && !process.env.WORKFLOW_TARGET_WORLD) {
  process.env.WORKFLOW_TARGET_WORLD = "local";
  process.env.WORKFLOW_LOCAL_DATA_DIR ??= ".workflow-data";
}

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
};
export default withWorkflow(config);
