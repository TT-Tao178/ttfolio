/**
 * 浮层守卫（T-131 空域三件套之一）：数"真正压在寄宿区上的 ttFolio 浮层"，写进
 * store.nativeOverlayCount，由 EmbedPanel 据此把 setVisible(false) 交给主进程。
 *
 * 为什么用 MutationObserver 而不是给每个 Modal/Select 埋点：埋点分散在几十处、漏一个就是
 * 一个"被原生窗口盖住的弹窗"；而 AntD 浮层统一挂在 body 下，观察 body 子树即可全覆盖。
 * 为什么带矩形相交判定：面板头部的 tooltip 不压在寄宿区上，纯计数会让画面无谓闪烁。
 */
import { useEffect } from 'react';
import { useAppStore } from '@/app/store';
import {
  countBlockingOverlays,
  HIDDEN_OVERLAY_CLASSES,
  OVERLAY_SELECTOR,
  toBox,
  type OverlayProbe,
} from './embedHostView';

function probeOf(el: Element): OverlayProbe {
  const hiddenByClass = HIDDEN_OVERLAY_CLASSES.some((c) => el.classList.contains(c));
  const hidden =
    hiddenByClass ||
    (el instanceof HTMLElement && el.style.display === 'none') ||
    (el instanceof HTMLElement && el.style.visibility === 'hidden');
  if (hidden) return { box: null, hidden: true };
  return { box: toBox(el.getBoundingClientRect()), hidden: false };
}

/**
 * active 为真时才观察（未寄宿不需要任何计数开销）。hostRef 指向寄宿画面占用的元素。
 * 计数变化节流到一帧一次；卸载/失活时把计数清零，避免留下"永久隐藏"的推导输入。
 */
export function useNativeOverlayGuard(
  active: boolean,
  hostRef: { readonly current: HTMLElement | null },
): void {
  useEffect(() => {
    if (!active) {
      useAppStore.getState().setNativeOverlayCount(0);
      return undefined;
    }
    let raf = 0;
    let last = -1;

    const measure = (): void => {
      raf = 0;
      const host = hostRef.current;
      if (host === null) {
        if (last !== 0) {
          last = 0;
          useAppStore.getState().setNativeOverlayCount(0);
        }
        return;
      }
      const rect = host.getBoundingClientRect();
      const hostBox = toBox(rect);
      if (hostBox === null) return; // 面板尚未布局：保持原值，等下一次尺寸变化
      const probes = Array.from(document.body.querySelectorAll(OVERLAY_SELECTOR)).map(probeOf);
      const n = countBlockingOverlays(probes, hostBox);
      if (n !== last) {
        last = n;
        useAppStore.getState().setNativeOverlayCount(n);
      }
    };

    const schedule = (): void => {
      if (raf === 0) raf = window.requestAnimationFrame(measure);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf !== 0) window.cancelAnimationFrame(raf);
      useAppStore.getState().setNativeOverlayCount(0);
    };
  }, [active, hostRef]);
}
