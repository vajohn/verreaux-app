import { memo, useEffect, useRef } from 'react';
import { useLongPress } from '../../lib/useLongPress';

interface PageSlotProps {
  index: number;
  url: string | null;
  inWindow: boolean;
  placeholderHeight: number;
  onMeasured: (index: number, height: number) => void;
  onLongPress?: (index: number) => void;
}

function PageSlotComponent({
  index,
  url,
  inWindow,
  placeholderHeight,
  onMeasured,
  onLongPress,
}: PageSlotProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!inWindow || !ref.current) return;
    const el = ref.current;
    const measure = (): void => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) onMeasured(index, h);
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [inWindow, index, onMeasured, url]);

  const longPress = useLongPress(() => {
    onLongPress?.(index);
  });

  if (!inWindow) {
    return (
      <div
        data-index={index}
        className="page-slot page-slot--placeholder"
        style={{ height: placeholderHeight }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      data-index={index}
      className="page-slot"
      ref={ref}
      {...longPress}
    >
      {url ? (
        <img className="page-slot__img" src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <div
          className="page-slot__shimmer"
          style={{ height: placeholderHeight }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// Memoized: a chapter mounts one slot per page (up to a few hundred). Without
// memo, every cascading forceRender during prefetch reconciles every slot,
// even those whose props are unchanged. With shallow compare the off-window
// slots short-circuit and only the slot that actually received a new url
// re-renders.
export const PageSlot = memo(PageSlotComponent);
