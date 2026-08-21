import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import React from 'react';
import { Image, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

export type ViewableEventMedia = {
  uri: string;
  mediaType?: 'image' | 'video';
  mimeType?: string;
};

export const isVideoMedia = (media: ViewableEventMedia) => {
  const mediaText = `${media.mediaType || ''} ${media.mimeType || ''} ${media.uri || ''}`.toLowerCase();
  return /video|\.mp4(?:\?|$)|\.mov(?:\?|$)|\.m4v(?:\?|$)|\.webm(?:\?|$)/.test(mediaText);
};

export function EventMediaThumbnail({ media, style }: { media: ViewableEventMedia; style?: StyleProp<ViewStyle> }) {
  if (!isVideoMedia(media)) {
    return <Image source={{ uri: media.uri }} style={style as any} resizeMode="cover" />;
  }
  return (
    <View style={[styles.videoThumb, style]}>
      <Ionicons name="play-circle" size={34} color="#FFFFFF" />
      <Text style={styles.videoLabel}>動画</Text>
    </View>
  );
}

export function EventMediaViewer({ media, style }: { media: ViewableEventMedia; style?: StyleProp<ViewStyle> }) {
  const isVideo = isVideoMedia(media);
  const player = useVideoPlayer(isVideo ? media.uri : null, currentPlayer => {
    currentPlayer.loop = false;
  });

  if (isVideo) {
    return <VideoView player={player} style={style} nativeControls contentFit="contain" />;
  }
  return <Image source={{ uri: media.uri }} style={style as any} resizeMode="contain" />;
}

const styles = StyleSheet.create({
  videoThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#56727A',
  },
  videoLabel: {
    marginTop: 2,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
