(() => {
  const viewportMargin = 12;
  const popoverGap = 9;

  function placePopover(button, cursorY) {
    const wrap = button.closest('.activity-heatmap__day-wrap');
    const popover = wrap?.querySelector('.activity-heatmap__popover');
    if (!wrap || !popover) return;

    const { top, bottom } = button.getBoundingClientRect();
    const anchorY = cursorY ?? (top + bottom) / 2;
    const spaceAbove = Math.max(0, anchorY - viewportMargin - popoverGap);
    const spaceBelow = Math.max(0, window.innerHeight - anchorY - viewportMargin - popoverGap);
    const position = spaceBelow > spaceAbove ? 'below' : 'above';
    const maxHeight = position === 'below' ? spaceBelow : spaceAbove;

    wrap.dataset.popoverPosition = position;
    popover.style.setProperty('--activity-popover-max-height', `${Math.floor(maxHeight)}px`);
  }

  function placeVisiblePopovers() {
    document.querySelectorAll('.activity-heatmap__day-wrap:hover .activity-heatmap__day, .activity-heatmap__day:focus').forEach((button) => {
      placePopover(button);
    });
  }

  function init() {
    document.querySelectorAll('button.activity-heatmap__day').forEach((button) => {
      button.addEventListener('pointerenter', (event) => placePopover(button, event.clientY));
      button.addEventListener('focus', () => placePopover(button));
      button.addEventListener('touchstart', (event) => placePopover(button, event.touches[0]?.clientY), { passive: true });
    });
    window.addEventListener('resize', placeVisiblePopovers, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
