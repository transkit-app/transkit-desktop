import { languageList } from './language';

export const VOICE_INPUT_TARGET_LANGUAGES = languageList;

export const LEGACY_VOICE_LANGUAGE_ALIASES = {
    zh: 'zh_cn',
    pt: 'pt_pt',
};

export function normalizeVoiceLanguageToAppKey(language) {
    if (!language || language === 'auto' || language === 'none') return language;
    return LEGACY_VOICE_LANGUAGE_ALIASES[language] ?? language;
}

export function normalizeAppLanguageToVoiceCode(language) {
    if (!language || language === 'auto' || language === 'none') return language;

    const appLanguage = normalizeVoiceLanguageToAppKey(language);
    const mapped = {
        zh_cn: 'zh',
        zh_tw: 'zh',
        pt_pt: 'pt',
        pt_br: 'pt',
        mn_mo: 'mn',
        mn_cy: 'mn',
    };

    return mapped[appLanguage] ?? appLanguage;
}
