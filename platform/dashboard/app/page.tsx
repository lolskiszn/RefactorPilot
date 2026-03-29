const cards = [
  { label: "Active Repositories", value: "1,024" },
  { label: "Safe Migrations", value: "98.7%" },
  { label: "Policy Coverage", value: "84%" },
  { label: "Marketplace Patterns", value: "12" },
];

export default function Page() {
  return (
    <main className="shell">
      <section className="hero">
        <h1>RefactorPilot Platform</h1>
        <p>Production-beta control plane for migration health, policy campaigns, and marketplace operations.</p>
      </section>
      <section className="grid">
        {cards.map((card) => (
          <article key={card.label} className="card">
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Platform Status</h2>
        <ul>
          <li>GitHub App: production-beta, read-only-by-default</li>
          <li>Marketplace: sandboxed submission review flow scaffolded</li>
          <li>Enterprise: policy engine and campaign planning scaffolded</li>
          <li>Distributed orchestration: dependency-aware planning scaffolded</li>
        </ul>
      </section>
    </main>
  );
}
