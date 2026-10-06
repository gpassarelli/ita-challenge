import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
};
export default withWorkflow(config);
