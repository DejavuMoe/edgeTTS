import { describe, it, expect } from "vitest";
import { escapeXmlText } from "../src/xml.js";

describe("escapeXmlText", () => {
  it("escapes all five special XML characters", () => {
    const input = `Tom & Jerry <test> "hello" 'world'`;
    const expected = "Tom &amp; Jerry &lt;test&gt; &quot;hello&quot; &apos;world&apos;";
    expect(escapeXmlText(input)).toBe(expected);
  });

  it("escapes markup and tags so they cannot act as SSML elements", () => {
    expect(escapeXmlText("<script>")).toBe("&lt;script&gt;");
    expect(escapeXmlText("<speak>")).toBe("&lt;speak&gt;");
    expect(escapeXmlText('<break time="10s"/>')).toBe("&lt;break time=&quot;10s&quot;/&gt;");
  });

  it("leaves text without special characters unchanged", () => {
    const plain = "Hello, world! 123 中文测试";
    expect(escapeXmlText(plain)).toBe(plain);
  });

  it("handles repeated special characters without double escaping", () => {
    expect(escapeXmlText("&&<<>>\"\"''")).toBe(
      "&amp;&amp;&lt;&lt;&gt;&gt;&quot;&quot;&apos;&apos;",
    );
  });
});
