import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        allowedHosts: true,
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/health": "http://127.0.0.1:3001",
            "/providers": "http://127.0.0.1:3001",
            "/rooms": "http://127.0.0.1:3001",
            "/socket.io": {
                target: "http://127.0.0.1:3001",
                ws: true,
            },
        },
    },
});
