/**
 * The behaviour of an OpenStuff marketing page (`marketing.css`). Progressive enhancement only:
 * the page works without it.
 *
 * - The glow in a bento tile follows the pointer.
 * - On touch screens a tap on a tile plays its illustration; a tap elsewhere settles it again.
 * - `<button data-copy="code-id">` copies the text of `#code-id`, without `$ ` prompts.
 * - A link in the top bar's menu closes the menu.
 *
 * It imports nothing, so a static site can copy `marketing.js` next to its pages:
 *
 * ```html
 * <script type="module">
 *   import { startMarketingPage } from './assets/os/marketing.js';
 *   startMarketingPage();
 * </script>
 * ```
 *
 * @returns A function that removes the listeners again.
 */
export function startMarketingPage(root = document) {
    const controller = new AbortController();
    const { signal } = controller;
    const tiles = () => root.querySelectorAll('.os-tile');
    root.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch')
            return;
        const tile = event.target?.closest('.os-tile');
        if (!tile)
            return;
        const box = tile.getBoundingClientRect();
        tile.style.setProperty('--os-glow-x', `${event.clientX - box.left}px`);
        tile.style.setProperty('--os-glow-y', `${event.clientY - box.top}px`);
    }, { signal, passive: true });
    root.addEventListener('pointerup', (event) => {
        if (event.pointerType !== 'touch')
            return;
        const target = event.target;
        const hit = target?.closest('.os-tile') ?? null;
        for (const tile of tiles()) {
            if (tile !== hit)
                delete tile.dataset.playing;
        }
        if (!hit || target?.closest('a, button'))
            return;
        hit.toggleAttribute('data-playing');
    }, { signal });
    root.addEventListener('click', (event) => {
        const target = event.target;
        const button = target?.closest('button[data-copy]');
        if (button) {
            void copy(root, button);
            return;
        }
        const menu = target?.closest('.os-topbar [popover]');
        if (menu && target?.closest('a'))
            menu.hidePopover();
    }, { signal });
    return () => {
        controller.abort();
    };
}
/** How long a copy button says "Copied". */
export const COPIED_MS = 1600;
async function copy(root, button) {
    const source = root.getElementById(button.dataset.copy ?? '');
    if (!source)
        return;
    const text = source.textContent.replace(/^\$ /gm, '').trim();
    try {
        await navigator.clipboard.writeText(text);
    }
    catch {
        return; // No clipboard (an insecure origin, or permission denied): leave the text selectable.
    }
    const label = button.querySelector('span');
    const before = label?.textContent ?? '';
    button.toggleAttribute('data-copied', true);
    if (label)
        label.textContent = 'Copied';
    announce(root, 'Copied to clipboard');
    setTimeout(() => {
        button.removeAttribute('data-copied');
        if (label)
            label.textContent = before;
        announce(root, '');
    }, COPIED_MS);
}
/** Says it in a polite live region, which is added on first use. */
function announce(root, message) {
    let region = root.getElementById('os-copy-status');
    if (!region) {
        region = root.createElement('p');
        region.id = 'os-copy-status';
        region.className = 'os-visually-hidden';
        region.setAttribute('aria-live', 'polite');
        root.body.append(region);
    }
    region.textContent = message;
}
