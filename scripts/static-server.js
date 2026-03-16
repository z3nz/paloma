import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, '..', 'dist');

const PORT = 5173;
const app = express();

// Serve static files from dist/
app.use(express.static(distPath));

// SPA fallback — any non-file request returns index.html
app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`[static-server] Serving dist/ on http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`[static-server] ${signal} received, shutting down...`);
  server.close(() => {
    console.log('[static-server] Closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
