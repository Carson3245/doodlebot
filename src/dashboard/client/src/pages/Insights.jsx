export default function InsightsPage() {
  return (
    <div className='page insights-page'>
      <header className='page__header'>
        <div>
          <h1>Insights</h1>
          <p>Explore command usage, latency, and case analytics.</p>
        </div>
      </header>
      <section className='panel placeholder-panel'>
        <div className='empty-state'>
          <h2>Telemetry disabled</h2>
          <p>Enable analytics to capture command usage and response times.</p>
          <div className='empty-actions'>
            <button type='button' className='button button--primary'>Enable telemetry</button>
            <button type='button' className='button button--ghost'>See command usage (last 7d)</button>
          </div>
        </div>
      </section>
    </div>
  )
}
