export default function PeoplePage() {
  return (
    <div className='page people-page'>
      <header className='page__header'>
        <div>
          <h1>People</h1>
          <p>Track onboarding, departments, and upcoming birthdays.</p>
        </div>
      </header>
      <section className='panel placeholder-panel'>
        <div className='empty-state'>
          <h2>No profiles yet</h2>
          <p>Start by adding your first person or importing your roster.</p>
          <div className='empty-actions'>
            <button type='button' className='button button--primary'>Add person</button>
            <button type='button' className='button button--ghost'>Sync roles</button>
            <button type='button' className='button button--ghost'>Import CSV</button>
            <button type='button' className='button button--ghost'>Open onboarding modal</button>
          </div>
        </div>
      </section>
    </div>
  )
}
