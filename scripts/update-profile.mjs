// Generates the Activity Overview cards (SVG) and the Featured Projects block
// from the real GitHub GraphQL API. No dependencies, requires Node 18+.
//
// Usage:
//   GH_TOKEN=... GH_USER=nvhieu19 node scripts/update-profile.mjs
//   node scripts/update-profile.mjs --placeholder   (render empty "—" cards, no API calls)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TOKEN = process.env.GH_TOKEN;
const USER = process.env.GH_USER || process.env.GITHUB_REPOSITORY_OWNER || "nvhieu19";
const PLACEHOLDER = process.argv.includes("--placeholder");
const OUT_DIR = "assets/activity";
const README = "README.md";
const FEATURED_START = "<!--FEATURED_PROJECTS:START-->";
const FEATURED_END = "<!--FEATURED_PROJECTS:END-->";
const MAX_FEATURED = 4;
const RELEVANT_LANGS = new Set(["JavaScript", "TypeScript", "Python", "Jupyter Notebook"]);
const RELEVANT_TOPICS = ["nodejs", "node", "express", "python", "ai", "llm", "automation", "api", "rest-api", "chatbot", "openai", "machine-learning"];

// ---------- GitHub GraphQL ----------
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-readme-updater" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const CONTRIB_QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
    }
  }
}`;

async function contributions(from, to) {
  const d = await gql(CONTRIB_QUERY, { login: USER, from: from.toISOString(), to: to.toISOString() });
  const c = d.user.contributionsCollection;
  return {
    commits: c.totalCommitContributions,
    issues: c.totalIssueContributions,
    prs: c.totalPullRequestContributions,
    reviews: c.totalPullRequestReviewContributions,
  };
}

const sum = (a, b) => ({ commits: a.commits + b.commits, issues: a.issues + b.issues, prs: a.prs + b.prs, reviews: a.reviews + b.reviews });
const ZERO = { commits: 0, issues: 0, prs: 0, reviews: 0 };
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

// contributionsCollection accepts at most a 1-year window, so "all time" is summed in chunks.
async function allTime(createdAt) {
  let total = ZERO;
  let cursor = new Date(createdAt);
  const now = new Date();
  while (cursor < now) {
    const end = new Date(Math.min(cursor.getTime() + 360 * 86400000, now.getTime()));
    total = sum(total, await contributions(cursor, end));
    cursor = end;
  }
  return total;
}

async function fetchActivity() {
  const { user } = await gql(`query($login:String!){ user(login:$login){ createdAt } }`, { login: USER });
  const [d7, d30, all] = await Promise.all([
    contributions(daysAgo(7), new Date()),
    contributions(daysAgo(30), new Date()),
    allTime(user.createdAt),
  ]);
  return { d7, d30, all, since: user.createdAt.slice(0, 10) };
}

// ---------- SVG cards ----------
const ICONS = {
  commits: "M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z",
  prs: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  issues: "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z",
  reviews: "M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z",
};

const CARDS = [
  { key: "reviews", label: "Code Review", slug: "code-review", dark: "#F0883E", light: "#BC4C00" },
  { key: "issues", label: "Issues", slug: "issues", dark: "#3FB950", light: "#1A7F37" },
  { key: "prs", label: "Pull Requests", slug: "pull-requests", dark: "#A371F7", light: "#8250DF" },
  { key: "commits", label: "Commits", slug: "commits", dark: "#58A6FF", light: "#0969DA" },
];

const THEMES = {
  dark: { bg: "#0D1117", border: "#30363D", text: "#F0F6FC", muted: "#8B949E" },
  light: { bg: "#FFFFFF", border: "#D0D7DE", text: "#1F2328", muted: "#656D76" },
};

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));

function cardSvg(card, theme, data) {
  const t = THEMES[theme];
  const accent = card[theme];
  const all = data ? data.all[card.key] : null;
  const d30 = data ? data.d30[card.key] : null;
  const d7 = data ? data.d7[card.key] : null;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const footer = data
    ? `<text x="20" y="128" font-size="12" fill="${t.muted}">30 days <tspan fill="${t.text}" font-weight="600">${fmt(d30)}</tspan>   ·   7 days <tspan fill="${t.text}" font-weight="600">${fmt(d7)}</tspan></text>`
    : `<text x="20" y="128" font-size="12" fill="${t.muted}">Waiting for first sync</text>`;
  const title = `${card.label}: ${fmt(all)} all time${data ? `, ${fmt(d30)} in the last 30 days, ${fmt(d7)} in the last 7 days` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="150" viewBox="0 0 220 150" role="img" aria-label="${title}" font-family="${font}">
  <title>${title}</title>
  <rect x="0.5" y="0.5" width="219" height="149" rx="10" fill="${t.bg}" stroke="${t.border}"/>
  <rect x="0.5" y="0.5" width="219" height="4" rx="2" fill="${accent}"/>
  <g transform="translate(20 22) scale(1.1)" fill="${accent}"><path d="${ICONS[card.key]}"/></g>
  <text x="44" y="35" font-size="14" font-weight="600" fill="${accent}">${card.label}</text>
  <text x="20" y="82" font-size="36" font-weight="700" fill="${t.text}">${fmt(all)}</text>
  <text x="20" y="102" font-size="11" fill="${t.muted}" letter-spacing="0.8">ALL TIME</text>
  <line x1="20" y1="112" x2="200" y2="112" stroke="${t.border}"/>
  ${footer}
</svg>
`;
}

async function writeCards(data) {
  await mkdir(OUT_DIR, { recursive: true });
  for (const card of CARDS) {
    for (const theme of ["dark", "light"]) {
      await writeFile(path.join(OUT_DIR, `${card.slug}-${theme}.svg`), cardSvg(card, theme, data));
    }
  }
  if (data) {
    const meta = { user: USER, generatedAt: new Date().toISOString(), accountCreated: data.since, allTime: data.all, last30Days: data.d30, last7Days: data.d7 };
    await writeFile(path.join(OUT_DIR, "activity.json"), JSON.stringify(meta, null, 2) + "\n");
  }
}

// ---------- Featured projects ----------
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

async function fetchRepos() {
  const d = await gql(
    `query($login:String!){
      user(login:$login){
        repositories(first: 50, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER, orderBy:{field: PUSHED_AT, direction: DESC}){
          nodes{
            name url description stargazerCount isArchived pushedAt
            primaryLanguage{ name }
            repositoryTopics(first: 8){ nodes{ topic{ name } } }
          }
        }
      }
    }`,
    { login: USER },
  );
  return d.user.repositories.nodes;
}

function pickFeatured(repos) {
  return repos
    .filter((r) => !r.isArchived && r.name.toLowerCase() !== USER.toLowerCase())
    .map((r) => ({ ...r, topics: r.repositoryTopics.nodes.map((n) => n.topic.name) }))
    .filter((r) => RELEVANT_LANGS.has(r.primaryLanguage?.name) || r.topics.some((t) => RELEVANT_TOPICS.includes(t)))
    .sort((a, b) => b.stargazerCount - a.stargazerCount || new Date(b.pushedAt) - new Date(a.pushedAt))
    .slice(0, MAX_FEATURED);
}

function featuredMarkdown(projects) {
  if (!projects.length) {
    return `<p align="center"><sub>Public Node.js, Python and AI projects will appear here automatically as soon as they are published.</sub></p>`;
  }
  const rows = projects.map((r) => {
    const tech = [r.primaryLanguage?.name, ...r.topics.slice(0, 3)].filter(Boolean).map((t) => `\`${esc(t)}\``).join(" ");
    const desc = esc(r.description) || "_No description provided._";
    return `| [**${esc(r.name)}**](${r.url}) | ${desc} | ${tech} | ★ ${r.stargazerCount} |`;
  });
  return ["| Project | Description | Main technologies | Stars |", "| :-- | :-- | :-- | --: |", ...rows].join("\n");
}

async function updateReadme(projects) {
  const readme = await readFile(README, "utf8");
  const start = readme.indexOf(FEATURED_START);
  const end = readme.indexOf(FEATURED_END);
  if (start === -1 || end === -1 || end < start) throw new Error("Featured Projects markers not found in README.md");
  const next = readme.slice(0, start + FEATURED_START.length) + "\n" + featuredMarkdown(projects) + "\n" + readme.slice(end);
  if (next !== readme) await writeFile(README, next);
}

// ---------- main ----------
async function main() {
  if (PLACEHOLDER) {
    await writeCards(null);
    console.log("Placeholder cards written.");
    return;
  }
  if (!TOKEN) throw new Error("GH_TOKEN is not set");
  const [data, repos] = await Promise.all([fetchActivity(), fetchRepos()]);
  await writeCards(data);
  await updateReadme(pickFeatured(repos));
  console.log(`Updated ${USER}: all-time`, data.all, "| 30d", data.d30, "| 7d", data.d7);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
