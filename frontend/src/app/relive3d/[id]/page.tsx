'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';

import { Relive3D } from '@/components/relive3d/Relive3D';
import { useActivityGhosts } from '@/lib/relive3d/useActivityGhosts';
import { useActivityReplay } from '@/lib/relive3d/useActivityReplay';
import type { GhostCandidate } from '@/lib/api/types/relive';
import styles from './page.module.css';

/** "25 Jul 2026 · 1h 12m" — enough to pick the ride you remember. */
function ghostLabel(candidate: GhostCandidate): string {
  const date = new Date(candidate.start_date);
  const day = Number.isNaN(date.getTime())
    ? candidate.name
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
  if (!candidate.moving_s) return day;
  const hours = Math.floor(candidate.moving_s / 3600);
  const minutes = Math.round((candidate.moving_s % 3600) / 60);
  const duration = hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${day} · ${duration}`;
}

/**
 * The 3D viewer is a full-bleed experience, so it lives outside the `(app)`
 * route group: the sidebar and the padded content column would otherwise sit on
 * top of the title card and the playback dock. Auth is enforced here instead.
 */
export default function Relive3DPage() {
  const params = useParams<{ id: string }>();
  const activityId = params?.id;
  const enabled = process.env.NEXT_PUBLIC_RELIVE3D === '1';
  const { status } = useSession();
  const query = useActivityReplay(activityId);
  const ghostsQuery = useActivityGhosts(activityId);
  const [ghostId, setGhostId] = useState<string | null>(null);

  // A ghost is a second replay fetched into an already-open map, so it must not
  // claim a map open from the monthly budget.
  const ghostQuery = useActivityReplay(ghostId ?? undefined, {
    claimMap: false,
  });

  if (!enabled) {
    return (
      <main className={styles.status}>
        <h1>Relive 3D is not enabled</h1>
        <p>Set `NEXT_PUBLIC_RELIVE3D=1` to open the new viewer.</p>
        <Link href="/activities">Back to activities</Link>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <main className={styles.status}>
        <h1>Sign in to watch this ride</h1>
        <Link href="/">Go to sign in</Link>
      </main>
    );
  }

  if (query.isPending || status === 'loading') {
    return <main className={styles.status}>Loading replay…</main>;
  }

  if (query.isError || !query.data) {
    return (
      <main className={styles.status}>
        <h1>Could not load this replay</h1>
        <p>
          {query.error instanceof Error
            ? query.error.message
            : 'The replay endpoint returned no data.'}
        </p>
        {/* The detail route is /activity/<id>; the legacy ?activity= query
            still redirects there for old bookmarks. */}
        <Link href={`/activity/${activityId}`}>
          Back to the activity
        </Link>
      </main>
    );
  }

  const { response, ride } = query.data;
  const sport = response.activity.sport_type
    ? response.activity.sport_type.replace(/([a-z])([A-Z])/g, '$1 $2')
    : 'Ride';
  const ghosts = (ghostsQuery.data?.candidates ?? []).map((candidate) => ({
    id: candidate.activity_id,
    label: ghostLabel(candidate),
    pb: candidate.activity_id === ghostsQuery.data?.pb_activity_id,
  }));
  // Only hand the world a ghost once its streams have arrived; selecting a
  // candidate otherwise unmounts the previous ghost and flickers.
  const ghostRide = ghostId ? ghostQuery.data?.ride ?? null : null;

  return (
    // The viewer's own root is a fixed-position div, so it needs a landmark
    // around it: leaving the (app) group also left behind the <main> the shell
    // used to provide, and axe flags every overlay as "not contained by
    // landmarks".
    <main className={styles.stage}>
      <Relive3D
        ride={ride}
        backHref={`/activity/${activityId}`}
        eyebrowLabel={`RELIVE · ${sport.toUpperCase()}`}
        mapBudget={{
          allowed: response.map_allowed,
          used: response.map_used,
          limit: response.map_limit,
        }}
        ghost={ghostRide}
        ghosts={ghosts}
        ghostId={ghostId}
        onGhostChange={setGhostId}
        ghostLoading={Boolean(ghostId) && ghostQuery.isPending}
      />
    </main>
  );
}
