/**
 * Combines all roadmap MD files into a single styled HTML with Mermaid rendering.
 * Run: node build-roadmap-html.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = String.raw`C:\Users\RENTKAR\.gemini\antigravity\brain\e792e725-959c-4a30-b71e-fc33757131f0`;
const files = [
  'implementation_plan.md',
  'roadmap_part1.md',
  'roadmap_part2.md',
  'roadmap_part3.md',
  'roadmap_part4.md',
];

// Read and combine
let md = '';
for (const f of files) {
  md += readFileSync(join(BASE, f), 'utf8') + '\n\n---\n\n';
}

// Simple markdown → HTML conversion (no deps needed)
function mdToHtml(text) {
  let html = text;

  // Fenced code blocks (``` ... ```) — handle mermaid specially
  html = html.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    return `<div class="mermaid">${code.trim()}</div>`;
  });

  // Other fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<pre><code class="language-${lang||'text'}">${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[\s\-:|]+\|)\n((?:\|.+\|\n?)*)/gm, (_, header, sep, body) => {
    const ths = header.split('|').filter(c=>c.trim()).map(c=>`<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const tds = row.split('|').filter(c=>c.trim()).map(c=>`<td>${c.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('\n');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // GitHub alerts
  html = html.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:>.*\n?)*)/gm, (_, type, content) => {
    const text = content.replace(/^>\s?/gm, '').trim();
    return `<div class="alert alert-${type.toLowerCase()}"><strong>${type}</strong><br>${text}</div>`;
  });

  // Blockquotes (remaining)
  html = html.replace(/^((?:>.*\n?)+)/gm, (block) => {
    const inner = block.replace(/^>\s?/gm, '').trim();
    return `<blockquote>${inner}</blockquote>`;
  });

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Unordered lists
  html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, '$1<li>$2</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // Paragraphs — wrap bare lines
  html = html.replace(/^(?!<[a-zA-Z/])((?!\s*$).+)$/gm, '<p>$1</p>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return html;
}

const bodyHtml = mdToHtml(md);

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GetFit AI — Complete Engineering Roadmap</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', sans-serif;
  background: #0a0a14;
  color: #e4e4e7;
  line-height: 1.7;
  font-size: 14px;
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}
h1 {
  font-size: 28px; font-weight: 800;
  background: linear-gradient(135deg, #6C5CE7, #00CEC9);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  border-bottom: 3px solid #6C5CE7;
  padding-bottom: 12px; margin: 48px 0 20px;
}
h2 {
  font-size: 22px; font-weight: 700; color: #A29BFE;
  border-bottom: 2px solid #2D2D44;
  padding-bottom: 8px; margin: 36px 0 16px;
}
h3 { font-size: 17px; font-weight: 600; color: #00CEC9; margin: 24px 0 12px; }
h4 { font-size: 14px; font-weight: 600; color: #fff; margin: 16px 0 8px; }
p { margin: 8px 0; }
strong { color: #fff; }
a { color: #A29BFE; text-decoration: none; }
hr {
  border: none; height: 2px; margin: 32px 0;
  background: linear-gradient(90deg, #6C5CE7, #00CEC9, transparent);
}
code {
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  background: #16213E; padding: 2px 6px; border-radius: 4px; color: #00CEC9;
}
pre {
  background: #1A1A2E; border: 1px solid #2D2D44; border-radius: 8px;
  padding: 16px; overflow-x: auto; margin: 12px 0;
}
pre code { background: none; padding: 0; color: #e4e4e7; font-size: 12px; }
table {
  width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px;
}
th {
  padding: 10px 12px; text-align: left; font-weight: 600; color: #A29BFE;
  border-bottom: 2px solid #6C5CE7; background: #16213E;
}
td { padding: 8px 12px; border-bottom: 1px solid #2D2D44; }
tr:nth-child(even) { background: rgba(108,92,231,0.05); }
blockquote {
  border-left: 4px solid #6C5CE7; background: #1A1A2E;
  padding: 12px 16px; margin: 12px 0; border-radius: 0 8px 8px 0;
}
ul, ol { padding-left: 20px; margin: 8px 0; }
li { margin: 4px 0; }
.alert {
  border-radius: 8px; padding: 14px 18px; margin: 14px 0;
  border-left: 4px solid;
}
.alert-tip { background: #0a2618; border-color: #00B894; }
.alert-important { background: #1a1030; border-color: #6C5CE7; }
.alert-warning { background: #1a1808; border-color: #FDCB6E; }
.alert-caution { background: #1a0808; border-color: #FF6B6B; }
.alert-note { background: #081a2a; border-color: #74B9FF; }
.mermaid {
  background: #1A1A2E; border-radius: 8px;
  padding: 20px; margin: 14px 0; text-align: center;
}
@media print {
  body { background: #fff; color: #222; padding: 0; }
  h1 { -webkit-text-fill-color: #6C5CE7; }
  h2 { color: #4a3db5; }
  h3 { color: #008b87; }
  pre, .mermaid { background: #f5f5f5; border-color: #ddd; }
  pre code, code { color: #333; }
  th { background: #f0f0f0; color: #333; }
  td { border-color: #ddd; }
  .alert { background: #f8f8f8; }
}
</style>
</head>
<body>
${bodyHtml}
<script>
mermaid.initialize({
  startOnLoad: true,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#6C5CE7',
    primaryTextColor: '#e4e4e7',
    primaryBorderColor: '#A29BFE',
    lineColor: '#A29BFE',
    secondaryColor: '#16213E',
    tertiaryColor: '#1A1A2E',
    fontSize: '13px',
  }
});
<\/script>
</body>
</html>`;

const outPath = join(process.cwd(), 'GetFit_AI_Roadmap.html');
writeFileSync(outPath, fullHtml, 'utf8');
console.log(`✅ Saved to ${outPath}`);
console.log(`   Open in Chrome → Ctrl+P → "Save as PDF" for a PDF with all diagrams.`);
