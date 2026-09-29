import type { VoiceDto } from "@edgetts/shared";

/**
 * Who a voice looks like in its avatar. Edge voices carry only a locale and a gender, so the
 * portrait is drawn from those: the locale picks a palette of skin tones and hair colours that
 * people speaking that language in that region commonly have, and the gender picks the
 * haircuts. Each palette spans a range rather than one "typical" face, and the voice ID seeds
 * the pick inside it, so neighbours in a list still look like different people.
 */
export interface VoicePersona {
  readonly heritage: Heritage;
  readonly skinColors: readonly string[];
  readonly hairColors: readonly string[];
  /** Dylan hair variants with relative weights. */
  readonly hairStyles: Readonly<Record<string, number>>;
  /** Chance (0–100) of stubble. */
  readonly facialHairProbability: number;
}

export type Heritage =
  | "eastAsian"
  | "southeastAsian"
  | "southAsian"
  | "centralAsian"
  | "middleEastern"
  | "african"
  | "nordic"
  | "celtic"
  | "westEuropean"
  | "southEuropean"
  | "eastEuropean"
  | "latinAmerican"
  | "caribbean"
  | "southAfrican"
  | "arctic"
  | "multicultural";

// Skin tones from fair to deep, tuned for Dylan's flat fills and black outlines.
const SKIN = {
  fair: "#ffdfcc",
  light: "#f6cfb0",
  warm: "#efc09a",
  olive: "#dcaa7e",
  tan: "#c68a5c",
  brown: "#9b623f",
  deep: "#6e4128",
  ebony: "#4d2c1c",
} as const;

const HAIR = {
  black: "#1f1a17",
  darkBrown: "#3d2618",
  brown: "#6a4027",
  auburn: "#8e3b22",
  ginger: "#c0592b",
  blonde: "#e2b85a",
  platinum: "#e8cc85",
} as const;

interface Palette {
  readonly skin: readonly string[];
  readonly hair: readonly string[];
  /** Hair texture, which shifts the haircut weights towards curls or straight cuts. */
  readonly texture: "straight" | "mixed" | "curly";
}

const PALETTES: Record<Heritage, Palette> = {
  eastAsian: {
    skin: [SKIN.light, SKIN.warm],
    hair: [HAIR.black, HAIR.darkBrown],
    texture: "straight",
  },
  southeastAsian: {
    skin: [SKIN.warm, SKIN.olive, SKIN.tan],
    hair: [HAIR.black, HAIR.darkBrown],
    texture: "straight",
  },
  southAsian: {
    skin: [SKIN.olive, SKIN.tan, SKIN.brown],
    hair: [HAIR.black, HAIR.darkBrown],
    texture: "mixed",
  },
  centralAsian: {
    skin: [SKIN.light, SKIN.warm, SKIN.olive],
    hair: [HAIR.black, HAIR.darkBrown],
    texture: "straight",
  },
  middleEastern: {
    skin: [SKIN.light, SKIN.olive, SKIN.tan],
    hair: [HAIR.black, HAIR.darkBrown, HAIR.brown],
    texture: "mixed",
  },
  african: { skin: [SKIN.brown, SKIN.deep, SKIN.ebony], hair: [HAIR.black], texture: "curly" },
  nordic: {
    skin: [SKIN.fair, SKIN.light],
    hair: [HAIR.platinum, HAIR.blonde, HAIR.brown],
    texture: "straight",
  },
  celtic: {
    skin: [SKIN.fair, SKIN.light],
    hair: [HAIR.ginger, HAIR.auburn, HAIR.brown, HAIR.blonde],
    texture: "mixed",
  },
  westEuropean: {
    skin: [SKIN.fair, SKIN.light],
    hair: [HAIR.blonde, HAIR.brown, HAIR.darkBrown, HAIR.auburn],
    texture: "mixed",
  },
  southEuropean: {
    skin: [SKIN.light, SKIN.warm, SKIN.olive],
    hair: [HAIR.darkBrown, HAIR.black, HAIR.brown],
    texture: "mixed",
  },
  eastEuropean: {
    skin: [SKIN.fair, SKIN.light],
    hair: [HAIR.brown, HAIR.blonde, HAIR.darkBrown],
    texture: "straight",
  },
  latinAmerican: {
    skin: [SKIN.light, SKIN.olive, SKIN.tan, SKIN.brown],
    hair: [HAIR.black, HAIR.darkBrown, HAIR.brown],
    texture: "mixed",
  },
  caribbean: {
    skin: [SKIN.olive, SKIN.tan, SKIN.brown, SKIN.deep],
    hair: [HAIR.black, HAIR.darkBrown],
    texture: "curly",
  },
  southAfrican: {
    skin: [SKIN.fair, SKIN.light, SKIN.tan, SKIN.brown],
    hair: [HAIR.brown, HAIR.darkBrown, HAIR.black, HAIR.blonde],
    texture: "mixed",
  },
  arctic: { skin: [SKIN.warm, SKIN.olive], hair: [HAIR.black], texture: "straight" },
  multicultural: {
    skin: [SKIN.fair, SKIN.light, SKIN.warm, SKIN.olive, SKIN.tan, SKIN.brown, SKIN.deep],
    hair: [HAIR.black, HAIR.darkBrown, HAIR.brown, HAIR.blonde, HAIR.auburn],
    texture: "mixed",
  },
};

/** Languages that point at one heritage wherever they are spoken, e.g. Tamil in Singapore. */
const LANGUAGE_HERITAGE: Readonly<Record<string, Heritage>> = {
  zh: "eastAsian",
  ja: "eastAsian",
  ko: "eastAsian",
  mn: "eastAsian",
  vi: "southeastAsian",
  th: "southeastAsian",
  lo: "southeastAsian",
  km: "southeastAsian",
  my: "southeastAsian",
  id: "southeastAsian",
  jv: "southeastAsian",
  su: "southeastAsian",
  ms: "southeastAsian",
  fil: "southeastAsian",
  hi: "southAsian",
  bn: "southAsian",
  ur: "southAsian",
  ta: "southAsian",
  te: "southAsian",
  kn: "southAsian",
  ml: "southAsian",
  mr: "southAsian",
  gu: "southAsian",
  ne: "southAsian",
  si: "southAsian",
  kk: "centralAsian",
  uz: "centralAsian",
  ps: "centralAsian",
  ar: "middleEastern",
  fa: "middleEastern",
  he: "middleEastern",
  tr: "middleEastern",
  az: "middleEastern",
  am: "african",
  so: "african",
  sw: "african",
  zu: "african",
  af: "southAfrican",
  da: "nordic",
  sv: "nordic",
  nb: "nordic",
  fi: "nordic",
  is: "nordic",
  et: "nordic",
  lv: "nordic",
  lt: "nordic",
  ga: "celtic",
  cy: "celtic",
  de: "westEuropean",
  nl: "westEuropean",
  it: "southEuropean",
  el: "southEuropean",
  ca: "southEuropean",
  gl: "southEuropean",
  mt: "southEuropean",
  sq: "southEuropean",
  ka: "southEuropean",
  ru: "eastEuropean",
  uk: "eastEuropean",
  pl: "eastEuropean",
  cs: "eastEuropean",
  sk: "eastEuropean",
  sl: "eastEuropean",
  hr: "eastEuropean",
  bs: "eastEuropean",
  sr: "eastEuropean",
  mk: "eastEuropean",
  bg: "eastEuropean",
  ro: "eastEuropean",
  hu: "eastEuropean",
  iu: "arctic",
};

/** For languages spoken across continents (English, Spanish, French, Portuguese). */
const REGION_HERITAGE: Readonly<Record<string, Heritage>> = {
  US: "multicultural",
  CA: "multicultural",
  GB: "multicultural",
  AU: "multicultural",
  NZ: "multicultural",
  ZA: "multicultural",
  IE: "celtic",
  FR: "westEuropean",
  BE: "westEuropean",
  CH: "westEuropean",
  ES: "southEuropean",
  PT: "southEuropean",
  IN: "southAsian",
  HK: "eastAsian",
  SG: "southeastAsian",
  PH: "southeastAsian",
  KE: "african",
  NG: "african",
  TZ: "african",
  GQ: "african",
  CU: "caribbean",
  DO: "caribbean",
  PR: "caribbean",
  MX: "latinAmerican",
  GT: "latinAmerican",
  HN: "latinAmerican",
  SV: "latinAmerican",
  NI: "latinAmerican",
  CR: "latinAmerican",
  PA: "latinAmerican",
  CO: "latinAmerican",
  VE: "latinAmerican",
  EC: "latinAmerican",
  PE: "latinAmerican",
  BO: "latinAmerican",
  CL: "latinAmerican",
  AR: "latinAmerican",
  UY: "latinAmerican",
  PY: "latinAmerican",
  BR: "latinAmerican",
};

/** Languages whose heritage depends on where they are spoken. */
const REGIONAL_LANGUAGES = new Set(["en", "es", "fr", "pt"]);

function localeParts(locale: string): { language: string; region: string | null } {
  const [language = "", ...rest] = locale.split(/[-_]/);
  // "iu-Latn-CA" and "zh-CN-liaoning" both name their region as the first two-letter subtag.
  const region = rest.find((part) => /^[a-z]{2}$/i.test(part));
  return { language: language.toLowerCase(), region: region?.toUpperCase() ?? null };
}

export function voiceHeritage(locale: string): Heritage {
  const { language, region } = localeParts(locale);
  const byRegion = region ? REGION_HERITAGE[region] : undefined;
  if (REGIONAL_LANGUAGES.has(language) && byRegion) return byRegion;
  return LANGUAGE_HERITAGE[language] ?? byRegion ?? "multicultural";
}

const HAIR_STYLES = {
  female: {
    straight: { bangs: 3, roundBob: 3, shaggy: 2, fluffy: 1, longCurls: 1 },
    mixed: { bangs: 2, roundBob: 2, shaggy: 2, fluffy: 2, longCurls: 2 },
    curly: { longCurls: 4, fluffy: 3, roundBob: 1, bangs: 1 },
  },
  male: {
    straight: { parting: 3, plain: 3, spiky: 2, wavy: 2, flatTop: 1 },
    mixed: { parting: 2, plain: 2, spiky: 2, wavy: 2, flatTop: 1, shortCurls: 1 },
    curly: { shortCurls: 4, flatTop: 3, plain: 2 },
  },
  neutral: {
    straight: { shaggy: 2, roundBob: 1, wavy: 1, plain: 1 },
    mixed: { shaggy: 2, fluffy: 1, wavy: 1, plain: 1 },
    curly: { fluffy: 2, shortCurls: 2, longCurls: 1 },
  },
} as const;

export function voicePersona(voice: Pick<VoiceDto, "locale" | "gender">): VoicePersona {
  const heritage = voiceHeritage(voice.locale);
  const palette = PALETTES[heritage];
  const gender =
    voice.gender === "Female" ? "female" : voice.gender === "Male" ? "male" : "neutral";
  return {
    heritage,
    skinColors: palette.skin,
    hairColors: palette.hair,
    hairStyles: HAIR_STYLES[gender][palette.texture],
    facialHairProbability: gender === "male" ? 25 : 0,
  };
}
