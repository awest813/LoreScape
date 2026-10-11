import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const serverDir = path.resolve(process.env.LORESCAPE_SERVER_DIR || path.join(root, '.local/server'));
export const serverCommit = 'c9a041799e9893a3174be433ca884837254f262b';
export const serverRepository = 'https://github.com/2004Scape/Server.git';
