'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderPlus, Plus, Tags } from 'lucide-react';
import type { RouteData } from '@/lib/api/types';
import { useAuthFetch } from '@/lib/api';
import {
  addRouteTag,
  addRouteToCollection,
  createRouteCollection,
  createRouteTag,
  getRouteCollectionIds,
  listRouteCollections,
  listRouteTags,
  removeRouteFromCollection,
  removeRouteTag,
} from '@/lib/api/routes';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

/**
 * The organising surface that used to live behind the old filter bar.
 * Tags are flat and multi-assign; collections are manual lists (smart ones are
 * rule-driven and cannot be edited here).
 */
export function OrganiseRouteModal({
  route,
  open,
  onClose,
}: {
  route: RouteData;
  open: boolean;
  onClose: () => void;
}) {
  const { token } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [newTag, setNewTag] = useState('');
  const [newCollection, setNewCollection] = useState('');
  // Optimistic overrides: the toggle flips immediately, then the route detail
  // refetch confirms it. Cleared on error and whenever the sheet reopens.
  const [tagOverrides, setTagOverrides] = useState<Record<string, boolean>>({});
  const [collectionOverrides, setCollectionOverrides] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!open) return;
    setTagOverrides({});
    setCollectionOverrides({});
  }, [open]);

  const { data: tags = [] } = useQuery({
    queryKey: ['route-tags'],
    queryFn: () => listRouteTags(token),
    enabled: open && !!token,
  });
  const { data: collections = [] } = useQuery({
    queryKey: ['route-collections'],
    queryFn: () => listRouteCollections(token),
    enabled: open && !!token,
  });
  const { data: collectionIds = [] } = useQuery({
    queryKey: ['route-collection-ids', route.id],
    queryFn: () => getRouteCollectionIds(route.id, token),
    enabled: open && !!token,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['route', route.id] });
    queryClient.invalidateQueries({ queryKey: ['routes'] });
    queryClient.invalidateQueries({ queryKey: ['route-collection-ids', route.id] });
  };

  const tagMutation = useMutation({
    mutationFn: ({ tagId, assigned }: { tagId: string; assigned: boolean }) =>
      assigned
        ? removeRouteTag(tagId, route.id, token)
        : addRouteTag(tagId, route.id, token),
    onSuccess: invalidate,
    onError: (err) => {
      setTagOverrides({});
      toast.error(`Tag failed: ${(err as Error)?.message || 'try again.'}`);
    },
  });

  const collectionMutation = useMutation({
    mutationFn: ({ collectionId, member }: { collectionId: string; member: boolean }) =>
      member
        ? removeRouteFromCollection(collectionId, route.id, token)
        : addRouteToCollection(collectionId, route.id, token),
    onSuccess: invalidate,
    onError: (err) => {
      setCollectionOverrides({});
      toast.error(`Collection failed: ${(err as Error)?.message || 'try again.'}`);
    },
  });

  const createTagMutation = useMutation({
    mutationFn: async (name: string) => {
      const tag = await createRouteTag(name, token);
      await addRouteTag(tag.id, route.id, token);
      return tag;
    },
    onSuccess: () => {
      setNewTag('');
      invalidate();
      toast.success('Tag added');
    },
    onError: (err) =>
      toast.error(`Tag failed: ${(err as Error)?.message || 'try again.'}`),
  });

  const createCollectionMutation = useMutation({
    mutationFn: async (name: string) => {
      const collection = await createRouteCollection(name, token);
      await addRouteToCollection(collection.id, route.id, token);
      return collection;
    },
    onSuccess: () => {
      setNewCollection('');
      invalidate();
      toast.success('Collection added');
    },
    onError: (err) =>
      toast.error(`Collection failed: ${(err as Error)?.message || 'try again.'}`),
  });

  const assignedTagIds = new Set((route.tags ?? []).map((tag) => tag.id));
  const manualCollections = collections.filter((collection) => !collection.is_smart);
  const smartCollections = collections.filter((collection) => collection.is_smart);

  return (
    <Modal open={open} onClose={onClose} aria-label="Tags and collections" size="sm">
      <div className="max-h-[70vh] overflow-y-auto p-5">
        <h2 className="text-base font-semibold text-foreground">Tags & collections</h2>
        <p className="mt-1 text-xs text-muted">
          Tagging and collections are filters in Browse — this is where a route joins them.
        </p>

        <section className="mt-5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <Tags className="h-3.5 w-3.5" /> Tags
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const assigned =
                tagOverrides[tag.id] ?? assignedTagIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={assigned}
                  onClick={() => {
                    const next = !assigned;
                    setTagOverrides((previous) => ({ ...previous, [tag.id]: next }));
                    tagMutation.mutate({ tagId: tag.id, assigned });
                  }}
                  className={`flex h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                    assigned
                      ? 'border-accent/60 bg-accent/15 text-foreground'
                      : 'border-surface-light/70 text-muted hover:text-foreground'
                  }`}
                >
                  {assigned && <Check className="h-3.5 w-3.5 text-accent" />}
                  {tag.name}
                </button>
              );
            })}
            {tags.length === 0 && (
              <p className="text-xs text-muted">No tags yet — create one below.</p>
            )}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newTag.trim();
              if (name) createTagMutation.mutate(name);
            }}
          >
            <input
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              placeholder="New tag"
              aria-label="New tag name"
              className="h-11 min-w-0 flex-1 rounded-lg border border-surface-light/70 bg-background px-3 text-sm text-foreground outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!newTag.trim() || createTagMutation.isPending}
              className="flex h-11 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <FolderPlus className="h-3.5 w-3.5" /> Collections
          </h3>
          <div className="mt-2 space-y-1.5">
            {manualCollections.map((collection) => {
              const member =
                collectionOverrides[collection.id] ??
                collectionIds.includes(collection.id);
              return (
                <button
                  key={collection.id}
                  type="button"
                  aria-pressed={member}
                  onClick={() => {
                    const next = !member;
                    setCollectionOverrides((previous) => ({
                      ...previous,
                      [collection.id]: next,
                    }));
                    collectionMutation.mutate({
                      collectionId: collection.id,
                      member,
                    });
                  }}
                  className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors ${
                    member
                      ? 'border-accent/60 bg-accent/15 text-foreground'
                      : 'border-surface-light/70 text-muted hover:text-foreground'
                  }`}
                >
                  <span className="truncate">{collection.name}</span>
                  {member ? (
                    <Check className="h-4 w-4 shrink-0 text-accent" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0" />
                  )}
                </button>
              );
            })}
            {manualCollections.length === 0 && (
              <p className="text-xs text-muted">
                No manual collections yet — create one below.
              </p>
            )}
            {smartCollections.length > 0 && (
              <p className="pt-1 text-[11px] text-muted">
                {smartCollections.length} smart collection
                {smartCollections.length === 1 ? '' : 's'} follow filter rules and
                add routes automatically.
              </p>
            )}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newCollection.trim();
              if (name) createCollectionMutation.mutate(name);
            }}
          >
            <input
              value={newCollection}
              onChange={(event) => setNewCollection(event.target.value)}
              placeholder="New collection"
              aria-label="New collection name"
              className="h-11 min-w-0 flex-1 rounded-lg border border-surface-light/70 bg-background px-3 text-sm text-foreground outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!newCollection.trim() || createCollectionMutation.isPending}
              className="flex h-11 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
        </section>
      </div>
    </Modal>
  );
}
