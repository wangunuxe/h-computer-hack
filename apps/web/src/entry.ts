import { shouldShowcase } from './device.js';

if (shouldShowcase({ pathname: location.pathname, search: location.search,
  userAgent: navigator.userAgent, coarsePointer: matchMedia('(any-pointer: coarse)').matches })) {
  location.replace('/showcase.html');
} else {
  void import('./main.js');
}
