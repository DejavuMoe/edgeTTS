/*
 * What a voice says when previewed: a line in its own language, so it is heard as it will
 * sound. Lines are chosen by exact locale first (written Chinese differs by region), then by
 * language. They use no names, which other scripts would read letter by letter.
 */
const SIMPLIFIED_CHINESE = "你好，很高兴认识你。这就是我的声音。";

const SAMPLE_LINES: Readonly<Record<string, string>> = {
  zh: SIMPLIFIED_CHINESE,
  wuu: SIMPLIFIED_CHINESE,
  "zh-TW": "你好，很高興認識你。這就是我的聲音。",
  "zh-HK": "你好，好高興認識你。呢個就係我嘅聲音。",
  yue: "你好，好高兴认识你。呢个就系我嘅声音。",
  en: "Hello, nice to meet you. This is what my voice sounds like.",
  ja: "こんにちは、はじめまして。これが私の声です。",
  ko: "안녕하세요, 만나서 반갑습니다. 이것이 제 목소리입니다.",
  fr: "Bonjour et bienvenue. Voici à quoi ressemble ma voix.",
  de: "Hallo, schön, Sie kennenzulernen. So klingt meine Stimme.",
  es: "Hola, ¿qué tal? Así suena mi voz.",
  it: "Ciao, piacere di conoscerti. Questa è la mia voce.",
  pt: "Olá, muito prazer. Esta é a minha voz.",
  ru: "Здравствуйте! Вот так звучит мой голос.",
  uk: "Вітаю! Ось так звучить мій голос.",
  pl: "Dzień dobry! Tak brzmi mój głos.",
  nl: "Hallo, leuk je te ontmoeten. Zo klinkt mijn stem.",
  sv: "Hej och välkommen! Så här låter min röst.",
  tr: "Merhaba, tanıştığıma memnun oldum. İşte benim sesim.",
  ar: "مرحبًا، يسعدني لقاؤك. هكذا يبدو صوتي.",
  he: "שלום, נעים להכיר. כך נשמע הקול שלי.",
  hi: "नमस्ते, आपसे मिलकर खुशी हुई। मेरी आवाज़ ऐसी सुनाई देती है।",
  th: "สวัสดี ยินดีที่ได้รู้จัก นี่คือเสียงของฉัน",
  vi: "Xin chào, rất vui được gặp bạn. Đây là giọng nói của tôi.",
  id: "Halo, senang bertemu dengan Anda. Beginilah suara saya.",
  ms: "Helo, gembira berjumpa dengan anda. Inilah suara saya.",
};

/** A fixed date, so a language without its own line still says the same thing each time. */
const SAMPLE_DATE = new Date(Date.UTC(2024, 4, 1, 12));

/**
 * For the languages without a line: the language's own name and a date written in it, both
 * from the browser's locale data, so every voice still speaks its own language.
 */
function localeDataLine(locale: string): string | null {
  try {
    const language = new Intl.DisplayNames([locale], { type: "language", fallback: "none" }).of(
      locale,
    );
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(
      SAMPLE_DATE,
    );
    return language ? `${language}. ${date}` : date;
  } catch {
    return null;
  }
}

/** The line a voice of this locale reads when previewed. */
export function voiceSampleText(locale: string): string {
  const language = locale.split("-")[0] ?? locale;
  return (
    SAMPLE_LINES[locale] ?? SAMPLE_LINES[language] ?? localeDataLine(locale) ?? SAMPLE_LINES.en!
  );
}
