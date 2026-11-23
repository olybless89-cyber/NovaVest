import postgres from 'postgres';
import { sql } from './client.js';

/* One-time database copy for moving hosts (e.g. Railway -> Render).

   Set COPY_FROM_DATABASE_URL to the OLD database's public connection string.
   On boot, after the schema is created, every table that exists in both
   databases is replaced with the old database's rows (users, password hashes,
   balances, ledger, settings...), then id sequences are realigned.

   Runs once: a `db_copied_from` marker is written to `settings` and later
   boots skip the copy. Remove COPY_FROM_DATABASE_URL afterwards. */

const MARKER = 'db_copied_from';

export async function copyFromSourceIfConfigured() {
  const srcUrl = process.env.COPY_FROM_DATABASE_URL;
  if (!srcUrl) return false;

  const [done] = await sql`select value from settings where key = ${MARKER}`;
  if (done && !/^(1|true|yes)$/i.test(process.env.COPY_FORCE || '')) {
    console.log('[copy] already copied earlier; skipping (unset COPY_FROM_DATABASE_URL)');
    return false;
  }

  const sm = /sslmode=([^&]+)/i.exec(srcUrl);
  const src = postgres(srcUrl, {
    max: 2, connect_timeout: 20, prepare: false,
    ssl: sm ? (sm[1].toLowerCase() === 'disable' ? false : sm[1].toLowerCase()) : 'require',
  });

  try {
    const srcTables = (await src`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`).map((r) => r.table_name);
    const dstTables = new Set((await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`).map((r) => r.table_name));
    const tables = srcTables.filter((t) => dstTables.has(t));
    console.log(`[copy] copying ${tables.length} tables from source database`);

    const batch = 2000;
    const counts = {};
    await sql.begin(async (tx) => {
      for (const t of tables) {
        await tx.unsafe(`truncate table "${t}"`);
        let copied = 0;
        for (let off = 0; ; off += batch) {
          const [{ j }] = await src.unsafe(
            `select coalesce(json_agg(x), '[]')::text as j
               from (select * from "${t}" order by ctid limit ${batch} offset ${off}) x`);
          const n = JSON.parse(j).length;
          if (!n) break;
          await tx.unsafe(
            `insert into "${t}" select * from json_populate_recordset(null::"${t}", $1::json)`, [j]);
          copied += n;
          if (n < batch) break;
        }
        counts[t] = copied;

        // Realign serial sequences so new rows don't collide with copied ids.
        const seqCols = await tx`
          select column_name from information_schema.columns
          where table_schema = 'public' and table_name = ${t}
            and column_default like 'nextval(%'`;
        for (const { column_name: c } of seqCols) {
          await tx.unsafe(
            `select setval(pg_get_serial_sequence('"${t}"', '${c}'),
                           coalesce((select max("${c}") from "${t}"), 0) + 1, false)`);
        }
      }
      await tx`insert into settings (key, value)
               values (${MARKER}, ${JSON.stringify({ at: new Date().toISOString() })}::jsonb)
               on conflict (key) do update set value = excluded.value`;
    });
    console.log('[copy] done:', JSON.stringify(counts));
    return true;
  } finally {
    await src.end({ timeout: 5 }).catch(() => {});
  }
}
