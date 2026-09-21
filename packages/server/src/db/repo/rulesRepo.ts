/** 忽略规则与命令模板仓储。 */
import type { CommandTemplate, IgnoreRule } from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { CommandTemplateRow, IgnoreRuleRow } from '../rowTypes.js';

function mapRule(r: IgnoreRuleRow): IgnoreRule {
  return {
    id: r.id,
    scope: r.scope === 'project' ? 'project' : 'global',
    projectId: r.project_id,
    pattern: r.pattern,
    mode: r.mode === 'analyze_only' ? 'analyze_only' : 'hide',
    isBuiltin: r.is_builtin === 1,
    enabled: r.enabled === 1
  };
}

export function listIgnoreRules(db: Database.Database): IgnoreRule[] {
  return getAll<IgnoreRuleRow>(db, 'SELECT * FROM ignore_rules ORDER BY is_builtin DESC, pattern').map(mapRule);
}

export function createIgnoreRule(db: Database.Database, data: { scope: 'global' | 'project'; projectId: string | null; pattern: string; mode: 'hide' | 'analyze_only'; enabled: boolean }): IgnoreRule {
  const id = ulid();
  run(db, 'INSERT INTO ignore_rules (id, scope, project_id, pattern, mode, is_builtin, enabled) VALUES (?, ?, ?, ?, ?, 0, ?)', [id, data.scope, data.projectId, data.pattern, data.mode, data.enabled ? 1 : 0]);
  const row = getOne<IgnoreRuleRow>(db, 'SELECT * FROM ignore_rules WHERE id = ?', [id]);
  if (row === undefined) throw new Error('insert ignore rule failed');
  return mapRule(row);
}

export function updateIgnoreRule(db: Database.Database, id: string, fields: { pattern?: string; mode?: 'hide' | 'analyze_only'; enabled?: boolean }): boolean {
  const row = getOne<IgnoreRuleRow>(db, 'SELECT * FROM ignore_rules WHERE id = ?', [id]);
  if (row === undefined) return false;
  run(db, 'UPDATE ignore_rules SET pattern = ?, mode = ?, enabled = ? WHERE id = ?', [
    fields.pattern ?? row.pattern,
    fields.mode ?? row.mode,
    (fields.enabled ?? row.enabled === 1) ? 1 : 0,
    id
  ]);
  return true;
}

export function deleteIgnoreRule(db: Database.Database, id: string): boolean {
  const r = run(db, 'DELETE FROM ignore_rules WHERE id = ? AND is_builtin = 0', [id]);
  return r.changes > 0;
}

function mapTemplate(r: CommandTemplateRow): CommandTemplate {
  let args: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.args_json);
    if (Array.isArray(parsed)) args = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    args = [];
  }
  return {
    id: r.id,
    label: r.label,
    executable: r.executable,
    argsJson: args,
    shell: r.shell === 1,
    needsConfirm: r.needs_confirm === 1,
    platforms: r.platforms,
    isBuiltin: r.is_builtin === 1,
    enabled: r.enabled === 1,
    sortOrder: r.sort_order
  };
}

export function listCommandTemplates(db: Database.Database): CommandTemplate[] {
  return getAll<CommandTemplateRow>(db, 'SELECT * FROM command_templates ORDER BY sort_order, label').map(mapTemplate);
}

export function createCommandTemplate(db: Database.Database, data: { label: string; executable: string; args: string[]; needsConfirm: boolean; platforms: string | null; enabled: boolean; sortOrder: number }): CommandTemplate {
  const id = ulid();
  run(
    db,
    `INSERT INTO command_templates (id, label, executable, args_json, shell, needs_confirm, platforms, is_builtin, enabled, sort_order)
     VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?)`,
    [id, data.label, data.executable, JSON.stringify(data.args), data.needsConfirm ? 1 : 0, data.platforms, data.enabled ? 1 : 0, data.sortOrder]
  );
  const row = getOne<CommandTemplateRow>(db, 'SELECT * FROM command_templates WHERE id = ?', [id]);
  if (row === undefined) throw new Error('insert template failed');
  return mapTemplate(row);
}

export function updateCommandTemplate(db: Database.Database, id: string, fields: { label?: string; executable?: string; args?: string[]; needsConfirm?: boolean; enabled?: boolean; sortOrder?: number }): boolean {
  const row = getOne<CommandTemplateRow>(db, 'SELECT * FROM command_templates WHERE id = ?', [id]);
  if (row === undefined) return false;
  run(
    db,
    'UPDATE command_templates SET label = ?, executable = ?, args_json = ?, needs_confirm = ?, enabled = ?, sort_order = ? WHERE id = ?',
    [
    fields.label ?? row.label,
    fields.executable ?? row.executable,
    fields.args !== undefined ? JSON.stringify(fields.args) : row.args_json,
    (fields.needsConfirm ?? row.needs_confirm === 1) ? 1 : 0,
    (fields.enabled ?? row.enabled === 1) ? 1 : 0,
    fields.sortOrder ?? row.sort_order,
    id
  ]);
  return true;
}

export function deleteCommandTemplate(db: Database.Database, id: string): boolean {
  const r = run(db, 'DELETE FROM command_templates WHERE id = ? AND is_builtin = 0', [id]);
  return r.changes > 0;
}
