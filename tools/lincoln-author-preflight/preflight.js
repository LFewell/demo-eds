const sandbox = {
  org: 'lfewell',
  site: 'demo-eds',
  folder: 'lincoln-lab',
};

const checkDocument = document.querySelector('#check-document');
const status = document.querySelector('#status');
const findings = document.querySelector('#findings');
const report = document.querySelector('.report');

function assetName(src) {
  if (!src) return 'Unlabeled image';
  try {
    const path = new URL(src, 'https://da.live').pathname;
    return decodeURIComponent(path.split('/').pop()) || 'Unlabeled image';
  } catch {
    return 'Unlabeled image';
  }
}

function inspect(html) {
  // Template contents stay inert. Only plain text from findings is rendered.
  const template = document.createElement('template');
  template.innerHTML = html;
  const main = template.content.querySelector('main') ?? template.content;
  main.querySelectorAll('script, style, template, .metadata, .section-metadata')
    .forEach((node) => node.remove());
  const issues = [];

  const h1Count = main.querySelectorAll('h1').length;
  if (h1Count !== 1) {
    issues.push(['Use one main heading', `Found ${h1Count} H1 headings. Keep one H1 for the page title.`]);
  }

  main.querySelectorAll('img, a[data-edit-as="image"]').forEach((image) => {
    if (image.matches('[role="presentation"], [role="none"], [aria-hidden="true"]')) return;
    const alternative = image.getAttribute(image.tagName === 'IMG' ? 'alt' : 'title');
    if (alternative?.trim()) return;
    const name = assetName(image.getAttribute('src') || image.getAttribute('href'));
    issues.push(['Review image alt text', `“${name}” has no text alternative. Add a description if it is meaningful. Confirm an empty alternative is intentional if it is decorative.`]);
  });

  main.querySelectorAll('a[href]:not([data-edit-as="image"])').forEach((link) => {
    const visibleText = link.textContent.trim();
    const imageLabel = [...link.querySelectorAll('img[alt]')].map((image) => image.alt).join(' ');
    const label = (link.getAttribute('aria-label') || visibleText || imageLabel).trim();
    if (!label || /^(click here|here|read more|learn more)$/i.test(label)) {
      issues.push(['Review link text', label ? `“${label}” has little context on its own. Check that readers can tell where it goes.` : 'A link has no obvious label in the authored HTML. Review its accessible name in Preview.']);
    }
  });

  main.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, div, blockquote, td, th')
    .forEach((element) => element.append(' '));
  const draftCopy = [...new Set(main.textContent.match(/\b(?:TODO|TBD|lorem ipsum)\b/gi) ?? [])];
  if (draftCopy.length) {
    issues.push(['Review draft copy', `Found ${draftCopy.map((word) => `“${word}”`).join(', ')} in the document.`]);
  }

  return issues;
}

function showReport(html, source) {
  const issues = inspect(html);
  document.querySelector('#report-source').textContent = source;
  document.querySelector('#issue-count').textContent = `${issues.length} to review`;
  const rows = issues.length ? issues : [['No findings in these checks', 'Review the rendered page and any project-specific requirements before publishing.']];
  findings.replaceChildren(...rows.map(([title, description]) => {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    const detail = document.createElement('p');
    label.textContent = title;
    detail.textContent = description;
    item.append(label, detail);
    return item;
  }));
  report.hidden = false;
}

function sandboxSource(context) {
  if (String(context?.org).toLowerCase() !== sandbox.org
    || String(context?.site ?? context?.repo).toLowerCase() !== sandbox.site) return null;
  if (typeof context.path !== 'string') return null;

  const segments = context.path.split('/').slice(1);
  const filename = segments.at(-1);
  if (!context.path.startsWith('/') || segments.length < 2 || segments[0] !== sandbox.folder) return null;
  if (segments.slice(0, -1).some((part) => !/^[a-z0-9_-]+$/i.test(part))) return null;
  if (!/^[a-z0-9_-]+(?:\.html)?$/i.test(filename)) return null;

  const path = segments.map(encodeURIComponent).join('/');
  const documentPath = /\.html$/i.test(path) ? path : `${path}.html`;
  return {
    path: `/${path}`,
    url: `https://admin.da.live/source/${sandbox.org}/${sandbox.site}/${documentPath}`,
  };
}

async function connectEditor() {
  status.textContent = 'Connecting to the DA.live editor…';
  let timer;

  try {
    const connect = async () => {
      // Adobe serves the DA.live SDK as a browser module.
      // eslint-disable-next-line import/no-unresolved
      const { default: sdk } = await import('https://da.live/nx/utils/sdk.js');
      return sdk;
    };
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Editor connection timed out.')), 4500);
    });
    const { context, token } = await Promise.race([connect(), timeout]);
    const source = sandboxSource(context);
    if (!source) {
      status.textContent = `Open a document inside /${sandbox.folder} to check it here.`;
      return;
    }
    if (!token) {
      status.textContent = 'Sign in to DA.live, then reopen Author Preflight.';
      return;
    }

    checkDocument.hidden = false;
    status.textContent = `Ready to check ${source.path}. Let DA.live finish saving your edits first.`;
    checkDocument.addEventListener('click', async () => {
      checkDocument.disabled = true;
      document.querySelector('#paste-panel').hidden = true;
      report.hidden = true;
      status.textContent = 'Checking the saved document…';

      try {
        const response = await fetch(source.url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error('DA.live denied access. Check your Adobe profile and reopen the tool.');
          }
          throw new Error(`DA.live returned ${response.status}. Save the page and try again.`);
        }
        showReport(await response.text(), source.path);
        status.textContent = 'Checked the latest saved source.';
      } catch (error) {
        status.textContent = error.name === 'TimeoutError' ? 'DA.live did not respond in time. Try again.' : error.message;
      } finally {
        checkDocument.disabled = false;
        document.querySelector('#paste-panel').hidden = false;
      }
    });
  } catch {
    status.textContent = 'Could not connect to DA.live. You can still check sample or pasted HTML.';
  } finally {
    clearTimeout(timer);
  }
}

document.querySelector('#paste-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const html = document.querySelector('#markup').value.trim();
  if (!html) {
    report.hidden = true;
    status.textContent = 'Paste authored HTML to run the checks.';
    return;
  }
  showReport(html, 'Pasted document');
  status.textContent = 'Checked the pasted HTML.';
});

if (window.parent !== window) connectEditor();
