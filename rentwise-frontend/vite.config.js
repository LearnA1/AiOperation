import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxies /api and /dev straight to the RentWise backend so the browser
// sees everything as same-origin -- no CORS setup needed on the backend.
// Change BACKEND_URL if your backend runs somewhere other than :3000.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": BACKEND_URL,
      "/dev": BACKEND_URL,
    },
  },
});
