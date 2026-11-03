import type { DigestRow, Night } from '../digest/types.js';

const DASH = '—';
const RETRY_WARN = 3;

function orDash(value: string | null): string {
  return value === null || value === '' ? DASH : value;
}

// A row is marked when it retried RETRY_WARN times or more, or its last status is a failure.
// The mark is a text label as well as the `warn` class, so it reads without colour.
function DigestLine({ row }: { row: DigestRow }) {
  const manyRetries = row.retries >= RETRY_WARN;
  const failed = row.lastStatus === 'fail';
  const cls = manyRetries || failed ? 'warn' : undefined;
  return (
    <tr>
      <td class={cls}>{row.job}</td>
      <td class={cls}>{orDash(row.owner)}</td>
      <td class={cls}>{row.runs}</td>
      <td class={cls}>{manyRetries ? `${row.retries} · retry x${row.retries}` : row.retries}</td>
      <td class={cls}>{failed ? 'fail' : row.lastStatus}</td>
      <td class={cls}>{orDash(row.lastError)}</td>
      <td class={cls}>{row.firstAt}</td>
      <td class={cls}>{row.lastAt}</td>
    </tr>
  );
}

export function DigestPage({ night }: { night: Night }) {
  return (
    <>
      <h1>digest {night.night}</h1>
      {night.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {night.rows.map((row) => (
              <DigestLine row={row} />
            ))}
          </tbody>
        </table>
      )}
      {night.badLines > 0 && (
        <p class="mute">
          {night.badLines} {night.badLines === 1 ? 'line' : 'lines'} could not be parsed
        </p>
      )}
    </>
  );
}

export function DigestNotFound({ night }: { night: string }) {
  return (
    <>
      <h1>digest</h1>
      <p class="mute">night {night} was not found</p>
    </>
  );
}
