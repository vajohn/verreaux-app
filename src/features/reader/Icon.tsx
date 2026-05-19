// Inline SVG icon set for the reader overlays. Each icon defines two paths —
// a stroke variant (default) and a filled variant — and CSS toggles which is
// visible based on the parent button's hover/active state or an explicit
// `.is-filled` class. The button owns the icon's color via `currentColor`.
import type { ReactElement } from 'react';

interface IconProps {
  name: 'back' | 'home' | 'prev' | 'next' | 'cfg' | 'bookmark';
  size?: number;
}

export function Icon({ name, size = 20 }: IconProps): ReactElement {
  return (
    <svg
      className={`icon icon--${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {renderPaths(name)}
    </svg>
  );
}

function renderPaths(name: IconProps['name']): ReactElement {
  switch (name) {
    case 'back':
      // Arrow-left: outlined chevron + shaft (stroke); solid triangle (filled).
      return (
        <>
          <g className="icon__stroke">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </g>
          <g className="icon__filled" stroke="none" fill="currentColor">
            <path d="M20 11H8.4l4.3-4.3a1 1 0 1 0-1.4-1.4l-6 6a1 1 0 0 0 0 1.4l6 6a1 1 0 0 0 1.4-1.4L8.4 13H20a1 1 0 1 0 0-2z" />
          </g>
        </>
      );
    case 'home':
      // House outline / filled house.
      return (
        <>
          <g className="icon__stroke">
            <path d="M3 11l9-8 9 8" />
            <path d="M5 10v10h5v-6h4v6h5V10" />
          </g>
          <g className="icon__filled" stroke="none" fill="currentColor">
            <path d="M12 2.6 2.5 11a1 1 0 0 0 1.3 1.5l.7-.6V20a1 1 0 0 0 1 1h4v-6h5v6h4a1 1 0 0 0 1-1v-8.1l.7.6A1 1 0 0 0 21.5 11L12 2.6z" />
          </g>
        </>
      );
    case 'prev':
      // Chevron-left (single) for previous chapter — distinct from `back`'s
      // full arrow so the toolbar reads "go to previous chapter" not "exit".
      return (
        <>
          <g className="icon__stroke">
            <path d="M15 6l-6 6 6 6" />
          </g>
          <g className="icon__filled" stroke="none" fill="currentColor">
            <path d="M15.7 5.3a1 1 0 0 0-1.4 0l-6 6a1 1 0 0 0 0 1.4l6 6a1 1 0 0 0 1.4-1.4L10.4 12l5.3-5.3a1 1 0 0 0 0-1.4z" />
          </g>
        </>
      );
    case 'next':
      // Chevron-right, mirror of `prev`.
      return (
        <>
          <g className="icon__stroke">
            <path d="M9 6l6 6-6 6" />
          </g>
          <g className="icon__filled" stroke="none" fill="currentColor">
            <path d="M8.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4L13.6 12 8.3 6.7a1 1 0 0 1 0-1.4z" />
          </g>
        </>
      );
    case 'cfg':
      // Gear / cog. Filled variant uses a solid disc with cutouts.
      return (
        <>
          <g className="icon__stroke">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
            <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5z" />
          </g>
          <g className="icon__filled" stroke="none" fill="currentColor">
            <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" fillRule="evenodd" />
          </g>
        </>
      );
    case 'bookmark':
      // Ribbon. Filled = current page is bookmarked.
      return (
        <>
          <g className="icon__stroke">
            <path d="M6 3h12v18l-6-4-6 4V3z" />
          </g>
          <g className="icon__filled" stroke="none" fill="currentColor">
            <path d="M6 2a1 1 0 0 0-1 1v18a1 1 0 0 0 1.55.83L12 18.2l5.45 3.63A1 1 0 0 0 19 21V3a1 1 0 0 0-1-1H6z" />
          </g>
        </>
      );
  }
}
