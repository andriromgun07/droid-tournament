export async function resolve(spec, ctx, next) {
  if (spec === '@netlify/database') return next(new URL('./mock-database.mjs', import.meta.url).href, ctx);
  return next(spec, ctx);
}
