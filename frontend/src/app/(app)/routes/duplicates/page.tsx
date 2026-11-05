'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// The duplicate-review queue moved into Routes → Maintain. This URL stays
// working as a redirect so bookmarks never break. `?tab=duplicates` is still
// understood by the page and forwards to Maintain with the scan open.
export default function DuplicatesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/routes?tab=duplicates');
  }, [router]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 text-center">
        <p className="text-sm text-muted">
          Duplicate review moved to Routes → Maintain — redirecting…
        </p>
        <Link
          href="/routes?tab=duplicates"
          className="mt-3 inline-flex min-h-[44px] items-center px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg"
        >
          Go to duplicate review
        </Link>
      </div>
    </div>
  );
}
