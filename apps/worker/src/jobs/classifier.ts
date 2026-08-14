import type pg from "pg";

export interface ClassificationResult {
  classified: number;
  skipped: number;
}

const APP_RULES: Array<{ pattern: RegExp; category: string; subcategory?: string }> = [
  { pattern: /^com\.apple\.dt\.Xcode$/, category: "development", subcategory: "ide" },
  { pattern: /^com\.apple\.Terminal$/, category: "development", subcategory: "terminal" },
  { pattern: /^com\.apple\.Safari$/, category: "browser", subcategory: "web" },
  { pattern: /^com\.google\.Chrome$/, category: "browser", subcategory: "web" },
  { pattern: /^com\.brave\.Browser$/, category: "browser", subcategory: "web" },
  { pattern: /^org\.mozilla\.firefox$/, category: "browser", subcategory: "web" },
  { pattern: /^com\.microsoft\.Edge$/, category: "browser", subcategory: "web" },
  { pattern: /^com\.opera\.Opera$/, category: "browser", subcategory: "web" },
  { pattern: /^com\.vivaldi\.Vivaldi$/, category: "browser", subcategory: "web" },
  { pattern: /^com\.microsoft\.VSCode$/, category: "development", subcategory: "editor" },
  { pattern: /^com\.jetbrains\./, category: "development", subcategory: "ide" },
  { pattern: /^com\.sublimetext\./, category: "development", subcategory: "editor" },
  { pattern: /^com\.github\.desktop$/, category: "development", subcategory: "git" },
  { pattern: /^com\.docker\./, category: "development", subcategory: "devtools" },
  { pattern: /^com\.figma\./, category: "design", subcategory: "ui" },
  { pattern: /^com\.sketch\./, category: "design", subcategory: "ui" },
  { pattern: /^com\.adobe\./, category: "design", subcategory: "creative" },
  { pattern: /^com\.slack\./, category: "communication", subcategory: "chat" },
  { pattern: /^com\.microsoft\.Teams$/, category: "communication", subcategory: "chat" },
  { pattern: /^com\.discord\./, category: "communication", subcategory: "chat" },
  { pattern: /^com\.zoom\./, category: "communication", subcategory: "meeting" },
  { pattern: /^us\.zoom\./, category: "communication", subcategory: "meeting" },
  { pattern: /^com\.apple\.iWork\.Pages$/, category: "productivity", subcategory: "documents" },
  { pattern: /^com\.apple\.iWork\.Numbers$/, category: "productivity", subcategory: "spreadsheet" },
  { pattern: /^com\.apple\.iWork\.Keynote$/, category: "productivity", subcategory: "presentation" },
  { pattern: /^com\.microsoft\.Word$/, category: "productivity", subcategory: "documents" },
  { pattern: /^com\.microsoft\.Excel$/, category: "productivity", subcategory: "spreadsheet" },
  { pattern: /^com\.microsoft\.Powerpoint$/, category: "productivity", subcategory: "presentation" },
  { pattern: /^com\.google\.Chrome\.app\.(Docs|Sheets|Slides)$/, category: "productivity", subcategory: "documents" },
  { pattern: /^com\.notion\./, category: "productivity", subcategory: "notes" },
  { pattern: /^com\.obsidian\./, category: "productivity", subcategory: "notes" },
  { pattern: /^md\.obsidian\./, category: "productivity", subcategory: "notes" },
  { pattern: /^com\.spotify\./, category: "entertainment", subcategory: "music" },
  { pattern: /^com\.apple\.Music$/, category: "entertainment", subcategory: "music" },
  { pattern: /^com\.apple\.tv$/, category: "entertainment", subcategory: "video" },
  { pattern: /^com\.netflix\./, category: "entertainment", subcategory: "video" },
  { pattern: /^com\.apple\.iCal$/, category: "productivity", subcategory: "calendar" },
  { pattern: /^com\.microsoft\.Outlook$/, category: "productivity", subcategory: "email" },
  { pattern: /^com\.apple\.mail$/, category: "productivity", subcategory: "email" },
  { pattern: /^com\.1password\./, category: "security", subcategory: "password" },
  { pattern: /^com\.bitwarden\./, category: "security", subcategory: "password" },
  { pattern: /^org\.signal\./, category: "communication", subcategory: "chat" },
  { pattern: /^com\.telegram\./, category: "communication", subcategory: "chat" },
  { pattern: /^com\.whatsapp\./, category: "communication", subcategory: "chat" },
  { pattern: /^com\.tencent\.xinWeChat$/, category: "communication", subcategory: "chat" },
  { pattern: /^com\.tencent\.qq$/, category: "communication", subcategory: "chat" },
];

const DOMAIN_RULES: Array<{ pattern: RegExp; category: string; subcategory?: string }> = [
  { pattern: /^github\.com$/, category: "development", subcategory: "code_hosting" },
  { pattern: /^gitlab\.com$/, category: "development", subcategory: "code_hosting" },
  { pattern: /^bitbucket\.org$/, category: "development", subcategory: "code_hosting" },
  { pattern: /^stackoverflow\.com$/, category: "development", subcategory: "reference" },
  { pattern: /^stackexchange\.com$/, category: "development", subcategory: "reference" },
  { pattern: /^developer\.mozilla\.org$/, category: "development", subcategory: "reference" },
  { pattern: /^docs\.(microsoft|google|apple|amazon)\.com$/, category: "development", subcategory: "reference" },
  { pattern: /^(www\.)?npmjs\.com$/, category: "development", subcategory: "packages" },
  { pattern: /^(www\.)?pypi\.org$/, category: "development", subcategory: "packages" },
  { pattern: /^(www\.)?crates\.io$/, category: "development", subcategory: "packages" },
  { pattern: /^(www\.)?jira\./, category: "productivity", subcategory: "project_management" },
  { pattern: /^(www\.)?linear\.app$/, category: "productivity", subcategory: "project_management" },
  { pattern: /^(www\.)?notion\.so$/, category: "productivity", subcategory: "notes" },
  { pattern: /^(www\.)?figma\.com$/, category: "design", subcategory: "ui" },
  { pattern: /^(www\.)?dribbble\.com$/, category: "design", subcategory: "inspiration" },
  { pattern: /^(www\.)?behance\.net$/, category: "design", subcategory: "inspiration" },
  { pattern: /^(www\.)?youtube\.com$/, category: "entertainment", subcategory: "video" },
  { pattern: /^(www\.)?youtu\.be$/, category: "entertainment", subcategory: "video" },
  { pattern: /^(www\.)?netflix\.com$/, category: "entertainment", subcategory: "video" },
  { pattern: /^(www\.)?twitch\.tv$/, category: "entertainment", subcategory: "streaming" },
  { pattern: /^(www\.)?reddit\.com$/, category: "social", subcategory: "forum" },
  { pattern: /^(www\.)?twitter\.com$/, category: "social", subcategory: "microblog" },
  { pattern: /^(www\.)?x\.com$/, category: "social", subcategory: "microblog" },
  { pattern: /^(www\.)?facebook\.com$/, category: "social", subcategory: "network" },
  { pattern: /^(www\.)?instagram\.com$/, category: "social", subcategory: "network" },
  { pattern: /^(www\.)?linkedin\.com$/, category: "social", subcategory: "professional" },
  { pattern: /^(www\.)?slack\.com$/, category: "communication", subcategory: "chat" },
  { pattern: /^(www\.)?zoom\.us$/, category: "communication", subcategory: "meeting" },
  { pattern: /^(www\.)?teams\.microsoft\.com$/, category: "communication", subcategory: "meeting" },
  { pattern: /^(www\.)?meet\.google\.com$/, category: "communication", subcategory: "meeting" },
  { pattern: /^(www\.)?google\.com$/, category: "search", subcategory: "search" },
  { pattern: /^(www\.)?bing\.com$/, category: "search", subcategory: "search" },
  { pattern: /^(www\.)?duckduckgo\.com$/, category: "search", subcategory: "search" },
  { pattern: /^(www\.)?wikipedia\.org$/, category: "reference", subcategory: "encyclopedia" },
  { pattern: /^(www\.)?chatgpt\.com$/, category: "ai", subcategory: "assistant" },
  { pattern: /^(www\.)?claude\.ai$/, category: "ai", subcategory: "assistant" },
  { pattern: /^(www\.)?bard\.google\.com$/, category: "ai", subcategory: "assistant" },
  { pattern: /^(www\.)?copilot\.microsoft\.com$/, category: "ai", subcategory: "assistant" },
];

const BLOCKED_DOMAINS = new Set([
  "malware.example.com",
  "phishing.example.com",
]);

export function classifyApp(appId: string): { category: string; subcategory?: string } {
  for (const rule of APP_RULES) {
    if (rule.pattern.test(appId)) {
      return { category: rule.category, subcategory: rule.subcategory };
    }
  }
  return { category: "uncategorized" };
}

export function classifyDomain(domain: string): { category: string; subcategory?: string } | null {
  if (BLOCKED_DOMAINS.has(domain)) {
    return null;
  }
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(domain)) {
      return { category: rule.category, subcategory: rule.subcategory };
    }
  }
  return { category: "uncategorized" };
}

export async function runClassifier(pool: pg.Pool): Promise<ClassificationResult> {
  const client = await pool.connect();
  try {
    const waterRes = await client.query(
      `SELECT last_processed_at FROM worker_watermarks WHERE job_name = 'classifier'`
    );
    const since = waterRes.rows[0]?.last_processed_at ?? new Date(0);

    const unclassified = await client.query(
      `SELECT s.org_id, s.subject_id, s.event_id, s.app_id, s.registrable_domain
       FROM activity_segments s
       LEFT JOIN activity_classifications c ON c.event_id = s.event_id
       WHERE c.event_id IS NULL AND s.received_at > $1
       ORDER BY s.received_at ASC
       LIMIT 5000`,
      [since]
    );

    if (unclassified.rows.length === 0) {
      return { classified: 0, skipped: 0 };
    }

    let classified = 0;
    let skipped = 0;

    await client.query("BEGIN");
    try {
      for (const row of unclassified.rows) {
        const appResult = classifyApp(row.app_id);
        const domainResult = row.registrable_domain
          ? classifyDomain(row.registrable_domain)
          : null;

        if (domainResult === null && row.registrable_domain) {
          skipped++;
          continue;
        }

        const category = appResult.category !== "uncategorized"
          ? appResult.category
          : domainResult?.category ?? "uncategorized";
        const subcategory = appResult.subcategory ?? domainResult?.subcategory ?? null;

        await client.query(
          `INSERT INTO activity_classifications
             (org_id, subject_id, event_id, app_id, registrable_domain, category, subcategory)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (event_id) DO NOTHING`,
          [row.org_id, row.subject_id, row.event_id, row.app_id, row.registrable_domain, category, subcategory]
        );
        classified++;
      }

      const maxProcessed = unclassified.rows[unclassified.rows.length - 1].event_id;
      await client.query(
        `INSERT INTO worker_watermarks (job_name, last_processed_at)
         VALUES ('classifier', now())
         ON CONFLICT (job_name) DO UPDATE SET last_processed_at = now(), updated_at = now()`
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    return { classified, skipped };
  } finally {
    client.release();
  }
}
