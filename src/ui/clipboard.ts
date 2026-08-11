/** Copy text, reporting through a toast either way. */
export function copyText(
  text: string,
  label: string,
  showToast: (msg: string) => void
): void {
  void navigator.clipboard.writeText(text).then(
    () => showToast(`${label} copied`),
    () => showToast('Could not reach the clipboard')
  );
}
