import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const layout = document.querySelector('#card-layout');
const apply = document.querySelector('#apply-layout');
const current = document.querySelector('#current-layout');
const status = document.querySelector('#card-stack-status');

let selected = null;
let applying = false;

function updateControls() {
  const canEdit = selected && selected.snapshot.editable !== false && !applying;
  layout.disabled = !canEdit;
  apply.disabled = !canEdit || layout.value === selected?.value;
}

async function connect() {
  if (window.parent === window) return;

  const { actions, capabilities } = await DA_SDK;
  if (capabilities?.liveDocument !== 1 || capabilities?.sendHTMLReplace !== 1
    || typeof actions?.subscribeLiveDocument !== 'function') {
    current.textContent = 'Open Card Stack in New Authoring (Canvas).';
    return;
  }

  const unsubscribe = actions.subscribeLiveDocument((snapshot) => {
    const { blockIndex } = snapshot.selection;
    const doc = new DOMParser().parseFromString(snapshot.html, 'text/html');
    const blocks = doc.querySelectorAll('main > div > :is([data-block-index], .library-metadata)');
    const block = Number.isInteger(blockIndex) ? blocks.item(blockIndex) : null;
    const value = block?.classList.contains('stacked') ? 'stacked' : 'grid';

    selected = block?.classList.item(0) === 'cards' ? { block, snapshot, value } : null;
    layout.value = value;
    const label = value === 'stacked' ? 'Stacked' : 'Grid';
    current.textContent = selected ? `Current layout is ${label}.` : 'Select a Cards block.';
    updateControls();
  });
  window.addEventListener('pagehide', unsubscribe, { once: true });

  layout.addEventListener('change', updateControls);
  apply.addEventListener('click', async () => {
    if (!selected || apply.disabled) return;

    const { block, snapshot } = selected;
    const updated = block.cloneNode(true);
    updated.classList.toggle('stacked', layout.value === 'stacked');
    updated.removeAttribute('data-block-index');

    applying = true;
    updateControls();
    status.textContent = 'Applying layout…';

    try {
      const result = await actions.sendHTML(updated.outerHTML, {
        replace: true,
        expected: { html: snapshot.html, blockIndex: snapshot.selection.blockIndex },
      });
      status.textContent = result.ok
        ? 'Layout updated.'
        : (result.message || `Could not update (${result.error}).`);
    } catch {
      status.textContent = 'Could not apply the layout.';
    } finally {
      applying = false;
      updateControls();
    }
  });
}

connect().catch(() => {
  current.textContent = 'Could not connect to DA.live.';
});
