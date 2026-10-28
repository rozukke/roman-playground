export type DragSource<T> =
  | { kind: "palette"; chord: T }
  | { kind: "progression"; from: number };

type DragControllerOptions<T> = {
  progression: () => HTMLElement | null;
  paletteSources: () => Iterable<[HTMLButtonElement, T]>;
  progressionSources: () => Iterable<[HTMLButtonElement, number]>;
  paletteDragEnabled: () => boolean;
  insert: (index: number, chord: T) => void;
  move: (from: number, to: number) => void;
};

const DRAG_THRESHOLD = 10;
// Touch reordering starts from a dedicated handle, keeping horizontal swipes on
// a card available for scrolling the progression.
const TOUCH_REORDER_HOLD_MS = 280;
const EDGE_SCROLL_ZONE = 44;
const EDGE_SCROLL_SPEED = 12;

/**
 * Pointer-event drag handling shared by mouse, touch, and pen. Native HTML drag
 * events are deliberately avoided: browsers do not implement them consistently
 * for touch input.
 */
export class DragController<T> {
  private preview: HTMLElement | undefined;
  private indicator: HTMLElement | undefined;
  private scrollFrame: number | undefined;

  constructor(private readonly options: DragControllerOptions<T>) {}

  bind() {
    for (const [button, chord] of this.options.paletteSources()) {
      button.draggable = false;
      this.bindSource(button, { kind: "palette", chord });
    }
    for (const [button, from] of this.options.progressionSources()) {
      const card = button.closest<HTMLElement>(".progression-chord");
      if (card) card.draggable = false;
      this.bindSource(button, { kind: "progression", from });
    }
  }

  private bindSource(element: HTMLButtonElement, source: DragSource<T>) {
    let pointerId: number | undefined;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let suppressClick = false;
    let reorderHoldTimer: number | undefined;
    let reorderReady = true;

    const clearReorderHold = () => {
      if (reorderHoldTimer !== undefined) window.clearTimeout(reorderHoldTimer);
      reorderHoldTimer = undefined;
    };
    const sourceCard = () => element.closest<HTMLElement>(".progression-chord") ?? element;
    const cleanup = () => {
      clearReorderHold();
      pointerId = undefined;
      sourceCard().classList.remove("dragging");
      this.stopDragVisuals();
    };

    element.addEventListener("pointerdown", event => {
      if (!event.isPrimary || event.button !== 0) return;
      if (source.kind === "palette" && !this.options.paletteDragEnabled()) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      reorderReady = source.kind !== "progression" || event.pointerType !== "touch";
      element.setPointerCapture(event.pointerId);
      if (source.kind === "progression" && !reorderReady) {
        reorderHoldTimer = window.setTimeout(() => { reorderReady = true; }, TOUCH_REORDER_HOLD_MS);
      }
    });

    element.addEventListener("pointermove", event => {
      if (event.pointerId !== pointerId) return;
      if (!dragging && reorderReady && Math.hypot(event.clientX - startX, event.clientY - startY) >= DRAG_THRESHOLD) {
        dragging = true;
        suppressClick = true;
        sourceCard().classList.add("dragging");
        this.startDragVisuals(sourceCard(), event.clientX, event.clientY);
      }
      if (!dragging) return;
      event.preventDefault();
      this.movePreview(event.clientX, event.clientY);
      this.updateDropTarget(event.clientX, event.clientY);
    });

    element.addEventListener("pointerup", event => {
      if (event.pointerId !== pointerId) return;
      const wasDragging = dragging;
      const dropIndex = wasDragging ? this.dropIndexAt(event.clientX, event.clientY) : null;
      try { element.releasePointerCapture(event.pointerId); } catch { /* Pointer capture can already be released. */ }
      cleanup();

      if (wasDragging && dropIndex !== null) {
        if (source.kind === "palette") this.options.insert(dropIndex, source.chord);
        else this.options.move(source.from, dropIndex);
      }
    });

    element.addEventListener("pointercancel", cleanup);
    element.addEventListener("click", event => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  private startDragVisuals(source: HTMLElement, x: number, y: number) {
    this.stopDragVisuals();
    const bounds = source.getBoundingClientRect();
    this.preview = source.cloneNode(true) as HTMLElement;
    this.preview.classList.remove("dragging", "drag-over");
    this.preview.classList.add("drag-preview");
    this.preview.style.width = `${bounds.width}px`;
    this.preview.style.height = `${bounds.height}px`;
    document.body.append(this.preview);
    this.indicator = document.createElement("div");
    this.indicator.className = "drop-indicator";
    this.indicator.setAttribute("aria-hidden", "true");
    document.body.append(this.indicator);
    this.movePreview(x, y);
  }

  private movePreview(x: number, y: number) {
    this.preview?.style.setProperty("transform", `translate(${x + 14}px, ${y + 14}px)`);
  }

  private updateDropTarget(x: number, y: number) {
    const index = this.dropIndexAt(x, y);
    const strip = this.options.progression();
    if (!strip || index === null) {
      strip?.classList.remove("drop-active");
      this.indicator?.classList.remove("visible");
      this.stopEdgeScroll();
      return;
    }
    strip.classList.add("drop-active");
    this.positionIndicator(strip, index);
    this.autoScroll(strip, x);
  }

  private dropIndexAt(x: number, y: number) {
    const strip = this.options.progression();
    if (!strip) return null;
    const bounds = strip.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const cards = [...strip.querySelectorAll<HTMLElement>(".progression-chord")];
    if (!cards.length) return 0;

    if (getComputedStyle(strip).flexWrap === "nowrap") {
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (x < rect.left + rect.width / 2) return Number(card.dataset.index);
      }
      return cards.length;
    }

    // The desktop strip wraps. Choose the closest row, then the before/after
    // position within that row, so the geometry matches visual reading order.
    const rowY = cards.reduce((nearest, card) => {
      const center = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
      return Math.abs(y - center) < Math.abs(y - nearest) ? center : nearest;
    }, cards[0].getBoundingClientRect().top + cards[0].getBoundingClientRect().height / 2);
    const row = cards.filter(card => Math.abs((card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2) - rowY) < 4);
    for (const card of row) {
      const rect = card.getBoundingClientRect();
      if (x < rect.left + rect.width / 2) return Number(card.dataset.index);
    }
    return Number(row[row.length - 1].dataset.index) + 1;
  }

  private positionIndicator(strip: HTMLElement, index: number) {
    if (!this.indicator) return;
    this.indicator.style.width = "5px";
    const cards = [...strip.querySelectorAll<HTMLElement>(".progression-chord")];
    const horizontal = getComputedStyle(strip).flexWrap === "nowrap";
    const target = cards.find(card => Number(card.dataset.index) === index);
    const previous = [...cards].reverse().find(card => Number(card.dataset.index) < index);
    const stripBounds = strip.getBoundingClientRect();
    const rect = target?.getBoundingClientRect() ?? previous?.getBoundingClientRect();
    if (!rect) {
      this.indicator.style.left = `${stripBounds.left + 5}px`;
      this.indicator.style.top = `${stripBounds.top + 5}px`;
      this.indicator.style.height = `${Math.max(20, stripBounds.height - 10)}px`;
    } else if (horizontal || target) {
      const left = target ? rect.left - 5 : rect.right + 5;
      this.indicator.style.left = `${left}px`;
      this.indicator.style.top = `${rect.top}px`;
      this.indicator.style.height = `${rect.height}px`;
    } else {
      this.indicator.style.left = `${rect.right + 5}px`;
      this.indicator.style.top = `${rect.top}px`;
      this.indicator.style.height = `${rect.height}px`;
    }
    this.indicator.classList.add("visible");
  }

  private autoScroll(strip: HTMLElement, x: number) {
    if (getComputedStyle(strip).flexWrap !== "nowrap") return;
    const bounds = strip.getBoundingClientRect();
    const direction = x < bounds.left + EDGE_SCROLL_ZONE ? -1 : x > bounds.right - EDGE_SCROLL_ZONE ? 1 : 0;
    if (!direction) return this.stopEdgeScroll();
    if (this.scrollFrame !== undefined) return;
    const tick = () => {
      strip.scrollLeft += direction * EDGE_SCROLL_SPEED;
      this.scrollFrame = requestAnimationFrame(tick);
    };
    this.scrollFrame = requestAnimationFrame(tick);
  }

  private stopEdgeScroll() {
    if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = undefined;
  }

  private stopDragVisuals() {
    this.preview?.remove();
    this.indicator?.remove();
    this.preview = undefined;
    this.indicator = undefined;
    this.options.progression()?.classList.remove("drop-active");
    this.stopEdgeScroll();
  }
}
