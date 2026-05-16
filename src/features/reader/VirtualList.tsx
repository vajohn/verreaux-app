import { useEffect, useRef } from 'react';
import { PageSlot } from './PageSlot';
import type { Virtualization } from './useVirtualization';
import type { PageMeta } from './reader.store';

interface VirtualListProps {
  pages: PageMeta[];
  virt: Virtualization;
  pageGap: number;
  onCurrentIndex: (index: number) => void;
  scrollRoot: HTMLElement | null;
  onPageLongPress?: (index: number) => void;
}

export function VirtualList({
  pages,
  virt,
  pageGap,
  onCurrentIndex,
  scrollRoot,
  onPageLongPress,
}: VirtualListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver tracks viewport-center page index.
  useEffect(() => {
    if (!containerRef.current || !scrollRoot) return;
    const slots = containerRef.current.querySelectorAll<HTMLElement>('.page-slot');
    if (slots.length === 0) return;
    const rootMargin = '-50% 0px -50% 0px'; // center line
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset['index']);
          if (!Number.isFinite(idx)) continue;
          onCurrentIndex(idx);
          virt.onCurrentIndexChange(idx);
        }
      },
      { root: scrollRoot, rootMargin, threshold: 0 },
    );
    slots.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [pages.length, scrollRoot, onCurrentIndex, virt]);

  return (
    <div
      ref={containerRef}
      className="virtual-list"
      style={{ display: 'flex', flexDirection: 'column', gap: pageGap }}
    >
      {pages.map((_, index) => (
        <PageSlot
          key={index}
          index={index}
          url={virt.getObjectUrl(index)}
          inWindow={virt.isInRenderWindow(index)}
          placeholderHeight={virt.getPlaceholderHeight(index)}
          onMeasured={virt.onHeightMeasured}
          onLongPress={onPageLongPress}
        />
      ))}
    </div>
  );
}
