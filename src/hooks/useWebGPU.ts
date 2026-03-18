import { useMemo } from 'react';

export type WebGPUStatus = 'available' | 'unavailable' | 'mobile';

/**
 * Check WebGPU availability and device type.
 * Returns a stable status that won't change during the session.
 */
export function useWebGPU(): WebGPUStatus {
  return useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return 'unavailable';
    }

    const ua = navigator.userAgent || '';
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth <= 768;
    const isMobile = mobileUA.test(ua) || (isTouchDevice && isSmallScreen);

    if (isMobile) return 'mobile';

    const hasGPU = !!(navigator as Navigator & { gpu?: unknown }).gpu;
    return hasGPU ? 'available' : 'unavailable';
  }, []);
}
