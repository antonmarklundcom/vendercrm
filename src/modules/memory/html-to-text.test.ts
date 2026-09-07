import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  it("strips tags and collapses whitespace", () => {
    expect(htmlToText("<p>Hola   <b>mundo</b></p>")).toBe("Hola mundo");
  });

  it("drops script and style blocks entirely, including their content", () => {
    const html = "<style>.x{color:red}</style><p>Texto</p><script>alert(1)</script>";
    expect(htmlToText(html)).toBe("Texto");
  });

  it("unescapes &nbsp; and &amp;", () => {
    expect(htmlToText("Uno&nbsp;&amp;&nbsp;Dos")).toBe("Uno & Dos");
  });

  it("returns an empty string for markup with no text", () => {
    expect(htmlToText("<div><img src='x'/></div>")).toBe("");
  });
});
