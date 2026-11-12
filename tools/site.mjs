#!/usr/bin/env node
// Builds the GitHub Pages site: site/index.md (landing), other site/*.md pages (site/<name>.md -> <name>/)
// and docs/blog/*.md (posts) into _site/.
//   node tools/site.mjs [--out <dir>] [--base <url>]
// Each Markdown file starts with front matter: title, description, and for posts a date (YYYY-MM-DD).
// A post can add devto: and x: URLs; they show as "Discuss" links at the end of the post.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = path.resolve(arg('--out', path.join(root, '_site')));
const base = arg('--base', 'https://paulbennet.github.io/agent-response-config/').replace(/\/?$/, '/');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const template = fs.readFileSync(path.join(root, 'site/template.html'), 'utf8');

function read(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const k of ['title', 'description']) if (!meta[k]) throw new Error(`${file}: front matter needs ${k}`);
  return { meta, body: src.slice(m[0].length) };
}

function page({ title, pageTitle, description, rel, content, kind }) {
  const depth = rel.split('/').length - 1;
  const vars = {
    title: esc(title),
    pageTitle: esc(pageTitle || title),
    description: esc(description),
    canonical: base + rel.replace(/index\.html$/, ''),
    root: depth ? '../'.repeat(depth) : './',
    ogType: kind === 'post' ? 'article' : 'website',
    kind,
    content,
  };
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const minutes = (md) => Math.max(1, Math.round(md.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length / 230));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Posts, newest first. The slug is the file name without the date prefix.
const blogDir = path.join(root, 'docs/blog');
const posts = fs.readdirSync(blogDir).filter((f) => f.endsWith('.md')).map((f) => {
  const { meta, body } = read(path.join(blogDir, f));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) throw new Error(`${f}: front matter needs date: YYYY-MM-DD`);
  const slug = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  return { ...meta, slug, body, rel: `blog/${slug}/index.html` };
}).sort((a, b) => b.date.localeCompare(a.date));

for (const p of posts) {
  const metaLine = `<p class="meta"><time datetime="${p.date}">${longDate(p.date)}</time> · ${minutes(p.body)} min read</p>`;
  let html = marked.parse(p.body);
  html = /<\/h1>/.test(html) ? html.replace('</h1>', `</h1>\n${metaLine}`) : `<h1>${esc(p.title)}</h1>\n${metaLine}\n${html}`;
  const discuss = [['devto', 'dev.to'], ['x', 'X']].filter(([k]) => /^https:\/\//.test(p[k] || ''))
    .map(([k, label]) => `<a href="${esc(p[k])}">${label}</a>`);
  if (discuss.length) html += `<p class="discuss">Discuss this post on ${discuss.join(' or ')}.</p>\n`;
  page({ title: p.title, pageTitle: `${p.title} · response-config`, description: p.description, rel: p.rel, content: `<article>\n${html}</article>`, kind: 'post' });
}

const list = (prefix) => `<ul class="posts">\n${posts.map((p) =>
  `<li><a href="${prefix}${p.slug}/">${esc(p.title)}</a><p class="meta">${longDate(p.date)} · ${esc(p.description)}</p></li>`).join('\n')}\n</ul>`;

page({ title: 'Blog', pageTitle: 'Blog · response-config', description: 'Posts about response-config.', rel: 'blog/index.html', content: `<h1>Blog</h1>\n${list('')}`, kind: 'home' });

const home = read(path.join(root, 'site/index.md'));
page({ title: home.meta.title, description: home.meta.description, rel: 'index.html',
  content: marked.parse(home.body).replace(/<p>\{\{posts\}\}<\/p>|\{\{posts\}\}/, list('blog/')), kind: 'home' });

for (const f of fs.readdirSync(path.join(root, 'site')).filter((f) => f.endsWith('.md') && f !== 'index.md')) {
  const { meta, body } = read(path.join(root, 'site', f));
  page({ title: meta.title, pageTitle: `${meta.title} · response-config`, description: meta.description,
    rel: `${f.replace(/.md$/, '')}/index.html`, content: `<article>
${marked.parse(body)}</article>`, kind: 'post' });
}

fs.copyFileSync(path.join(root, 'site/style.css'), path.join(out, 'style.css'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>response-config blog</title>
<link>${base}</link>
<description>${esc(home.meta.description)}</description>
${posts.map((p) => `<item><title>${esc(p.title)}</title><link>${base}blog/${p.slug}/</link><guid>${base}blog/${p.slug}/</guid><pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join('\n')}
</channel></rss>
`;
fs.writeFileSync(path.join(out, 'feed.xml'), rss);

console.log(`built ${posts.length} post(s) into ${out}`);
