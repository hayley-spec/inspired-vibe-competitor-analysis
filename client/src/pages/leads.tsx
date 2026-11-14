import { AdminReports } from "@/components/admin-reports";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/queryClient";
import { Download, Lock, LogOut, RefreshCw, ArrowLeft, Phone, Mail } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

/* ==========================================================================
 * ADMIN — scans and contacts
 *
 * Authentication is a server-side session, not a URL parameter. The contacts
 * table holds names, emails and phone numbers, and query strings leak through
 * browser history, referrer headers and shared screenshots. The key is posted
 * once; after that the cookie carries it.
 * ========================================================================== */

type Row = {
  id: number;
  scannedAt: string;
  domain: string;
  urlEntered: string;
  companyName: string | null;
  score: number | null;
  band: string | null;
  audience: string | null;
  realOffer: string | null;
  confidence: string | null;
  recommended: string | null;
  social: string | null;
  socialEff: string | null;
  content: string | null;
  podcast: string | null;
  video: string | null;
  thirdParty: string | null;
  weakest: string | null;
  status: string;
};

type Contact = {
  id: number;
  createdAt: string;
  scanId: number | null;
  fullName: string;
  email: string;
  company: string;
  phone: string | null;
  domain: string | null;
  score: number | null;
  band: string | null;
  targetScore: number | null;
  dealVolume: number | null;
  dealSize: number | null;
  modeledDelta: number | null;
  crmStatus: string;
};

/**
 * The admin credential.
 *
 * Held in memory and presented in an Authorization header, never in a URL —
 * the whole reason this page moved off a query parameter is that the table
 * below holds contact details, and URLs end up in history, referrers and
 * screenshots. In memory means it does not outlive the page, and a hard
 * reload re-authenticates from the httpOnly session cookie instead.
 */
let adminToken = "";

const getToken = (): string => adminToken;

const setToken = (t: string): void => {
  adminToken = t;
};

/** Every admin request: cookie if the origin allows it, header regardless. */
const authFetch = (path: string, init: RequestInit = {}): Promise<Response> => {
  const token = getToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    // same-origin, deliberately: "include" on a genuinely cross-origin call
    // would require the API to return Access-Control-Allow-Credentials, and
    // an endpoint serving contact details is the last place to widen CORS.
    credentials: "same-origin",
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const money = (n: number | null) => {
  if (n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};

/** Stored as "2.50/2.5" — pull the earned value and the max apart. */
const splitPillar = (v: string | null): { earned: number; max: number } | null => {
  if (!v) return null;
  const [e, m] = v.split("/");
  const earned = Number(e);
  const max = Number(m);
  if (Number.isNaN(earned) || Number.isNaN(max) || !max) return null;
  return { earned, max };
};

/** Colour a pillar cell by how much of its available weight was earned. */
const pillarTone = (v: string | null) => {
  const p = splitPillar(v);
  if (!p) return "text-muted-foreground/50";
  const r = p.earned / p.max;
  if (r >= 0.8) return "text-[hsl(160_65%_40%)]";
  if (r >= 0.5) return "text-[hsl(187_75%_34%)]";
  if (r >= 0.25) return "text-[hsl(30_85%_40%)]";
  return "text-[hsl(6_72%_45%)]";
};

const PILLAR_COLUMNS: Array<{
  label: string;
  max: string;
  get: (r: Row) => string | null;
}> = [
  { label: "Soc. Presence", max: "1.25", get: (r) => r.social },
  { label: "Soc. Effect.", max: "1.25", get: (r) => r.socialEff },
  { label: "Content", max: "3.0", get: (r) => r.content },
  { label: "Podcast", max: "1.5", get: (r) => r.podcast },
  { label: "Video", max: "1.5", get: (r) => r.video },
  { label: "Validation", max: "1.5", get: (r) => r.thirdParty },
];

const toneFor = (score: number | null) => {
  if (score === null) return "text-muted-foreground";
  if (score <= 2) return "text-[hsl(6_72%_45%)]";
  if (score <= 4) return "text-[hsl(30_85%_40%)]";
  if (score <= 7) return "text-[hsl(187_75%_34%)]";
  return "text-[hsl(160_65%_38%)]";
};

type Tab = "contacts" | "scans";

export default function Leads() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("contacts");
  const [rows, setRows] = useState<Row[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // An existing session survives a reload, so don't demand the key again.
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/admin/session");
        const json = await res.json();
        if (json?.admin) {
          setAuthed(true);
          void loadAll();
        }
      } catch {
        /* treated as not signed in */
      } finally {
        setChecking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [scansRes, contactsRes] = await Promise.all([
        authFetch("/api/leads"),
        authFetch("/api/contacts"),
      ]);
      if (scansRes.status === 401 || contactsRes.status === 401) {
        setToken("");
        setAuthed(false);
        setError("Your session expired. Sign in again.");
        return;
      }
      if (!scansRes.ok || !contactsRes.ok) throw new Error("load failed");
      setRows((await scansRes.json()).rows ?? []);
      setContacts((await contactsRes.json()).rows ?? []);
    } catch {
      setError("Couldn't load the log. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function signIn(k: string) {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "That access key isn't right.");
        return;
      }
      if (json.token) setToken(json.token);
      setKey("");
      setAuthed(true);
      await loadAll();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    try {
      await authFetch("/api/admin/logout", { method: "POST" });
    } catch {
      /* clearing local state is what matters */
    }
    setToken("");
    setAuthed(false);
    setRows([]);
    setContacts([]);
  }

  /**
   * An anchor cannot carry an Authorization header, so the export is fetched
   * and saved from a blob instead of linked. This also means the credential
   * never appears in a download URL.
   */
  async function downloadCsv() {
    const path = tab === "contacts" ? "/api/contacts.csv" : "/api/leads.csv";
    setError("");
    try {
      const res = await authFetch(path);
      if (!res.ok) {
        setError(res.status === 401 ? "Session expired. Sign in again." : "Export failed.");
        if (res.status === 401) {
          setToken("");
          setAuthed(false);
        }
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `authority-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setError("Export failed. Try again.");
    }
  }

  const scored = rows.filter((r) => r.score !== null);
  const avg = scored.length
    ? (scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length).toFixed(1)
    : "—";
  const uniqueDomains = new Set(rows.filter((r) => r.domain).map((r) => r.domain)).size;
  const convRate = rows.length ? Math.round((contacts.length / rows.length) * 100) : 0;
  const withPhone = contacts.filter((c) => c.phone).length;
  const pipeline = contacts.reduce((s, c) => s + (c.modeledDelta ?? 0), 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/40">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5">
          <div className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            <span className="hidden sm:inline">Authority Score · </span>Lead Log
          </div>
          <div className="flex items-center gap-4">
            {authed && (
              <button
                onClick={signOut}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
                data-testid="button-signout"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            )}
            <Link
              href="/"
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to scanner
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-12">
        {authed && <AdminReports authFetch={authFetch} />}
        {checking ? (
          <div className="mx-auto max-w-md rounded-xl border border-border/60 bg-card p-8">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-3 w-48 animate-pulse rounded bg-muted" />
          </div>
        ) : !authed ? (
          <div className="mx-auto max-w-md rounded-xl border border-border/60 bg-card p-8">
            <div className="mb-1 flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" />
              <h1 className="text-lg font-bold">Private</h1>
            </div>
            <p className="mb-6 text-sm text-muted-foreground">
              Enter the access key. This log holds contact details, so the key is exchanged for a
              session rather than kept in the address bar.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) void signIn(key.trim());
              }}
              className="flex flex-col gap-3"
            >
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Access key"
                autoComplete="current-password"
                className="h-12 rounded-lg border border-border bg-background px-4 text-base outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"
                data-testid="input-key"
              />
              <button
                type="submit"
                disabled={!key.trim() || loading}
                className="inline-flex h-12 items-center justify-center rounded-lg bg-primary text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                data-testid="button-unlock"
              >
                {loading ? "Checking…" : "Sign in"}
              </button>
              {error && (
                <p className="text-sm text-destructive" data-testid="text-error">
                  {error}
                </p>
              )}
            </form>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Lead log</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Everyone who ran a scan, and everyone who then handed over their details.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void loadAll()}
                  disabled={loading}
                  className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-primary/60 disabled:opacity-50"
                  data-testid="button-refresh"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                  Refresh
                </button>
                <button
                  onClick={() => void downloadCsv()}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                  data-testid="link-csv"
                >
                  <Download className="h-4 w-4" />
                  {tab === "contacts" ? "Contacts CSV" : "Scans CSV"}
                </button>
              </div>
            </div>

            {/* tabs */}
            <div className="mb-8 flex gap-1 border-b border-border/60">
              {(
                [
                  ["contacts", `Contacts (${contacts.length})`],
                  ["scans", `Scans (${rows.length})`],
                ] as Array<[Tab, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  data-testid={`tab-${id}`}
                  className={cn(
                    "-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                    tab === id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(tab === "contacts"
                ? ([
                    ["Contacts", String(contacts.length)],
                    ["Scan → contact", `${convRate}%`],
                    ["With a phone", String(withPhone)],
                    ["Modeled upside", money(pipeline)],
                  ] as Array<[string, string]>)
                : ([
                    ["Total scans", String(rows.length)],
                    ["Unique companies", String(uniqueDomains)],
                    ["Average score", avg],
                    ["Contacts captured", String(contacts.length)],
                  ] as Array<[string, string]>)
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border/60 bg-card p-4">
                  <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
                {error}
              </div>
            )}

            {/* ---------------- CONTACTS ---------------- */}
            {tab === "contacts" &&
              (contacts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nobody has handed over their details yet. The form sits inside the score result,
                    below the six signals.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
                  <table className="w-full min-w-[1180px] text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Company</th>
                        <th className="px-4 py-3 font-medium">Contact</th>
                        <th className="border-l border-border/40 px-3 py-3 text-center font-medium">
                          Score
                        </th>
                        <th className="px-3 py-3 text-center font-medium">Target</th>
                        <th className="border-l border-border/40 px-3 py-3 text-right font-medium">
                          Deals/yr
                        </th>
                        <th className="px-3 py-3 text-right font-medium">Deal size</th>
                        <th className="px-4 py-3 text-right font-medium">Modeled upside</th>
                        <th className="border-l border-border/40 px-4 py-3 text-center font-medium">
                          CRM
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => (
                        <tr
                          key={c.id}
                          className="border-b border-border/40 last:border-0"
                          data-testid={`row-contact-${c.id}`}
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {fmt(c.createdAt)}
                          </td>
                          <td className="px-4 py-3 font-semibold">{c.fullName}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{c.company}</div>
                            {c.domain && (
                              <div className="text-xs text-muted-foreground">{c.domain}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <a
                              href={`mailto:${c.email}`}
                              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                            >
                              <Mail className="h-3.5 w-3.5 shrink-0" />
                              {c.email}
                            </a>
                            {c.phone ? (
                              <a
                                href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                                className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                              >
                                <Phone className="h-3 w-3 shrink-0" />
                                {c.phone}
                              </a>
                            ) : (
                              <div className="mt-1 text-xs text-muted-foreground/60">No phone</div>
                            )}
                          </td>
                          <td
                            className={cn(
                              "border-l border-border/40 px-3 py-3 text-center text-base font-bold tabular-nums",
                              toneFor(c.score),
                            )}
                          >
                            {c.score ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-center text-base font-bold tabular-nums text-brand-red">
                            {c.targetScore ?? "—"}
                          </td>
                          <td className="border-l border-border/40 px-3 py-3 text-right tabular-nums text-muted-foreground">
                            {c.dealVolume ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                            {money(c.dealSize)}
                          </td>
                          <td className="px-4 py-3 text-right text-base font-bold tabular-nums">
                            {c.modeledDelta === null ? (
                              <span className="text-sm font-normal text-muted-foreground/60">
                                Not modeled
                              </span>
                            ) : (
                              money(c.modeledDelta)
                            )}
                          </td>
                          <td className="border-l border-border/40 px-4 py-3 text-center">
                            <span
                              className={cn(
                                "rounded-sm px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em]",
                                c.crmStatus === "synced"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {c.crmStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {tab === "contacts" && contacts.length > 0 && (
              <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
                Target, deals per year, deal size and modeled upside are written back from the
                impact model after the hand-off, so "Not modeled" means they gave you their details
                and left before touching the numbers — still worth a call. CRM status stays
                "pending" until the HubSpot sync is switched on.
              </p>
            )}

            {/* ---------------- SCANS ---------------- */}
            {tab === "scans" &&
              (rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    No scans recorded yet. The first visitor to submit a URL will show up here.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
                  <table className="w-full min-w-[1360px] text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 font-medium">Company</th>
                        <th className="px-4 py-3 font-medium">Domain</th>
                        <th className="border-l border-border/40 px-3 py-3 text-center font-medium">
                          Score
                        </th>
                        {PILLAR_COLUMNS.map((c, i) => (
                          <th
                            key={c.label}
                            className={cn(
                              "px-3 py-3 text-center font-medium",
                              i === 0 && "border-l border-border/40",
                            )}
                          >
                            <span className="block whitespace-nowrap">{c.label}</span>
                            <span className="block text-[0.6rem] normal-case tracking-normal text-muted-foreground/60">
                              of {c.max}
                            </span>
                          </th>
                        ))}
                        <th className="border-l border-border/40 px-4 py-3 font-medium">Band</th>
                        <th className="px-4 py-3 font-medium">Audience</th>
                        <th className="px-4 py-3 text-center font-medium">Fit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-border/40 last:border-0"
                          data-testid={`row-scan-${r.id}`}
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {fmt(r.scannedAt)}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {r.companyName || (
                              <span className="text-muted-foreground">{r.status}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {r.domain || r.urlEntered}
                          </td>
                          <td
                            className={cn(
                              "border-l border-border/40 px-3 py-3 text-center text-base font-bold tabular-nums",
                              toneFor(r.score),
                            )}
                          >
                            {r.score ?? "—"}
                          </td>
                          {PILLAR_COLUMNS.map((c, i) => {
                            const raw = c.get(r);
                            const p = splitPillar(raw);
                            return (
                              <td
                                key={c.label}
                                className={cn(
                                  "px-3 py-3 text-center font-mono text-[0.8rem] tabular-nums",
                                  pillarTone(raw),
                                  i === 0 && "border-l border-border/40",
                                )}
                                data-testid={`cell-${c.label.toLowerCase()}-${r.id}`}
                              >
                                {p ? p.earned.toFixed(2) : "—"}
                              </td>
                            );
                          })}
                          <td className="whitespace-nowrap border-l border-border/40 px-4 py-3 text-muted-foreground">
                            {r.band || "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{r.audience || "—"}</td>
                          <td className="px-4 py-3 text-center">
                            {r.recommended === "Yes" ? (
                              <span className="font-semibold text-[hsl(160_65%_38%)]">Yes</span>
                            ) : (
                              <span className="text-muted-foreground">{r.recommended || "—"}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {tab === "scans" && rows.length > 0 && (
              <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
                Pillar cells are colour-coded by share of available weight earned: green 80%+, teal
                50%+, amber 25%+, red below that. The CSV export adds real-offer, confidence,
                weakest pillar, and referring page.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

