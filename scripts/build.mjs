import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const templatePath = path.join(rootDir, 'src', 'index.template.html');
const cssPath = path.join(rootDir, 'src', 'styles', 'main.css');
const outPath = path.join(rootDir, '會議室座位配置管理工具_版型座位防重疊版.html');

const jsOrder = ['utils.js', 'geometry.js', 'templates.js', 'exporter.js', 'app.js'];

function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^\s*export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '')
    .trim();
}

const template = fs.readFileSync(templatePath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8').trimEnd();

const jsChunks = jsOrder.map(file => {
  const filePath = path.join(rootDir, 'src', 'js', file);
  const raw = fs.readFileSync(filePath, 'utf8');
  return `  // === ${file} ===\n${stripModuleSyntax(raw)}`;
});

const bundledJs = `(() => {\n${jsChunks.join('\n\n')}\n})();`;

const output = template
  .replace('/* {{STYLE}} */', css)
  .replace('/* {{SCRIPT}} */', bundledJs);

fs.writeFileSync(outPath, output, 'utf8');
console.log(`Built ${path.basename(outPath)} (${output.split('\n').length} lines)`);
