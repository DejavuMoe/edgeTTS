import { describe, it, expect } from "vitest";
import { toEdgeProsody } from "../src/prosody.js";

describe("toEdgeProsody", () => {
  describe("defaults", () => {
    it("uses default values when prosody is undefined", () => {
      const result = toEdgeProsody(undefined);
      expect(result.rate).toBe(1.0);
      expect(result.pitch).toBe("+0st");
      expect(result.volume).toBe(100.0);
    });

    it("uses default values for omitted individual properties", () => {
      expect(toEdgeProsody({}).rate).toBe(1.0);
      expect(toEdgeProsody({}).pitch).toBe("+0st");
      expect(toEdgeProsody({}).volume).toBe(100.0);
    });
  });

  describe("explicit controls", () => {
    it("maps valid custom controls correctly", () => {
      const result = toEdgeProsody({
        speed: 1.25,
        pitchSemitones: 2,
        volume: 0.8,
      });
      expect(result.rate).toBe(1.25);
      expect(result.pitch).toBe("+2st");
      expect(result.volume).toBe(80);
    });

    it("maps negative pitch correctly", () => {
      const result = toEdgeProsody({ pitchSemitones: -3.5 });
      expect(result.pitch).toBe("-3.5st");
    });

    it("maps 0 and -0 pitch to +0st", () => {
      expect(toEdgeProsody({ pitchSemitones: 0 }).pitch).toBe("+0st");
      expect(toEdgeProsody({ pitchSemitones: -0 }).pitch).toBe("+0st");
    });

    it("preserves decimal volume without rounding to integer", () => {
      const result = toEdgeProsody({ volume: 0.755 });
      expect(result.volume).toBe(75.5);
    });
  });

  describe("boundary acceptance", () => {
    it("accepts speed boundaries 0.5 and 2.0", () => {
      expect(toEdgeProsody({ speed: 0.5 }).rate).toBe(0.5);
      expect(toEdgeProsody({ speed: 2.0 }).rate).toBe(2.0);
    });

    it("accepts pitchSemitones boundaries -12 and 12", () => {
      expect(toEdgeProsody({ pitchSemitones: -12 }).pitch).toBe("-12st");
      expect(toEdgeProsody({ pitchSemitones: 12 }).pitch).toBe("+12st");
    });

    it("accepts volume boundaries 0 and 1", () => {
      expect(toEdgeProsody({ volume: 0 }).volume).toBe(0);
      expect(toEdgeProsody({ volume: 1 }).volume).toBe(100);
    });
  });

  describe("invalid speed validation", () => {
    it("rejects speed below 0.5 with RangeError", () => {
      expect(() => toEdgeProsody({ speed: 0.49 })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ speed: 0.49 })).toThrowError("speed must be between 0.5 and 2");
    });

    it("rejects speed above 2.0 with RangeError", () => {
      expect(() => toEdgeProsody({ speed: 2.01 })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ speed: 2.01 })).toThrowError("speed must be between 0.5 and 2");
    });

    it("rejects non-finite speed values", () => {
      expect(() => toEdgeProsody({ speed: NaN })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ speed: Infinity })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ speed: -Infinity })).toThrowError(RangeError);
    });
  });

  describe("invalid pitchSemitones validation", () => {
    it("rejects pitch below -12 with RangeError", () => {
      expect(() => toEdgeProsody({ pitchSemitones: -12.01 })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ pitchSemitones: -12.01 })).toThrowError(
        "pitchSemitones must be between -12 and 12",
      );
    });

    it("rejects pitch above 12 with RangeError", () => {
      expect(() => toEdgeProsody({ pitchSemitones: 12.01 })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ pitchSemitones: 12.01 })).toThrowError(
        "pitchSemitones must be between -12 and 12",
      );
    });

    it("rejects non-finite pitchSemitones values", () => {
      expect(() => toEdgeProsody({ pitchSemitones: NaN })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ pitchSemitones: Infinity })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ pitchSemitones: -Infinity })).toThrowError(RangeError);
    });
  });

  describe("invalid volume validation", () => {
    it("rejects volume below 0 with RangeError", () => {
      expect(() => toEdgeProsody({ volume: -0.01 })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ volume: -0.01 })).toThrowError("volume must be between 0 and 1");
    });

    it("rejects volume above 1 with RangeError", () => {
      expect(() => toEdgeProsody({ volume: 1.01 })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ volume: 1.01 })).toThrowError("volume must be between 0 and 1");
    });

    it("rejects non-finite volume values", () => {
      expect(() => toEdgeProsody({ volume: NaN })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ volume: Infinity })).toThrowError(RangeError);
      expect(() => toEdgeProsody({ volume: -Infinity })).toThrowError(RangeError);
    });
  });
});
