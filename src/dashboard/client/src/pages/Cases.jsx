export default function CasesPage() {
  return (
    <div className='page cases-page'>
      <header className='page__header'>
        <div>
          <h1>Cases</h1>
          <p>Unified inbox for moderation and RH cases.</p>
        </div>
      </header>
      <section className='panel placeholder-panel'>
        <div className='empty-state'>
          <h2>No cases loaded</h2>
          <p>Apply a filter or create a new case to get started.</p>
          <div className='empty-actions'>
            <button type='button' className='button button--primary'>New case</button>
            <button type='button' className='button button--ghost'>View moderation queue</button>
            <button type='button' className='button button--ghost'>Connect logs</button>
          </div>
        </div>
      </section>
    </div>
  )
}
