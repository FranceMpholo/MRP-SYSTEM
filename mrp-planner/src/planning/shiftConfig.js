// Plant shift times supplied by the user. No break duration has been supplied.
export const SHIFT_CONFIG = {
  'SHIFT 01': { name: 'Morning', start: '06:00', end: '15:00', breaks: null },
  'SHIFT 02': { name: 'Afternoon', start: '15:00', end: '22:00', breaks: null },
  'SHIFT 03': { name: 'Night', start: '22:00', end: '06:00', breaks: null },
};
export const defaultOeeSettings = () => Object.fromEntries(['blowMoulding', 'thermoforming'].map(line => [line, structuredClone(SHIFT_CONFIG)]));
