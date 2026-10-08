/**
 * 目录自动扫描器（FR-12.6 / C-58 预留位）：只留接口签名，不实现。
 * 当前阶段项目只允许手动添加（对话框 / 粘贴路径 / 父目录批量 / 拖拽降级）。
 */

export interface ScanRootConfig {
  rootDir: string;
  maxDepth: number;
  /** 命中这些清单文件名才视为项目 */
  manifestNames: string[];
  enabled: boolean;
}

export interface ScanCandidate {
  dirPath: string;
  matchedManifests: string[];
}

export interface ProjectScanner {
  /** 扫描一个数据源根目录，返回候选（只读、不写库、不登记）。 */
  scan(root: ScanRootConfig): AsyncIterable<ScanCandidate>;
}

export const defaultScanRootConfig: ScanRootConfig = {
  rootDir: '',
  maxDepth: 3,
  manifestNames: ['package.json', 'pom.xml', 'go.mod', 'Cargo.toml', '.git'],
  enabled: false,
};
