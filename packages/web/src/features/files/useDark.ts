/** 从设置上下文读取当前深色态（避免循环依赖的小钩子）。 */
import { useSettings } from '@/app/settings';

export function useSettingsDark(): boolean {
  return useSettings().dark;
}
