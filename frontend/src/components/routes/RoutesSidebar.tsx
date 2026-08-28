'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { RouteTag, RouteCollection } from '@/lib/api/types';
import { Plus, Tag, Folder, FolderOpen, X, MoreVertical, Edit2, Trash2, Check } from 'lucide-react';
import { useRoutesStore } from '@/lib/stores/routesStore';

export function RoutesSidebar({
  onTagClick,
  onCollectionClick,
}: {
  onTagClick?: () => void;
  onCollectionClick?: () => void;
}) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const {
    selectedTagIds,
    toggleTag,
    setActiveCollectionId,
    activeCollectionId,
  } = useRoutesStore();

  const [showNewTagPopover, setShowNewTagPopover] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [showNewCollectionPopover, setShowNewCollectionPopover] = useState(false);
  const [newCollectionInput, setNewCollectionInput] = useState('');

  // Fetch tags
  const { data: tags = [] } = useQuery({
    queryKey: ['route-tags'],
    queryFn: () => authFetch<RouteTag[]>('/api/v1/routes/tags'),
    staleTime: 120_000,
  });

  // Fetch collections
  const { data: collections = [] } = useQuery({
    queryKey: ['route-collections'],
    queryFn: () => authFetch<RouteCollection[]>('/api/v1/routes/collections'),
    staleTime: 120_000,
  });

  // Create tag mutation
  const createTagMutation = useMutation({
    mutationFn: (data: { name: string }) =>
      authFetch<RouteTag>('/api/v1/routes/tags', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['route-tags'] });
      setNewTagInput('');
      setShowNewTagPopover(false);
      onTagClick?.();
    },
  });

  const handleCreateTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagInput.trim()) {
      createTagMutation.mutate({ name: newTagInput.trim() });
    }
  };

  const handleToggleTag = (id: string) => {
    toggleTag(id);
    onTagClick?.();
  };

  const handleCollectionClick = (id: string | null) => {
    setActiveCollectionId(id);
    onCollectionClick?.();
  };

  const activeTags = tags.filter((t) => selectedTagIds.includes(t.id));
  const collectionsWithActive = collections.map((c) => ({
    ...c,
    isActive: activeCollectionId === c.id,
  }));

  return (
    <div className="w-64 bg-surface border-r border-surface-light flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-surface-light">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">
          Organize
        </h2>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {/* Smart Collections */}
        {collectionsWithActive.length > 0 && (
          <div className="px-2 pb-2">
            <h3 className="text-xs text-muted uppercase tracking-wider mb-1 px-2">Collections</h3>
            {collectionsWithActive.map((col) => (
              <button
                key={col.id}
                onClick={() => handleCollectionClick(col.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg transition-colors ${
                  col.isActive
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted hover:text-white hover:bg-surface-light/50'
                }`}
              >
                {col.is_smart ? (
                  <Folder className="w-4 h-4" />
                ) : col.isActive ? (
                  <FolderOpen className="w-4 h-4" />
                ) : (
                  <Folder className="w-4 h-4" />
                )}
                <span className="truncate">{col.name}</span>
                {col.is_smart && (
                  <span className="ml-auto text-xs bg-accent/20 text-accent px-1.5 py-0.25 rounded">
                    auto
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={() => setShowNewCollectionPopover(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted hover:text-white hover:bg-surface-light/50 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Collection</span>
            </button>
          </div>
        )}

        {/* Divider */}
        {collectionsWithActive.length > 0 && (
          <div className="border-t border-surface-light/30 mx-4 my-2"></div>
        )}

        {/* Tags */}
        <div className="px-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs text-muted uppercase tracking-wider px-2">Tags</h3>
            <button
              onClick={() => setShowNewTagPopover(true)}
              className="p-1 text-muted hover:text-white hover:bg-surface-light/50 rounded transition-colors"
              aria-label="Add tag"
            >
              <Plus className="w-3 h-4" />
            </button>
          </div>

          {activeTags.length > 0 && (
            <div className="mb-2">
              <div className="flex flex-wrap gap-1 px-2">
                {activeTags.map((tag) => {
                  const tagColor = tag.color || '#64748b';
                  return (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                      style={{ backgroundColor: `${tagColor}33`, color: tagColor }}
                    >
                      <Tag className="w-3 h-3" />
                      {tag.name}
                      <button
                        onClick={() => handleToggleTag(tag.id)}
                        className="hover:opacity-70"
                        aria-label={`Remove tag filter ${tag.name}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {tags.length === 0 && !showNewTagPopover ? (
            <p className="text-xs text-muted px-2 py-1">No tags yet. Click + to create one.</p>
          ) : (
            tags.map((tag) => {
              const tagColor = tag.color || '#64748b';
              const isActive = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => handleToggleTag(tag.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg transition-colors ${
                    isActive
                      ? 'bg-accent/20 text-accent'
                      : 'text-muted hover:text-white hover:bg-surface-light/50'
                  }`}
                >
                  <Tag
                    className="w-4 h-4 flex-shrink-0"
                    style={{ color: isActive ? tagColor : 'currentColor' }}
                  />
                  <span className="truncate">{tag.name}</span>
                  {isActive && <Check className="w-3 h-3 ml-auto" />}
                </button>
              );
            })
          )}
        </div>
      </nav>
    </div>
  );
}
