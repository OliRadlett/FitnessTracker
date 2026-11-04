import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDeepLink } from '@/lib/useDeepLink';

describe('useDeepLink', () => {
  it('composes two setParam calls from one handler', () => {
    window.history.replaceState(null, '', '/training?view=events');
    const { result } = renderHook(() => useDeepLink());

    act(() => {
      result.current.setParam('w', '5');
      result.current.setParam('view', 'week');
    });

    expect(window.location.search).toBe('?view=week&w=5');
    expect(result.current.getParam('w')).toBe('5');
    expect(result.current.getParam('view')).toBe('week');
  });
});
