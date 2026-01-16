export function debounce(fn, waitMs = 200) {
  let t = 0;
  return (...args) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), waitMs);
  };
}
