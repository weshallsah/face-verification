import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import faceRoutes from './routes/face.js';
import devRoutes from './dev.js';
import { mountFrontend } from './frontend.js';

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (req, res) => res.json({ ok: true }));

// In the image the frontend is copied to /app/public; set FRONTEND_DIR to serve ../../../frontend when running outside Docker.
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = process.env.FRONTEND_DIR
  ?? (fs.existsSync(path.join(here, '..', 'public')) ? path.join(here, '..', 'public') : path.join(here, '..', '..', '..', 'frontend'));

// /verify is always served. The dev test page, /dev/token and the preview harness need DEV_MODE=true.
mountFrontend(app, { frontendDir });
if (process.env.DEV_MODE === 'true') app.use('/dev', devRoutes);   // never enable in production

app.use('/v1/face', faceRoutes);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'jpeg_only') {
    return res.status(400).json({ error: err.message === 'jpeg_only' ? 'jpeg_only' : 'bad_upload' });
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => console.log(`api listening on ${port}`));
