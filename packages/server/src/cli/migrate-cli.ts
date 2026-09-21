/** CLI：手动跑迁移。 */
import { resolveDataDir, ensureDataDirs } from '../config.js';
import { LibraryStore } from '../db/index.js';
import { runMigrations, integrityCheck } from '../db/migrate.js';

const layout = ensureDataDirs(resolveDataDir());
const store = new LibraryStore({ id: 'default', dbFile: layout.dbFile });
const db = store.open();
const ic = integrityCheck(db);
const r = runMigrations(db, layout.backupDir);
console.log(`integrity: ${ic.message}`);
console.log(`applied: ${r.applied.length === 0 ? '(none, up to date)' : r.applied.map((m) => m.file).join(', ')}`);
store.close();
