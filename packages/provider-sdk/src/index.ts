import type {
  NormalizedTrack,
  PlayableSource,
  PlaybackMode,
  ProviderCapabilities,
  ProviderDescriptor,
} from "@hitster/shared";

export interface MusicProvider extends ProviderDescriptor {
  searchTracks(query: string): Promise<NormalizedTrack[]>;
  getTrack(trackId: string): Promise<NormalizedTrack | null>;
  getPlayableSource(track: NormalizedTrack): Promise<PlayableSource | null>;
  getDefaultPlaybackMode(): PlaybackMode;
}

class ManualProvider implements MusicProvider {
  readonly id = "manual";
  readonly name = "Manual / Any Music App";
  readonly capabilities: ProviderCapabilities = {
    authRequired: false,
    search: false,
    previewPlayback: false,
    remotePlayback: false,
    embeddedPlayback: false,
    manualPlayback: true,
  };

  getDefaultPlaybackMode(): PlaybackMode {
    return "external_manual";
  }

  async searchTracks(): Promise<NormalizedTrack[]> {
    return [];
  }

  async getTrack(): Promise<NormalizedTrack | null> {
    return null;
  }

  async getPlayableSource(): Promise<PlayableSource | null> {
    return { type: "external_only" };
  }
}

type ItunesResult = {
  trackId: number;
  artistName: string;
  trackName: string;
  collectionName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
};

class ItunesPreviewProvider implements MusicProvider {
  readonly id = "itunes_preview";
  readonly name = "iTunes Preview";
  readonly capabilities: ProviderCapabilities = {
    authRequired: false,
    search: true,
    previewPlayback: true,
    remotePlayback: false,
    embeddedPlayback: false,
    manualPlayback: false,
  };

  getDefaultPlaybackMode(): PlaybackMode {
    return "preview";
  }

  async searchTracks(query: string): Promise<NormalizedTrack[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", trimmedQuery);
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "20");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`iTunes search failed with ${response.status}`);
    }

    const payload = (await response.json()) as { results?: ItunesResult[] };
    return (payload.results ?? []).map((track) => normalizeItunesTrack(track));
  }

  async getTrack(trackId: string): Promise<NormalizedTrack | null> {
    const url = new URL("https://itunes.apple.com/lookup");
    url.searchParams.set("id", trackId);
    url.searchParams.set("entity", "song");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`iTunes lookup failed with ${response.status}`);
    }

    const payload = (await response.json()) as { results?: ItunesResult[] };
    const result = payload.results?.find((item) => item.trackId);

    return result ? normalizeItunesTrack(result) : null;
  }

  async getPlayableSource(track: NormalizedTrack): Promise<PlayableSource | null> {
    if (!track.previewUrl) {
      return null;
    }

    return {
      type: "preview_url",
      url: track.previewUrl,
    };
  }
}

type YouTubeSearchResult = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

type YouTubeVideoResult = {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

class YouTubeEmbedProvider implements MusicProvider {
  readonly id = "youtube_embed";
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly apiKey: string | undefined) {
    const enabled = Boolean(apiKey);
    this.name = enabled ? "YouTube Embed" : "YouTube Embed (requires API key)";
    this.capabilities = {
      authRequired: false,
      search: enabled,
      previewPlayback: false,
      remotePlayback: false,
      embeddedPlayback: true,
      manualPlayback: false,
    };
  }

  getDefaultPlaybackMode(): PlaybackMode {
    return "embed";
  }

  async searchTracks(query: string): Promise<NormalizedTrack[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const url = this.createApiUrl("search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", `${trimmedQuery} official audio`);
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("videoCategoryId", "10");
    url.searchParams.set("maxResults", "20");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YouTube search failed with ${response.status}`);
    }

    const payload = (await response.json()) as { items?: YouTubeSearchResult[] };
    return (payload.items ?? [])
      .map((item) => normalizeYoutubeTrack(item.id?.videoId, item.snippet))
      .filter((track): track is NormalizedTrack => Boolean(track));
  }

  async getTrack(trackId: string): Promise<NormalizedTrack | null> {
    const url = this.createApiUrl("videos");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", trackId);
    url.searchParams.set("maxResults", "1");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YouTube lookup failed with ${response.status}`);
    }

    const payload = (await response.json()) as { items?: YouTubeVideoResult[] };
    const item = payload.items?.[0];
    return item ? normalizeYoutubeTrack(item.id, item.snippet) : null;
  }

  async getPlayableSource(track: NormalizedTrack): Promise<PlayableSource | null> {
    return {
      type: "embed",
      embedUrl: `https://www.youtube.com/embed/${track.providerTrackId}?enablejsapi=1&playsinline=1&rel=0`,
    };
  }

  private createApiUrl(resource: "search" | "videos"): URL {
    if (!this.apiKey) {
      throw new Error("YouTube Embed requires YOUTUBE_API_KEY on the server");
    }

    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.searchParams.set("key", this.apiKey);
    return url;
  }
}

function normalizeItunesTrack(track: ItunesResult): NormalizedTrack {
  return {
    id: `itunes:${track.trackId}`,
    provider: "itunes_preview",
    providerTrackId: String(track.trackId),
    title: track.trackName,
    artists: [track.artistName],
    album: track.collectionName,
    releaseYear: track.releaseDate ? new Date(track.releaseDate).getUTCFullYear() : undefined,
    durationMs: track.trackTimeMillis,
    artworkUrl: track.artworkUrl100?.replace("100x100bb", "512x512bb"),
    previewUrl: track.previewUrl ?? null,
    externalUrl: track.trackViewUrl ?? null,
  };
}

function normalizeYoutubeTrack(
  videoId: string | undefined,
  snippet: YouTubeSearchResult["snippet"] | YouTubeVideoResult["snippet"] | undefined,
): NormalizedTrack | null {
  if (!videoId || !snippet?.title || !snippet.channelTitle) {
    return null;
  }

  return {
    id: `youtube:${videoId}`,
    provider: "youtube_embed",
    providerTrackId: videoId,
    title: snippet.title,
    artists: [snippet.channelTitle],
    releaseYear: snippet.publishedAt ? new Date(snippet.publishedAt).getUTCFullYear() : undefined,
    artworkUrl:
      snippet.thumbnails?.high?.url ??
      snippet.thumbnails?.medium?.url ??
      snippet.thumbnails?.default?.url,
    previewUrl: null,
    externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

const providers: MusicProvider[] = [
  new ManualProvider(),
  new ItunesPreviewProvider(),
  new YouTubeEmbedProvider(process.env.YOUTUBE_API_KEY),
];

export function listProviders(): MusicProvider[] {
  return providers;
}

export function resolveProvider(providerId: string): MusicProvider | undefined {
  return providers.find((provider) => provider.id === providerId);
}
