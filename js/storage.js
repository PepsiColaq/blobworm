const KEY = 'blobworm_v1';

const defaults = {
  nick: 'Player',
  form: 'random',
  device: null, // 'pc' | 'mobile'
  uiTheme: 'polish', // 'polish' | 'classic'
  lang: 'ru', // 'ru' | 'en'
  settings: {
    sound: true,
    sensitivity: 1,
    quality: 'medium',
    bots: 10,
    showNames: true,
    joystickSize: 120,
    joystickOpacity: 0.55,
    voiceChat: true,
    minimapSide: 'left',
    micDeviceId: '',
    micKey: 'KeyV',
    micKeyLabel: 'V',
    mobileLayout: null, // { joy, a, b, c, mic: { left, bottom } in % }
    layoutEdit: false,
  },
  blobSkinId: 'doge',
  wormSkinId: 'nyan',
  customBlob: null,
  customWorm: null,
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaults);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaults),
      ...parsed,
      settings: { ...defaults.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return structuredClone(defaults);
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function patchState(partial) {
  const cur = loadState();
  const next = {
    ...cur,
    ...partial,
    settings: partial.settings ? { ...cur.settings, ...partial.settings } : cur.settings,
  };
  saveState(next);
  return next;
}
