/** CLI：数据自检报告（C-42）。 */
import { resolveDataDir, ensureDataDirs } from '../config.js';
import { LibraryStore } from '../db/index.js';
import { integrityCheck } from '../db/migrate.js';
import { listProjects } from '../db/repo/projectsRepo.js';
import { listMounts } from '../db/repo/docsRepo.js';
import { listTrash } from '../db/repo/filesRepo.js';
import { indexStats } from '../db/repo/filesRepo.js';
import { existsSync, statSync } from 'node:fs';

const layout = ensureDataDirs(resolveDataDir());
const store = new LibraryStore({ id: 'default', dbFile: layout.dbFile });
const db = store.open();

process.stdout.write('ttFolio doctor 报告');
process.stdout.write('='.repeat(50));
process.stdout.write(`数据目录: ${layout.dataDir}`);
process.stdout.write(`库文件:   ${layout.dbFile} (${((statSync(layout.dbFile).size) / 1024 / 1024).toFixed(2)} MB)`);

const ic = integrityCheck(db);
process.stdout.write(`\n[完整性] ${ic.ok ? 'OK' : '异常: ' + ic.message}`);

const projects = listProjects(db, { status: 'all' });
process.stdout.write(`\n[项目] 共 ${projects.length} 个`);
const missing = projects.filter((p) => !p.pathOk);
if (missing.length > 0) {
  process.stdout.write(`  路径失效 ${missing.length} 个:`);
  for (const p of missing) process.stdout.write(`   - ${p.diskName}: ${p.dirPath}`);
}
const unanalyzed = projects.filter((p) => p.analyzedAt === null);
if (unanalyzed.length > 0) process.stdout.write(`  未分析 ${unanalyzed.length} 个`);

process.stdout.write(`\n[挂载] 共 ${projects.length > 0 ? projects.reduce((acc, p) => acc + listMounts(db, p.id).length, 0) : 0} 条`);
for (const p of projects) {
  for (const m of listMounts(db, p.id)) {
    if (!existsSync(m.path)) process.stdout.write(`  失效挂载: 项目 ${p.diskName} -> ${m.path}`);
  }
}

const trashItems = listTrash(db);
const trashBytes = trashItems.reduce((a, t) => a + t.sizeBytes, 0);
process.stdout.write(`\n[回收站] ${trashItems.length} 条，共 ${(trashBytes / 1024 / 1024).toFixed(1)} MB`);

let ftsFiles = 0;
let ftsBytes = 0;
for (const p of projects) {
  const s = indexStats(db, p.id);
  ftsFiles += s.files;
  ftsBytes += s.bytes;
}
process.stdout.write(`[内容索引] ${ftsFiles} 个文件，源内容 ${(ftsBytes / 1024 / 1024).toFixed(1)} MB`);

store.close();
process.stdout.write('\n完成。');
