import { describe, expect, it, vi } from "vitest";

// gmail.ts imports the extension API alias; give it a minimal browser global.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).browser = { storage: {}, identity: { getRedirectURL: () => "https://abc123.extensions.allizom.org/" } };
});

import { buildAuthUrl, decodeEntities, GMAIL_QUERY, GMAIL_SCOPE, GmailError, listUrl, messageUrl, parseAuthRedirect, parseFrom, redirectUri, toRawMail } from "../src/background/gmail";

describe("Gmail OAuth (implicit flow)", () => {
  it("builds the authorization URL", () => {
    const u = new URL(buildAuthUrl({ clientId: " 123-abc.apps.googleusercontent.com ", redirectUri: "https://abc123.extensions.allizom.org/", state: "s1" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "123-abc.apps.googleusercontent.com",
      response_type: "token",
      redirect_uri: "https://abc123.extensions.allizom.org/",
      scope: GMAIL_SCOPE,
      state: "s1",
      prompt: "consent",
    });
    expect(new URL(buildAuthUrl({ clientId: "x", redirectUri: "r", state: "s", silent: true })).searchParams.get("prompt")).toBe("none");
  });

  it("reads the token from the redirect fragment", () => {
    const now = 1_000_000;
    const tok = parseAuthRedirect("https://abc123.extensions.allizom.org/#state=s1&access_token=ya29.tok&token_type=Bearer&expires_in=3599&scope=https://www.googleapis.com/auth/gmail.readonly", "s1", now);
    expect(tok).toEqual({ token: "ya29.tok", expiresAt: now + 3539_000 });
  });

  it("reports OAuth errors and state mismatches plainly", () => {
    expect(() => parseAuthRedirect("https://abc123.extensions.allizom.org/#error=access_denied&state=s1", "s1")).toThrow(/denied/);
    expect(() => parseAuthRedirect("https://abc123.extensions.allizom.org/?error=invalid_client", "s1")).toThrow(/client ID/);
    expect(() => parseAuthRedirect("https://abc123.extensions.allizom.org/#access_token=t&state=evil", "s1")).toThrow(GmailError);
    expect(() => parseAuthRedirect("https://abc123.extensions.allizom.org/#state=s1", "s1")).toThrow(/access token/);
    expect(() => parseAuthRedirect("not a url", "s1")).toThrow(GmailError);
  });

  it("uses the browser's redirect URL", () => {
    expect(redirectUri()).toBe("https://abc123.extensions.allizom.org/");
  });
});

describe("Gmail API requests", () => {
  it("lists recent job mail", () => {
    const u = new URL(listUrl());
    expect(u.origin + u.pathname).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    expect(u.searchParams.get("q")).toBe(GMAIL_QUERY);
    expect(u.searchParams.get("q")).toMatch(/^newer_than:30d \(application OR applying OR interview/);
    expect(u.searchParams.get("maxResults")).toBe("50");
  });

  it("fetches metadata only", () => {
    const u = new URL(messageUrl("18b2f0c1a0000001"));
    expect(u.pathname).toBe("/gmail/v1/users/me/messages/18b2f0c1a0000001");
    expect(u.searchParams.get("format")).toBe("metadata");
    expect(u.searchParams.getAll("metadataHeaders")).toEqual(["From", "Subject", "Date"]);
  });

  it("turns a message into RawMail", () => {
    const m = toRawMail({
      id: "18b2f0c1a0000001",
      threadId: "18b2f0c1a0000001",
      snippet: "Hi Ada, we&#39;d love to schedule a call &amp; chat. ",
      internalDate: "1791734400000",
      payload: {
        headers: [
          { name: "From", value: '"Acme Robotics" <No-Reply@Acme.com>' },
          { name: "Subject", value: "Next steps" },
          { name: "Date", value: "Mon, 12 Oct 2026 09:00:00 +0000" },
        ],
      },
    });
    expect(m).toEqual({ messageId: "18b2f0c1a0000001", from: "Acme Robotics", fromEmail: "no-reply@acme.com", subject: "Next steps", snippet: "Hi Ada, we'd love to schedule a call & chat.", receivedAt: 1791734400000 });
  });

  it("parses From headers and HTML entities", () => {
    expect(parseFrom("Jane Doe <jane@globex.com>")).toEqual({ name: "Jane Doe", email: "jane@globex.com" });
    expect(parseFrom("jobs@initech.com")).toEqual({ name: "", email: "jobs@initech.com" });
    expect(parseFrom("<jobs@initech.com>")).toEqual({ name: "jobs@initech.com", email: "jobs@initech.com" });
    expect(decodeEntities("&lt;b&gt; &quot;hi&quot; &#x2019; &nbsp;&bogus;")).toBe('<b> "hi" ’  &bogus;');
  });
});
