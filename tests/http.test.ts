import { describe, expect, it } from "vitest";
import { assertSameOrigin, errorResponse } from "../src/lib/server/http";

function request(
  headers: Record<string, string>,
  url = "http://0.0.0.0:3000/api/auth",
) {
  return new Request(url, { method: "POST", headers });
}

describe("request origin protection", () => {
  it.each([
    "localhost:3000",
    "127.0.0.1:3000",
    "192.168.1.10:3000",
    "[::1]:3000",
  ])(
    "accepts the actual browser host %s when Next.js uses its bind address",
    (host) => {
      expect(() =>
        assertSameOrigin(request({ host, origin: `http://${host}` })),
      ).not.toThrow();
    },
  );

  it("accepts HTTPS behind a reverse proxy", () => {
    expect(() =>
      assertSameOrigin(
        request({
          host: "internal:3000",
          "x-forwarded-host": "allya.example.com",
          "x-forwarded-proto": "https",
          origin: "https://allya.example.com",
        }),
      ),
    ).not.toThrow();
  });

  it("uses the first host and protocol in a forwarded chain", () => {
    expect(() =>
      assertSameOrigin(
        request({
          "x-forwarded-host": "allya.example.com, internal:3000",
          "x-forwarded-proto": "https, http",
          origin: "https://allya.example.com",
        }),
      ),
    ).not.toThrow();
  });

  it("falls back to the request URL without host headers", () => {
    expect(() =>
      assertSameOrigin(
        request(
          { origin: "https://allya.example.com" },
          "https://allya.example.com/api/auth",
        ),
      ),
    ).not.toThrow();
  });

  it.each([
    "https://attacker.example",
    "http://localhost:3001",
    "https://localhost:3000",
    "http://localhost:3000.attacker.example",
    "http://localhost:3000/extra",
    "null",
    "not-a-url",
  ])("rejects an untrusted or malformed origin: %s", (origin) => {
    expect(() =>
      assertSameOrigin(request({ host: "localhost:3000", origin })),
    ).toThrow("Origem da requisição não permitida.");
  });

  it("does not trust the internal URL or Host when the forwarded host differs", () => {
    expect(() =>
      assertSameOrigin(
        request({
          host: "0.0.0.0:3000",
          "x-forwarded-host": "allya.example.com",
          origin: "http://0.0.0.0:3000",
        }),
      ),
    ).toThrow();
  });

  it.each([
    "",
    "localhost:3000/path",
    "user@localhost:3000",
    "localhost:3000\\attacker.example",
  ])("rejects malformed host headers: %s", (host) => {
    expect(() =>
      assertSameOrigin(request({ host, origin: "http://localhost:3000" })),
    ).toThrow();
  });

  it("rejects cross-site browser requests even without Origin", () => {
    expect(() =>
      assertSameOrigin(request({ "sec-fetch-site": "cross-site" })),
    ).toThrow();
  });

  it("preserves non-browser requests without Origin", () => {
    expect(() => assertSameOrigin(request({}))).not.toThrow();
  });

  it("returns 403 for a forbidden origin", async () => {
    let error: unknown;
    try {
      assertSameOrigin(
        request({ host: "localhost:3000", origin: "https://attacker.example" }),
      );
    } catch (e) {
      error = e;
    }
    const response = errorResponse(error);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Origem da requisição não permitida.",
    });
  });
});
