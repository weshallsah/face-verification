import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import faceRoutes from './routes/face.js';
import devRoutes from './dev.js';

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Dev-only test page and token issuer. Never enable in production.
if (process.env.DEV_MODE === 'true') {
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(publicDir));
  app.use('/dev', devRoutes);
  app.get('/dev/token', (req, res) => {
    const sub = String(req.query.sub ?? '');
    if (!/^\d+$/.test(sub)) return res.status(400).json({ error: 'sub_must_be_numeric' });
    res.json({ token: jwt.sign({ sub }, process.env.JWT_SECRET, { expiresIn: '1h' }) });
  });
}

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
