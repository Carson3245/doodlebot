export default function LogsPage() {
  return (
    <>
      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Recent events</h2>
            <p>Wire your logging provider (Supabase, Logtail, Grafana) into <code>/api/logs</code>.</p>
          </div>
        </header>
        <div className="panel__body">
          <ul id="logs-list" className="simple-list simple-list--rows">
            <li className="placeholder">No logs yet. Connect your database or logging provider.</li>
          </ul>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Streaming</h2>
            <p>
              Pipe your production logs here with tools like Logtail, Grafana, or a custom WebSocket to keep an eye on
              live moderation actions.
            </p>
          </div>
        </header>
      </section>
    </>
  )
}
