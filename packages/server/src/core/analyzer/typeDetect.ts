/** 类型识别（FR-3.3 / 14.2）：manual 覆盖优先；特征文件 + 依赖规则。 */

export interface TypeDetectInput {
  /** 根下带清单的子目录名 */
  manifestSubDirs: string[];
  /** docker-compose 中 service 数（无则 0） */
  composeServices: number;
  hasGatewayDir: boolean;
  frontendDepDirs: string[];
  backendDepDirs: string[];
  hasBackendFramework: boolean;
  hasServerTemplates: boolean;
  frontendFramework: boolean;
  hasIndexHtmlWithPackageJson: boolean;
  scriptBytes: number;
  totalBytes: number;
  assetBytes: number;
}

const FRONTEND_DIR_NAMES = new Set(['web', 'frontend', 'client', 'ui', 'app', 'h5']);
const BACKEND_DIR_NAMES = new Set(['server', 'api', 'backend', 'service', 'services', 'gateway']);

export function detectProjectType(
  input: TypeDetectInput,
): 'frontend' | 'backend' | 'split' | 'monolith' | 'microservice' | 'script' | 'assets' | 'unknown' {
  // 1) 微服务：≥2 个带清单子目录 + (compose 多 service 或 gateway 目录)
  if (input.manifestSubDirs.length >= 2 && (input.composeServices >= 2 || input.hasGatewayDir)) {
    return 'microservice';
  }
  // 2) 前后端分离：前端特征子目录 + 后端特征子目录各带清单
  const hasFrontendSub = input.frontendDepDirs.length > 0;
  const hasBackendSub = input.backendDepDirs.length > 0;
  if (hasFrontendSub && hasBackendSub) return 'split';
  // 3) 单体：同工程含后端框架 + 服务端模板/静态资源
  if (input.hasBackendFramework && input.hasServerTemplates) return 'monolith';
  // 4) 前端：前端框架依赖且无后端框架
  if (input.frontendFramework && !input.hasBackendFramework) return 'frontend';
  if (input.hasIndexHtmlWithPackageJson) return 'frontend';
  // 5) 后端
  if (input.hasBackendFramework) return 'backend';
  if (input.frontendDepDirs.length > 0 || input.backendDepDirs.length > 0) {
    return input.frontendDepDirs.length > 0 ? 'frontend' : 'backend';
  }
  // 6) 脚本工具：*.ps1/*.sh/*.bat/*.py 占比 ≥ 40%
  if (input.totalBytes > 0 && input.scriptBytes / input.totalBytes >= 0.4) return 'script';
  // 7) 素材仓库：媒体占比 ≥ 80%
  if (input.totalBytes > 0 && input.assetBytes / input.totalBytes >= 0.8) return 'assets';
  return 'unknown';
}

export function isFrontendDirName(name: string): boolean {
  return FRONTEND_DIR_NAMES.has(name.toLowerCase());
}

export function isBackendDirName(name: string): boolean {
  return BACKEND_DIR_NAMES.has(name.toLowerCase());
}
