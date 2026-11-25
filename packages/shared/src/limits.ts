// Limits and text helpers with no runtime dependencies, published as `@edgetts/shared/limits`.
// The browser bundle imports them from here: the package root also builds the Zod schemas
// when it loads, which would pull all of Zod into the page.
import { countCodePoints, MAX_VOICE_ID_LENGTH, VOICE_ID_REGEX } from "@edgetts/tts-core";

export { countCodePoints, MAX_VOICE_ID_LENGTH, VOICE_ID_REGEX };

export const MAX_NATIVE_INPUT_CODE_POINTS = 20_000;
