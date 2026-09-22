/**
 * 设置章节的单一来源：左侧栏（域=设置）与设置页 Divider 共用同一份定义，
 * 避免两边各写一份标题后漂移（改一处、另一处没跟上）。
 * key 同时用作 DOM id（`set-<key>`）与标签 subTab，供侧栏点击后滚动定位。
 */
export interface SettingsSection {
  key: string;
  /** 左侧栏短名 */
  label: string;
  /** 设置页分组标题（保留 FR 编号便于对照规格） */
  title: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: 'appearance', label: '外观与密度', title: '外观（FR-11.3）' },
  { key: 'datasource', label: '数据源与根目录', title: '数据源与根目录（FR-11.1 / FR-6.2）' },
  { key: 'collections', label: '集合（工作集）', title: '集合（FR-2.7）' },
  { key: 'ignore', label: '忽略规则', title: '忽略规则（FR-3.7）' },
  { key: 'templates', label: '命令模板', title: '命令模板（FR-10.3，可扩展打开方式）' },
  { key: 'watch', label: '文件监听与保存', title: '文件监听与保存（FR-11.2）' },
  { key: 'data', label: '数据与备份', title: '数据与备份（FR-11.5）' },
  { key: 'about', label: '关于', title: '关于（FR-11.6）' }
];

export function sectionTitle(key: string): string {
  return SETTINGS_SECTIONS.find((s) => s.key === key)?.title ?? key;
}

/** DOM 锚点 id（设置页与侧栏共用，保证"点侧栏能滚到对应分组"）。 */
export function sectionDomId(key: string): string {
  return `set-${key}`;
}
