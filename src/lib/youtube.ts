export type ChannelRef =
  | { kind: "handle"; handle: string } // "@" 없이 저장
  | { kind: "id"; id: string }; // "UC..."

export type Chapter = { start: string; seconds: number; title: string }; // start는 설명란에 적힌 그대로 ("3:12")

export type Channel = {
  id: string;
  title: string;
  subscribers: number | null; // 구독자 수 비공개면 null
};

export type Video = {
  id: string;
  title: string;
  description: string;
  publishedAt: string; // ISO 문자열
  durationSec: number;
  isShort: boolean; // durationSec <= 180
  views: number;
  likes: number; // 비공개/누락이면 0
  comments: number; // 비공개/누락이면 0
  tags: string[];
  chapters: Chapter[];
  viewsPerDay: number;
  outlierScore: number; // 평소 대비 배수
  engagementRate: number;
};

type BaseVideo = Omit<Video, "viewsPerDay" | "outlierScore" | "engagementRate">;

const API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_VIDEOS = 50;
const SHORT_MAX_SEC = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

// ---------- 채널 URL ----------

export function parseChannelUrl(input: string): ChannelRef {
  const trimmed = input.trim();
  const ref = trimmed.startsWith("@") ? handleRef(trimmed.slice(1)) : urlRef(trimmed);
  if (!ref) {
    throw new Error(
      `지원하지 않는 채널 URL 형식입니다: "${trimmed}". ` +
        "https://www.youtube.com/@handle 또는 https://www.youtube.com/channel/UC... 형식으로 입력하세요.",
    );
  }
  return ref;
}

function urlRef(input: string): ChannelRef | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  const [first = "", second = ""] = url.pathname.split("/").filter(Boolean);
  if (first.startsWith("@")) return handleRef(first.slice(1));
  if (first === "channel" && /^UC[\w-]+$/.test(second)) return { kind: "id", id: second };
  return null;
}

function handleRef(raw: string): ChannelRef | null {
  let handle: string;
  try {
    handle = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return handle && !/[\s/?#]/.test(handle) ? { kind: "handle", handle } : null;
}

// ---------- 영상 길이·챕터 ----------

export function parseDuration(iso: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!match) return 0;
  const [, d = "0", h = "0", m = "0", s = "0"] = match;
  return Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export function extractChapters(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const match = /^\s*(\d{1,2}(?::[0-5]\d){1,2})(?!\d)(.*)$/.exec(line);
    if (!match) continue;
    const [, start, rest] = match;
    const seconds = start.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
    const title = rest.replace(/^[\s\-–—:|.)]+/, "").trim();
    chapters.push({ start, seconds, title });
  }
  return chapters;
}

// ---------- 지표 ----------

export function addMetrics(videos: BaseVideo[], now: Date = new Date()): Video[] {
  const medianViews = {
    short: median(videos.filter((v) => v.isShort).map((v) => v.views)),
    long: median(videos.filter((v) => !v.isShort).map((v) => v.views)),
  };

  return videos.map((video) => {
    const days = (now.getTime() - new Date(video.publishedAt).getTime()) / DAY_MS;
    const groupMedian = video.isShort ? medianViews.short : medianViews.long;
    return {
      ...video,
      viewsPerDay: video.views / Math.max(1, days),
      outlierScore: groupMedian === 0 ? 0 : video.views / groupMedian,
      engagementRate: video.views === 0 ? 0 : (video.likes + video.comments) / video.views,
    };
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------- YouTube Data API ----------

type ChannelsResponse = {
  items?: {
    id: string;
    snippet: { title: string };
    statistics?: { subscriberCount?: string };
    contentDetails: { relatedPlaylists: { uploads: string } };
  }[];
};

type PlaylistItemsResponse = {
  items?: { contentDetails: { videoId: string } }[];
};

type VideosResponse = {
  items?: {
    id: string;
    snippet: { title: string; description?: string; publishedAt: string; tags?: string[] };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails: { duration: string };
  }[];
};

type ErrorResponse = {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
};

export async function fetchChannelData(
  channelUrl: string,
  apiKey: string,
): Promise<{ channel: Channel; videos: Video[] }> {
  const ref = parseChannelUrl(channelUrl);

  const channels = await getJson<ChannelsResponse>("channels", apiKey, {
    part: "snippet,statistics,contentDetails",
    ...(ref.kind === "handle" ? { forHandle: ref.handle } : { id: ref.id }),
  });
  const item = channels.items?.[0];
  if (!item) {
    throw new Error(
      `채널을 찾을 수 없습니다: ${ref.kind === "handle" ? `@${ref.handle}` : ref.id}`,
    );
  }
  const subscriberCount = item.statistics?.subscriberCount;
  const channel: Channel = {
    id: item.id,
    title: item.snippet.title,
    subscribers: subscriberCount === undefined ? null : Number(subscriberCount),
  };

  const playlist = await getJson<PlaylistItemsResponse>("playlistItems", apiKey, {
    part: "contentDetails",
    playlistId: item.contentDetails.relatedPlaylists.uploads,
    maxResults: String(MAX_VIDEOS),
  });
  const videoIds = (playlist.items ?? []).map((i) => i.contentDetails.videoId);
  if (videoIds.length === 0) return { channel, videos: [] };

  const videosRes = await getJson<VideosResponse>("videos", apiKey, {
    part: "snippet,statistics,contentDetails",
    id: videoIds.join(","),
  });
  const videos: BaseVideo[] = [];
  for (const v of videosRes.items ?? []) {
    const durationSec = parseDuration(v.contentDetails.duration);
    if (durationSec === 0) continue; // 라이브·예정 영상
    const description = v.snippet.description ?? "";
    videos.push({
      id: v.id,
      title: v.snippet.title,
      description,
      publishedAt: v.snippet.publishedAt,
      durationSec,
      isShort: durationSec <= SHORT_MAX_SEC,
      views: Number(v.statistics?.viewCount ?? 0),
      likes: Number(v.statistics?.likeCount ?? 0),
      comments: Number(v.statistics?.commentCount ?? 0),
      tags: v.snippet.tags ?? [],
      chapters: extractChapters(description),
    });
  }

  return { channel, videos: addMetrics(videos) };
}

async function getJson<T>(
  endpoint: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<T> {
  const query = new URLSearchParams({ ...params, key: apiKey });
  const res = await fetch(`${API_BASE}/${endpoint}?${query}`);
  const body: unknown = await res.json().catch(() => null);
  // 요청 URL에 키가 들어 있으므로 에러 메시지에는 상태 코드와 reason만 담는다.
  if (!res.ok) throw new Error(apiErrorMessage(endpoint, res.status, body as ErrorResponse | null));
  return body as T;
}

function apiErrorMessage(endpoint: string, status: number, body: ErrorResponse | null): string {
  const reason = body?.error?.errors?.[0]?.reason ?? "unknown";
  const detail = `(${endpoint} ${status} ${reason})`;
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return `YouTube API 일일 할당량 초과 ${detail}. 내일 다시 시도하세요.`;
  }
  if (status === 400 || status === 403) {
    return `YouTube API 키를 확인하세요 ${detail}. 키가 올바른지, YouTube Data API v3가 활성화돼 있는지 확인하세요.`;
  }
  return `YouTube API 요청 실패 ${detail}`;
}
