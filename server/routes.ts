import { registerReportRoutes } from "./reports";
import type { Express, Request } from "express";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { analyze, normalizeUrl } from "./analyze";
import type { ScoreResult } from "./analyze";
import { storage } from "./storage";
import { syncLead } from "./crm";
import type { Scan, Lead } from "@shared/schema";
import { normalizeSocialLink, SOCIAL_PLATFORMS, type SocialLinks } from "../shared/social-input";

// Simple in-memory cache so repeat lookups are instant and we stay polite
// to the sites we're evaluating.
const cache = new Map<string, { at: number; data: ScoreResult }>();
const TTL = 1000 * 60 * 30;

// Access key for the lead log. Override with the ADMIN_KEY env var.
/**
 * No fallback, deliberately.
 *
 * A literal default here is a published password: it is the same on every
 * deployment and it unlocks a table of names, work emails and phone numbers.
 * If ADMIN_KEY is not set, the admin endpoints refuse every request rather
 * than accept a key that anyone could guess or read out of the bundle. The
 * public scanner and the impact model keep working either way.
 */
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";
const ADMIN_ENABLED = ADMIN_KEY.length >= 12;
if (!ADMIN_ENABLED) {
  console.warn(
    "[auth] ADMIN_KEY is unset or shorter than 12 characters — the lead log is disabled.",
  );
}

// Throttle failed key attempts per IP so the log can't be brute-forced.
const attempts = new Map<string, { n: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT = 1000 * 60 * 15;

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function pillar(data: ScoreResult, key: string): string {
  const p = data.pillars.find((x) => x.key === key);
  return p ? `${p.earned.toFixed(2)}/${String(p.max)}` : "";
}

function weakestPillar(data: ScoreResult): string {
  let worst = data.pillars[0];
  for (const p of data.pillars) {
    if (p.earned / p.max < worst.earned / worst.max) worst = p;
  }
  return worst ? worst.label : "";
}

function refOf(req: Request): string {
  return String(req.get("referer") || req.get("referrer") || "");
}

/** RFC 4180 CSV escaping. */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS: Array<[string, (r: Scan) => unknown]> = [
  ["Date (UTC)", (r) => r.scannedAt],
  ["Domain", (r) => r.domain],
  ["URL entered", (r) => r.urlEntered],
  ["Company name", (r) => r.companyName],
  ["Score", (r) => r.score],
  ["Band", (r) => r.band],
  ["Audience", (r) => r.audience],
  ["Real offer", (r) => r.realOffer],
  ["Confidence", (r) => r.confidence],
  ["Growth fit", (r) => r.recommended],
  ["Weakest pillar", (r) => r.weakest],
  ["Social Presence", (r) => r.social],
  ["Social Effectiveness", (r) => r.socialEff],
  ["Content & SEO", (r) => r.content],
  ["Podcast", (r) => r.podcast],
  ["Video", (r) => r.video],
  ["Third-party Validation", (r) => r.thirdParty],
  ["Status", (r) => r.status],
  ["Referrer", (r) => r.referrer],
];

const LEAD_CSV_COLUMNS: Array<[string, (r: Lead) => unknown]> = [
  ["Date (UTC)", (r) => r.createdAt],
  ["Name", (r) => r.fullName],
  ["Email", (r) => r.email],
  ["Company", (r) => r.company],
  ["Phone", (r) => r.phone],
  ["Domain", (r) => r.domain],
  ["Authority Score", (r) => r.score],
  ["Band", (r) => r.band],
  ["Target score", (r) => r.targetScore],
  ["Deals per year", (r) => r.dealVolume],
  ["Average deal size", (r) => r.dealSize],
  ["Modeled added revenue", (r) => r.modeledDelta],
  ["CRM status", (r) => r.crmStatus],
  ["Scan ID", (r) => r.scanId],
  ["Referrer", (r) => r.referrer],
];

/* ---------------- lead capture validation ---------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Providers we will not take as a business contact. */
const FREE_EMAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "me.com", "live.com", "msn.com", "proton.me", "protonmail.com",
  "mail.com", "gmx.com", "yandex.com", "zoho.com", "pm.me",
]);

function str(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

function intOrNull(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(Math.max(n, min), max));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post("/api/score", async (req, res) => {
    const raw = String(req.body?.url ?? "").slice(0, 300);
    const url = normalizeUrl(raw);
    const now = new Date().toISOString();
    const referrer = refOf(req);
    const socialLinks: SocialLinks = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const value = req.body?.socialLinks?.[platform];
      if (value === undefined || (typeof value === "string" && !value.trim())) continue;
      const normalized = typeof value === "string" ? normalizeSocialLink(platform, value) : null;
      if (!normalized) return res.status(400).json({ error: `Enter a valid ${platform} profile URL, or leave that field blank.` });
      socialLinks[platform] = normalized;
    }
    const podcastRaw = req.body?.podcastUrl;
    const founderRaw = req.body?.founderName;
    if (podcastRaw !== undefined && typeof podcastRaw !== "string") return res.status(400).json({error:"Enter a podcast URL or leave it blank."});
    if (founderRaw !== undefined && (typeof founderRaw !== "string" || founderRaw.length > 100)) return res.status(400).json({error:"Enter a founder name of up to 100 characters."});
    const podcastUrl = podcastRaw?.trim() ? normalizeUrl(podcastRaw) : undefined;
    if (podcastRaw?.trim() && (!podcastUrl || podcastRaw.length > 500 || new URL(podcastUrl).username || new URL(podcastUrl).password)) return res.status(400).json({error:"Enter a public HTTP or HTTPS podcast page or RSS feed URL."});
    const founderName = founderRaw?.trim().replace(/\s+/g, " ") || undefined;
    if (founderName && founderName.length < 2) return res.status(400).json({error:"Enter the founder’s full name."});
    const supplemental = {podcastUrl: podcastUrl || undefined, founderName};
    const cacheKey = JSON.stringify([url, socialLinks, supplemental]);

    if (!url) {
      void storage.logScan({
        scannedAt: now,
        domain: "",
        urlEntered: raw,
        status: "Invalid URL",
        referrer,
      });
      return res.status(400).json({
        error:
          "That doesn't look like a valid website address. Try something like acme.com.",
      });
    }

    const record = (data: ScoreResult, status: string) => {
      return storage.logScan({
        scannedAt: now,
        domain: data.domain,
        urlEntered: raw,
        companyName: data.companyName,
        score: data.score,
        band: data.bandLabel,
        audience: data.audience,
        realOffer: data.sellingRealOffer,
        confidence: data.confidence,
        recommended: data.recommended ? "Yes" : "No",
        social: pillar(data, "social"),
        socialEff: pillar(data, "socialEff"),
        content: pillar(data, "content"),
        podcast: pillar(data, "podcast"),
        video: pillar(data, "video"),
        thirdParty: pillar(data, "external"),
        weakest: weakestPillar(data),
        status,
        referrer,
      });
    };

    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL) {
      const scanId = await record(hit.data, "Scored");
      return res.json({ ...hit.data, scanId });
    }

    try {
      const data = await analyze(url, socialLinks, supplemental);
      cache.set(cacheKey, { at: Date.now(), data });
      const scanId = await record(data, "Scored");
      return res.json({ ...data, scanId });
    } catch (err: any) {
      const message =
        err?.code === "UNREACHABLE"
          ? err.message
          : "Something went wrong while analyzing that site. Try again, or check the URL.";
      void storage.logScan({
        scannedAt: now,
        domain: new URL(url).hostname.replace(/^www\./, ""),
        urlEntered: raw,
        status: "Unreachable",
        referrer,
      });
      return res.status(422).json({ error: message });
    }
  });

  /* ---------------- contact capture ---------------- */

  // Per-IP submission throttle. Generous enough that a real office behind one
  // NAT address is unaffected, tight enough that the table can't be stuffed.
  const posts = new Map<string, number[]>();
  const POST_WINDOW = 1000 * 60 * 10;
  const POST_MAX = 5;

  app.post("/api/lead", async (req, res) => {
    const ip = String(req.ip || req.socket.remoteAddress || "unknown");
    const now = Date.now();
    const recent = (posts.get(ip) ?? []).filter((t) => now - t < POST_WINDOW);
    if (recent.length >= POST_MAX) {
      return res.status(429).json({
        error: "That's a few too many submissions from this connection. Try again shortly.",
      });
    }

    const fullName = str(req.body?.fullName, 120);
    const email = str(req.body?.email, 200).toLowerCase();
    const company = str(req.body?.company, 160);
    const phone = str(req.body?.phone, 40);

    const fields: Record<string, string> = {};
    if (fullName.length < 2) fields.fullName = "Enter your full name.";
    if (!EMAIL_RE.test(email)) {
      fields.email = "Enter a valid email address.";
    } else if (FREE_EMAIL.has(email.slice(email.lastIndexOf("@") + 1))) {
      fields.email = "Use your work email so we can look at the right company.";
    }
    if (company.length < 2) fields.company = "Enter your company name.";
    if (phone && phone.replace(/\D/g, "").length < 7) {
      fields.phone = "That phone number looks incomplete. Leave it blank if you'd rather not.";
    }
    if (Object.keys(fields).length > 0) {
      return res.status(400).json({ error: "Check the highlighted fields.", fields });
    }

    recent.push(now);
    posts.set(ip, recent);

    try {
      const lead = await storage.addLead({
        createdAt: new Date().toISOString(),
        scanId: intOrNull(req.body?.scanId, 0, 2_000_000_000),
        fullName,
        email,
        company,
        phone: phone || null,
        domain: str(req.body?.domain, 200) || null,
        score: intOrNull(req.body?.score, 0, 10),
        band: str(req.body?.band, 40) || null,
        targetScore: intOrNull(req.body?.targetScore, 0, 10),
        dealVolume: intOrNull(req.body?.dealVolume, 0, 1_000_000),
        dealSize: intOrNull(req.body?.dealSize, 0, 1_000_000_000),
        modeledDelta: intOrNull(req.body?.modeledDelta, 0, 1_000_000_000_000),
        referrer: refOf(req) || null,
        leadToken: crypto.randomBytes(24).toString("base64url"),
        crmStatus: "pending",
      });

      // Committed first, synced second. A CRM outage never costs us the lead.
      void syncLead(lead);

      return res.json({ ok: true, id: lead.id, token: lead.leadToken });
    } catch (err) {
      console.error("[lead] failed to record lead:", err);
      return res.status(500).json({
        error: "We couldn't save that. Try again, or email hello@inspiredvibe.com.",
      });
    }
  });

  /**
   * Write-back of the figures the visitor modeled after they gave us their
   * details. Authorised by the capability token issued at creation, and
   * restricted to the four modeling columns — no contact field is writable
   * here, so a leaked token cannot rewrite someone's identity.
   */
  app.post("/api/lead/model", async (req, res) => {
    const id = intOrNull(req.body?.id, 1, 2_000_000_000);
    const token = str(req.body?.token, 64);
    if (id === null || !token) return res.status(400).json({ error: "Bad request" });

    const ok = await storage.updateLeadModel(id, token, {
      targetScore: intOrNull(req.body?.targetScore, 0, 10),
      dealVolume: intOrNull(req.body?.dealVolume, 0, 1_000_000),
      dealSize: intOrNull(req.body?.dealSize, 0, 1_000_000_000),
      modeledDelta: intOrNull(req.body?.modeledDelta, 0, 1_000_000_000_000),
    });
    if (!ok) return res.status(403).json({ error: "Not authorised" });
    return res.json({ ok: true });
  });

  /* ---------------- admin session ---------------- */

  const throttled = (req: Request): boolean => {
    const ip = String(req.ip || req.socket.remoteAddress || "unknown");
    const rec = attempts.get(ip);
    return Boolean(rec && rec.n >= MAX_ATTEMPTS && Date.now() < rec.until);
  };

  /**
   * Bearer fallback.
   *
   * The cookie session is the right mechanism and the one production will
   * use, because production serves the API from the same origin as the page.
   * Hosted previews do not: the bundle is served from one origin and the API
   * is proxied from another, and a cross-site cookie will not be sent. So
   * login also mints an opaque bearer token the client can present in a
   * header, which crosses origins without weakening the cookie to
   * SameSite=None.
   *
   * Tokens are server-side, in memory, and expire with the session window.
   * They are never put in a URL, which was the whole point of this change.
   */
  const bearers = new Map<string, number>();
  const BEARER_TTL = 1000 * 60 * 60 * 8;

  const mintBearer = (): string => {
    const now = Date.now();
    bearers.forEach((exp, t) => {
      if (exp < now) bearers.delete(t);
    });
    const token = crypto.randomBytes(32).toString("base64url");
    bearers.set(token, now + BEARER_TTL);
    return token;
  };

  const bearerOf = (req: Request): string => {
    const h = String(req.get("authorization") || "");
    return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  };

  const requireAdmin = (req: Request): boolean => {
    if (!ADMIN_ENABLED) return false;
    if (req.session?.admin) return true;
    const token = bearerOf(req);
    if (!token) return false;
    const exp = bearers.get(token);
    if (exp === undefined) return false;
    if (exp < Date.now()) {
      bearers.delete(token);
      return false;
    }
    return true;
  };

  registerReportRoutes(app, requireAdmin);

  app.post("/api/admin/login", (req, res) => {
    if (!ADMIN_ENABLED) {
      return res.status(503).json({ error: "The lead log is not configured on this deployment." });
    }
    if (throttled(req)) {
      return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    }
    const ip = String(req.ip || req.socket.remoteAddress || "unknown");
    const supplied = String(req.body?.key ?? "");

    if (timingSafeEqual(supplied, ADMIN_KEY)) {
      attempts.delete(ip);
      // New session id on privilege change, so a pre-login cookie can't be
      // reused to ride into an authenticated session.
      const token = mintBearer();
      // regenerate, then save explicitly. After a regenerate, express-session
      // does not always regard the new session as dirty at response time, so
      // relying on the implicit save silently omits Set-Cookie.
      return req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: "Could not start a session." });
        req.session.admin = true;
        return req.session.save((saveErr) => {
          if (saveErr) return res.status(500).json({ error: "Could not start a session." });
          return res.json({ ok: true, token });
        });
      });
    }

    const rec = attempts.get(ip);
    const next = rec && Date.now() < rec.until ? rec.n + 1 : 1;
    attempts.set(ip, { n: next, until: Date.now() + LOCKOUT });
    return res.status(401).json({ error: "That key is not right." });
  });

  app.post("/api/admin/logout", (req, res) => {
    const token = bearerOf(req);
    if (token) bearers.delete(token);
    req.session.destroy(() => {
      res.clearCookie(process.env.NODE_ENV === "production" ? "__Host-iv.sid" : "iv.sid", {
        path: "/",
      });
      return res.json({ ok: true });
    });
  });

  app.get("/api/admin/session", (req, res) => {
    return res.json({ admin: requireAdmin(req) });
  });

  /* ---------------- lead log ---------------- */

  app.get("/api/leads", async (req, res) => {
    if (!requireAdmin(req)) return res.status(401).json({ error: "Unauthorized" });
    const rows = await storage.listScans();
    return res.json({ count: rows.length, rows });
  });

  app.get("/api/contacts", async (req, res) => {
    if (!requireAdmin(req)) return res.status(401).json({ error: "Unauthorized" });
    const rows = await storage.listLeads();
    return res.json({ count: rows.length, rows });
  });

  app.get("/api/contacts.csv", async (req, res) => {
    if (!requireAdmin(req)) return res.status(401).send("Unauthorized");
    const rows = await storage.listLeads();
    const lines = [LEAD_CSV_COLUMNS.map(([h]) => csvCell(h)).join(",")];
    for (const r of rows) {
      lines.push(LEAD_CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(","));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="authority-contacts-${stamp}.csv"`
    );
    return res.send("\uFEFF" + lines.join("\r\n"));
  });

  app.get("/api/leads.csv", async (req, res) => {
    if (!requireAdmin(req)) return res.status(401).send("Unauthorized");
    const rows = await storage.listScans();
    const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(",")];
    for (const r of rows) {
      lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(","));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="authority-score-leads-${stamp}.csv"`
    );
    // BOM so Excel opens UTF-8 cleanly.
    return res.send("\uFEFF" + lines.join("\r\n"));
  });

  return httpServer;
}

