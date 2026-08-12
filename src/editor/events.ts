export const OPEN_INSERT_MENU_EVENT = 'skald:open-insert-menu';

export function requestInsertMenu(): void {
  window.dispatchEvent(new Event(OPEN_INSERT_MENU_EVENT));
}
