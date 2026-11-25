import type { UiLocale } from "../i18n.js";

/**
 * Names for catalog locales that Intl.DisplayNames does not know: Microsoft's regional
 * Mandarin voices and Inuktitut, which browsers leave unnamed. They are used ahead of Intl so
 * every browser shows the same name. The Mandarin names follow Microsoft's voice gallery.
 */
export const LOCALE_NAME_OVERRIDES: Readonly<Record<string, Readonly<Record<UiLocale, string>>>> = {
  "zh-CN-liaoning": {
    "zh-CN": "中文（东北官话，辽宁）",
    "zh-TW": "中文（東北官話，遼寧）",
    en: "Chinese (Northeastern Mandarin, Liaoning)",
    ja: "中国語 (東北官話、遼寧)",
  },
  "zh-CN-shaanxi": {
    "zh-CN": "中文（中原官话，陕西）",
    "zh-TW": "中文（中原官話，陝西）",
    en: "Chinese (Zhongyuan Mandarin, Shaanxi)",
    ja: "中国語 (中原官話、陝西)",
  },
  "iu-Cans-CA": {
    "zh-CN": "因纽特语（音节文字，加拿大）",
    "zh-TW": "因紐特文（音節文字，加拿大）",
    en: "Inuktitut (Syllabics, Canada)",
    ja: "イヌクティトゥット語 (音節文字、カナダ)",
  },
  "iu-Latn-CA": {
    "zh-CN": "因纽特语（拉丁字母，加拿大）",
    "zh-TW": "因紐特文（拉丁字母，加拿大）",
    en: "Inuktitut (Latin, Canada)",
    ja: "イヌクティトゥット語 (ラテン文字、カナダ)",
  },
};

/**
 * What people call a locale's speech when that is not in its display name: "粤语" is not in
 * "中文（香港）", nor "东北话" in a Liaoning voice's. Simplified and traditional Chinese,
 * English and Japanese spellings, matched as substrings.
 */
export const LOCALE_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "zh-CN": ["普通话", "普通話", "汉语", "漢語", "国语", "Mandarin", "Putonghua", "標準語"],
  "zh-TW": ["国语", "國語", "华语", "華語", "台湾华语", "臺灣華語", "Taiwanese Mandarin"],
  "zh-HK": ["粤语", "粵語", "广东话", "廣東話", "白话", "白話", "Cantonese", "広東語"],
  "zh-CN-liaoning": ["东北话", "東北話", "辽宁话", "遼寧話", "Dongbei", "東北方言"],
  "zh-CN-shaanxi": ["陕西话", "陝西話", "关中话", "關中話", "陝西方言"],
};
