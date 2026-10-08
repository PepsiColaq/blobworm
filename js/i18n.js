import { loadState, patchState } from './storage.js';

const dict = {
  ru: {
    leaderboard: 'Топ игроков',
    score: 'Счёт',
    pause: 'Пауза',
    resume: 'Продолжить',
    quit: 'В меню',
    eaten: 'Тебя съели',
    again: 'Снова',
    match_end: 'Матч окончен',
    time_up: 'Время вышло (30 мин)',
    settings: 'Настройки',
    language: 'Язык',
    device: 'Устройство',
    pc: 'ПК',
    mobile: 'Телефон',
    sound: 'Звук',
    voice_default: 'Голосовой чат по умолчанию',
    mic: 'Микрофон',
    mic_default: 'По умолчанию',
    mic_key: 'Клавиша микрофона (ПК)',
    sensitivity: 'Чувствительность',
    quality: 'Качество',
    quality_high: 'Высокое',
    quality_medium: 'Среднее',
    quality_low: 'Низкое',
    game: 'Игра',
    bots: 'Ботов (обычная)',
    show_names: 'Показывать ники',
    minimap: 'Миникарта',
    minimap_left: 'Сверху слева',
    minimap_right: 'Сверху справа',
    ui_theme: 'Вид интерфейса',
    theme_polish: 'Новый (приятный)',
    theme_classic: 'Классический (бэкап)',
    phone: 'Телефон',
    joy_size: 'Размер джойстика',
    joy_opacity: 'Прозрачность джойстика',
    layout_open: 'Расположение кнопок…',
    layout_reset: 'Сбросить расположение',
    layout_title: 'Расположение кнопок',
    layout_hint: 'Тащи пальцем или мышью · потом «Сохранить»',
    cancel: 'Отмена',
    reset: 'Сброс',
    save: 'Сохранить',
    preview: 'Превью экрана',
    joystick: 'Джойстик',
    minimap_item: 'Карта',
    hint_blob: 'Space — Split · W — Eject · Q — Pulse',
    hint_worm: 'ЛКМ / Space — Boost · E — Инвиз с {n}+',
    inviz_need: 'Инвиз с {n} ({sc})',
    inviz_active: 'Инвиз {t}с',
    inviz_cd: 'Инвиз КД {t}с',
    inviz_ready: 'Инвиз готов (E)',
    eliminated: '{name} выбыл',
    mic_on: 'МИКРОФОН ВКЛ',
    voice_off: '🎤 Выкл',
  },
  en: {
    leaderboard: 'Leaderboard',
    score: 'Score',
    pause: 'Pause',
    resume: 'Resume',
    quit: 'Menu',
    eaten: 'You were eaten',
    again: 'Again',
    match_end: 'Match over',
    time_up: 'Time is up (30 min)',
    settings: 'Settings',
    language: 'Language',
    device: 'Device',
    pc: 'PC',
    mobile: 'Phone',
    sound: 'Sound',
    voice_default: 'Voice chat by default',
    mic: 'Microphone',
    mic_default: 'Default',
    mic_key: 'Mic key (PC)',
    sensitivity: 'Sensitivity',
    quality: 'Quality',
    quality_high: 'High',
    quality_medium: 'Medium',
    quality_low: 'Low',
    game: 'Game',
    bots: 'Bots (public)',
    show_names: 'Show names',
    minimap: 'Minimap',
    minimap_left: 'Top left',
    minimap_right: 'Top right',
    ui_theme: 'UI style',
    theme_polish: 'New (polished)',
    theme_classic: 'Classic (backup)',
    phone: 'Phone',
    joy_size: 'Joystick size',
    joy_opacity: 'Joystick opacity',
    layout_open: 'Button layout…',
    layout_reset: 'Reset layout',
    layout_title: 'Button layout',
    layout_hint: 'Drag with finger or mouse · then Save',
    cancel: 'Cancel',
    reset: 'Reset',
    save: 'Save',
    preview: 'Screen preview',
    joystick: 'Joystick',
    minimap_item: 'Map',
    hint_blob: 'Space — Split · W — Eject · Q — Pulse',
    hint_worm: 'LMB / Space — Boost · E — Invis from {n}+',
    inviz_need: 'Invis from {n} ({sc})',
    inviz_active: 'Invis {t}s',
    inviz_cd: 'Invis CD {t}s',
    inviz_ready: 'Invis ready (E)',
    eliminated: '{name} eliminated',
    mic_on: 'MIC ON',
    voice_off: '🎤 Off',
  },
};

export function getLang() {
  return loadState().lang === 'en' ? 'en' : 'ru';
}

export function setLang(lang) {
  patchState({ lang: lang === 'en' ? 'en' : 'ru' });
  applyI18n();
}

export function t(key, vars = {}) {
  const pack = dict[getLang()] || dict.ru;
  let s = pack[key] ?? dict.ru[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export function applyI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const text = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.placeholder != null) el.placeholder = text;
    } else {
      el.textContent = text;
    }
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  const lbTitle = document.querySelector('#leaderboard .lb-title');
  if (lbTitle) lbTitle.textContent = t('leaderboard');
}
