import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FRONTEND_DIR = path.join(here, '..', '..', '..', 'frontend');
export const VERIFY_DIR = path.join(FRONTEND_DIR, 'verify');
// import a module of the /verify page
export const verifyModule = (rel) => import(pathToFileURL(path.join(VERIFY_DIR, 'js', rel)).href);
