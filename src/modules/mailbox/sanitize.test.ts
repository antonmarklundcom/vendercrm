import { describe, expect, it } from "vitest";
import { allowRemoteImages, hasBlockedImages, sanitizeEmailHtml } from "./sanitize";

describe("sanitizeEmailHtml", () => {
  it("removes scripts, handlers, iframes, forms and javascript: links", () => {
    const html = sanitizeEmailHtml(
      '<p onclick="x()">Hola<script>alert(1)</script></p><iframe src="https://x"></iframe>' +
        '<form><input name="p"></form><a href="javascript:alert(1)">x</a><style>body{}</style>',
    );
    expect(html).not.toMatch(/script|onclick|iframe|<form|<input|javascript:|<style/i);
    expect(html).toContain("<p>Hola</p>");
  });

  it("blocks remote images by default and can restore them", () => {
    const html = sanitizeEmailHtml('<img src="https://tracker.example/p.gif" alt="logo">');
    expect(html).not.toMatch(/\ssrc=/);
    expect(hasBlockedImages(html)).toBe(true);
    expect(allowRemoteImages(html)).toContain('src="https://tracker.example/p.gif"');
  });

  it("keeps inline cid: images and opens links in a new tab safely", () => {
    const html = sanitizeEmailHtml('<img src="cid:logo@x"><a href="https://a.test">a</a>');
    expect(html).toContain('src="cid:logo@x"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it("drops style values that could load things", () => {
    const html = sanitizeEmailHtml('<p style="background-image:url(https://x/t.gif);color:red">a</p>');
    expect(html).not.toContain("url(");
    expect(html).toContain("color:red");
  });
});
