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

console.log('ttFolio doctor 报告');
console.log('='.repeat(50));
console.log(`数据目录: ${layout.dataDir}`);
console.log(`库文件:   ${layout.dbFile} (${((statSync(layout.dbFile).size) / 1024 / 1024).toFixed(2)} MB)`);

const ic = integrityCheck(db);
console.log(`\n[完整性] ${ic.ok ? 'OK' : '异常: ' + ic.message}`);

const projects = listProjects(db, { status: 'all' });
console.log(`\n[项目] 共 ${projects.length} 个`);
const missing = projects.filter((p) => !p.pathOk);
if (missing.length > 0) {
  console.log(`  路径失效 ${missing.length} 个:`);
  for (const p of missing) console.log(`   - ${p.diskName}: ${p.dirPath}`);
}
const unanalyzed = projects.filter((p) => p.analyzedAt === null);
if (unanalyzed.length > 0) console.log(`  未分析 ${unanalyzed.length} 个`);

console.log(`\n[挂载] 共 ${projects.length > 0 ? projects.reduce((acc, p) => acc + listMounts(db, p.id).length, 0) : 0} 条`);
for (const p of projects) {
  for (const m of listMounts(db, p.id)) {
    if (!existsSync(m.path)) console.log(`  失效挂载: 项目 ${p.diskName} -> ${m.path}`);
  }
}

const trashItems = listTrash(db);
const trashBytes = trashItems.reduce((a, t) => a + t.sizeBytes, 0);
console.log(`\n[回收站] ${trashItems.length} 条，共 ${(trashBytes / 1024 / 1024).toFixed(1)} MB`);

let ftsFiles = 0;
let ftsBytes = 0;
for (const p of projects) {
  const s = indexStats(db, p.id);
  ftsFiles += s.files;
  ftsBytes += s.bytes;
}
console.log(`[内容索引] ${ftsFiles} 个文件，源内容 ${(ftsBytes / 1024 / 1024).toFixed(1)} MB`);

store.close();
console.log('\n完成。');
