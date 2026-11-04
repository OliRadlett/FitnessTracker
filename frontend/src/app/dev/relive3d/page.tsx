'use client';

import { useEffect, useState } from 'react';

import { Relive3D } from '@/components/relive3d/Relive3D';
import type { Ride } from '@/lib/relive3d/types';
import styles from './page.module.css';

type ArthurFixture = { main: Ride; ghosts: Ride[] };
type FixtureId = 'lake' | 'arthurs';
type DevFixtures = { lake: Ride; arthurs: Ride; ghosts: Ride[] };

export default function DevRelive3DPage() {
  const [fixtures, setFixtures] = useState<DevFixtures | null>(null);
  const [selected, setSelected] = useState<FixtureId>('lake');
  const [ghostId, setGhostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDevBuild = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    // The fixtures are gitignored dumps, so there is nothing to fetch in a
    // deployed build; the page renders a notice instead.
    if (!isDevBuild) return;
    Promise.all([
      fetch('/fittrack/dev-fixtures/relive3d-lake.json').then((response) => {
        if (!response.ok) throw new Error(`lake: HTTP ${response.status}`);
        return response.json() as Promise<Ride>;
      }),
      fetch('/fittrack/dev-fixtures/relive3d-arthurs.json').then((response) => {
        if (!response.ok) throw new Error(`arthurs: HTTP ${response.status}`);
        return response.json() as Promise<ArthurFixture>;
      }),
    ])
      .then(([lake, arthurs]) => {
        setFixtures({ lake, arthurs: arthurs.main, ghosts: arthurs.ghosts });
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, [isDevBuild]);

  // NODE_ENV is inlined at build time, so this branch is all a production build
  // ships: a harness that cannot work must not invite anyone to use it.
  if (!isDevBuild) {
    return (
      <main className={styles.status}>
        <h1>Dev harness</h1>
        <p>This page only runs against local fixtures.</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className={styles.status}>
        <h1>Relive 3D dev harness</h1>
        <p>{error}</p>
        <p>
          Dump the fixtures into <code>frontend/public/dev-fixtures/</code> (see
          the prototype README).
        </p>
      </main>
    );
  }

  if (!fixtures) {
    return <main className={styles.status}>Loading fixtures…</main>;
  }

  const ride = selected === 'lake' ? fixtures.lake : fixtures.arthurs;
  const ghosts = selected === 'arthurs' ? fixtures.ghosts : [];
  const ghost = ghosts.find((candidate) => candidate.id === ghostId) ?? null;

  return (
    <main className={styles.page}>
      <Relive3D
        key={ride.id}
        ride={ride}
        ghost={ghost}
        eyebrowLabel={
          selected === 'arthurs' ? "RELIVE · ARTHUR'S SEAT" : 'RELIVE · LAKE GENEVA'
        }
      />
      <div className={styles.devBar}>
        <span className={styles.devLabel}>DEV FIXTURE</span>
        <button
          type="button"
          className={`${styles.devButton} ${selected === 'lake' ? styles.active : ''}`}
          onClick={() => {
            setSelected('lake');
            setGhostId(null);
          }}
        >
          Lake Geneva
        </button>
        <button
          type="button"
          className={`${styles.devButton} ${selected === 'arthurs' ? styles.active : ''}`}
          onClick={() => setSelected('arthurs')}
        >
          Arthur&apos;s Seat
        </button>
      </div>
      {selected === 'arthurs' && ghosts.length > 0 && (
        <div className={styles.ghostBar}>
          <span className={styles.devLabel}>GHOST</span>
          <button
            type="button"
            className={`${styles.devButton} ${!ghostId ? styles.active : ''}`}
            onClick={() => setGhostId(null)}
          >
            Off
          </button>
          {ghosts.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`${styles.devButton} ${ghostId === candidate.id ? styles.active : ''}`}
              onClick={() => setGhostId(candidate.id)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
