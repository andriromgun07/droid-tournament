// Pengganti @netlify/database untuk tes: menjalankan query di PGlite (Postgres WASM).
import { PGlite } from '@electric-sql/pglite';
export const pg = new PGlite();
class Values { constructor(rows) { this.rows = rows; } }
function sql(strings, ...vals) {
  let text = '', params = [];
  strings.forEach((s, i) => {
    text += s;
    if (i >= vals.length) return;
    const v = vals[i];
    if (v instanceof Values) {
      text += v.rows.map(r => '(' + r.map(x => { params.push(x); return '$' + params.length; }).join(', ') + ')').join(', ');
    } else { params.push(v); text += '$' + params.length; }
  });
  return pg.query(text, params).then(r => r.rows);
}
sql.values = rows => new Values(rows);
export function getDatabase() { return { sql }; }
