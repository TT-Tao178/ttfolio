/** 语言占比色条（FR-3.2 / 7.6）：GitHub 语言色（数据语义色，见 theme/langColors 豁免说明）。 */
import { Tooltip } from 'antd';
import type { LanguageStat } from '@ttfolio/shared';
import { langColor, SEMANTIC } from '@/theme/tokens';

export function LanguageBar({ languages }: { languages: LanguageStat[] }): React.JSX.Element {
  if (languages.length === 0) {
    return <div style={{ height: 6, borderRadius: 3, background: SEMANTIC.split }} />;
  }
  return (
    <div
      style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: SEMANTIC.split }}
    >
      {languages.map((l) => (
        <Tooltip key={l.language} title={`${l.language} ${l.percent}%`}>
          <div
            style={{
              width: `${Math.max(l.percent, 1)}%`,
              minWidth: l.percent > 0 ? 1 : 0,
              background: langColor(l.language),
            }}
          />
        </Tooltip>
      ))}
    </div>
  );
}
