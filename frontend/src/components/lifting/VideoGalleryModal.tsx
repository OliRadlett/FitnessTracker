'use client';

import React from 'react';
import type { LiftVideo } from '@/lib/api';
import { VideoEmbed } from '@/components/lifting/VideoEmbed';
import { Modal, ModalHeader } from '@/components/ui/Modal';

interface VideoGalleryModalProps {
  title: string;
  videos: LiftVideo[];
  open: boolean;
  onClose: () => void;
}

export function VideoGalleryModal({
  title,
  videos,
  open,
  onClose,
}: VideoGalleryModalProps) {
  return (
    <Modal open={open} onClose={onClose} size="lg" aria-label={title}>
      <ModalHeader title={title} onClose={onClose} icon="📹" />

      {videos.length === 0 ? (
        <p className="text-muted text-center py-8">No videos attached.</p>
      ) : (
        <div className="space-y-6">
          {videos.map((video) => (
            <div key={video.id} className="space-y-2">
              <VideoEmbed video={video} />
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span className="font-medium text-white">
                  {video.exercise_name ?? 'Uncategorized'}
                </span>
                {video.duration_seconds && (
                  <>
                    <span>•</span>
                    <span>{Math.round(video.duration_seconds)}s</span>
                  </>
                )}
                {video.notes && (
                  <>
                    <span>•</span>
                    <span>{video.notes}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
