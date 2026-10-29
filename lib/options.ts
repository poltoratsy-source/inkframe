import type { StartSettings, StyleId } from './engine/types';
import { STYLE_IDS, STYLE_PACKS } from './styles';
import { asset } from './site';

// What the start screen offers. `soon` options are shown but can't be picked yet.
export interface Choice<T> { value: T; label: string; soon?: boolean }

/** The styles a cartoon can be painted in: the style packs (lib/styles.ts), each with a real frame of its own as the
 *  preview. Only packs that exist are listed — the earlier «скоро» cards (kinetic type, Reels, product ads, science,
 *  marker board, music clip) were other products, not styles of this painter, and Reels is now the 9:16 format. */
export const STYLES: { id: StyleId; title: string; text: string; thumb: string; soon?: boolean }[] = STYLE_IDS.map(id => ({
  id, title: STYLE_PACKS[id].name.ru, text: STYLE_PACKS[id].line.ru, thumb: asset(STYLE_PACKS[id].preview),
}));

export const OPTIONS = {
  duration: [
    { value: 15, label: '15 с' }, { value: 30, label: '30 с' }, { value: 60, label: '60 с' }, { value: 120, label: '2 мин' },
  ] as Choice<number>[],
  format: [
    { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' },
  ] as Choice<StartSettings['format']>[],
  voice: [
    { value: 'svetlana', label: 'Светлана' }, { value: 'dmitry', label: 'Дмитрий' },
    { value: 'duo', label: 'два героя', soon: true }, { value: 'none', label: 'без голоса' },
  ] as Choice<StartSettings['voice']>[],
  hero: [
    { value: 'claude', label: 'Клод' }, { value: 'photo', label: 'по моему фото', soon: true }, { value: 'none', label: 'без героя' },
  ] as Choice<StartSettings['hero']>[],
  audience: [
    { value: 'kids', label: 'дети' }, { value: 'school', label: 'школьники' }, { value: 'adults', label: 'взрослые' }, { value: 'clients', label: 'клиенты' },
  ] as Choice<StartSettings['audience']>[],
  music: [
    { value: 'calm', label: 'спокойная' }, { value: 'upbeat', label: 'бодрая' }, { value: 'own', label: 'своя', soon: true }, { value: 'none', label: 'без' },
  ] as Choice<StartSettings['music']>[],
  language: [
    { value: 'ru', label: 'русский' }, { value: 'en', label: 'English' }, { value: 'kk', label: 'қазақша' },
  ] as Choice<StartSettings['language']>[],
  ending: [
    { value: 'codeword', label: 'кодовое слово' }, { value: 'subscribe', label: 'подписка' }, { value: 'none', label: 'без' },
  ] as Choice<StartSettings['ending']>[],
};

export const OPTION_TITLES: Record<keyof typeof OPTIONS, string> = {
  duration: 'Длительность', format: 'Формат', voice: 'Голос', hero: 'Герой',
  audience: 'Для кого', music: 'Музыка', language: 'Язык', ending: 'Концовка',
};

export const EXAMPLES = [
  'Короткий мультфильм: Клод объясняет, почему небо голубое',
  'Как работает лидар — для школьников, весело',
  'Как зарождался ИИ — за 2 минуты',
  'Открытка маме на день рождения',
  'Почему кошки мурчат',
];

export const DEFAULT_SETTINGS: StartSettings = {
  idea: '', style: 'watercolor', duration: 15, format: '16:9', voice: 'svetlana', hero: 'claude',
  audience: 'school', music: 'upbeat', language: 'ru', ending: 'codeword',
};

export const VOICE_NAMES: Record<StartSettings['voice'], string> = { svetlana: 'Светлана', dmitry: 'Дмитрий', duo: 'два героя', none: 'без голоса' };
export const MUSIC_NAMES: Record<StartSettings['music'], string> = { calm: 'спокойная', upbeat: 'бодрая', own: 'своя', none: 'без музыки' };
