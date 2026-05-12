export function runInThisContext() {
  throw new Error('vm is not available in the browser');
}

export default {
  runInThisContext,
};