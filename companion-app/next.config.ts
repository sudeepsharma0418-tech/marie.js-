import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Recordings for the shared voices are read on the server, so ship them with it.
  outputFileTracingIncludes: { "/**": ["./voices/**"] },
};

export default nextConfig;
