import { useEffect, useState } from 'react';

export type Route =
  | { screen: 'home' }
  | { screen: 'series'; seriesId: string }
  | { screen: 'reader'; seriesId: string; chapterId: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'series' && parts[1]) {
    return { screen: 'series', seriesId: parts[1] };
  }
  if (parts[0] === 'read' && parts[1] && parts[2]) {
    return { screen: 'reader', seriesId: parts[1], chapterId: parts[2] };
  }
  return { screen: 'home' };
}

export function navigate(route: Route): void {
  switch (route.screen) {
    case 'home':
      window.location.hash = '#/';
      break;
    case 'series':
      window.location.hash = `#/series/${route.seriesId}`;
      break;
    case 'reader':
      window.location.hash = `#/read/${route.seriesId}/${route.chapterId}`;
      break;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const handler = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return route;
}
