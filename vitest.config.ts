import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json so library code under
    // test can keep its normal imports.
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
