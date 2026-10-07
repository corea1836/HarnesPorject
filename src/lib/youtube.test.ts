import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMetrics,
  extractChapters,
  fetchChannelData,
  parseChannelUrl,
  parseDuration,
  type Video,
} from "./youtube";

describe("parseChannelUrl", () => {
  it.each([
    ["https://www.youtube.com/@handle", "handle"],
    ["https://www.youtube.com/@handle/videos", "handle"],
    ["https://m.youtube.com/@handle", "handle"],
    ["youtube.com/@handle", "handle"],
    ["www.youtube.com/@handle/shorts", "handle"],
    ["@handle", "handle"],
    ["  https://www.youtube.com/@handle  ", "handle"],
    ["https://www.youtube.com/@handle?si=abc", "handle"],
  ])("%s → handle", (input, handle) => {
    expect(parseChannelUrl(input)).toEqual({ kind: "handle", handle });
  });

  it("퍼센트 인코딩된 한글 핸들을 디코딩한다", () => {
    expect(
      parseChannelUrl("https://www.youtube.com/@%EC%B9%A8%EC%B0%A9%EB%A7%A8"),
    ).toEqual({ kind: "handle", handle: "침착맨" });
    expect(parseChannelUrl("https://www.youtube.com/@침착맨")).toEqual({
      kind: "handle",
      handle: "침착맨",
    });
  });

  it("/channel/UC... 형식은 id로 파싱한다", () => {
    expect(
      parseChannelUrl("https://www.youtube.com/channel/UCabc_DEF-123"),
    ).toEqual({ kind: "id", id: "UCabc_DEF-123" });
    expect(parseChannelUrl("youtube.com/channel/UCabc123/videos")).toEqual({
      kind: "id",
      id: "UCabc123",
    });
  });

  it.each([
    "https://www.youtube.com/c/somename",
    "https://www.youtube.com/user/somename",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://example.com/@handle",
    "https://www.youtube.com/channel/notAnId",
    "@",
    "",
  ])("미지원 형식 %s 은 지원 형식 예시와 함께 throw한다", (input) => {
    expect(() => parseChannelUrl(input)).toThrow(/지원하지 않는.*@handle.*channel\/UC/);
  });
});

describe("parseDuration", () => {
  it.each([
    ["PT1H2M3S", 3723],
    ["PT45S", 45],
    ["PT3M", 180],
    ["P0D", 0],
    ["P1DT1S", 86401],
  ])("%s → %i초", (iso, sec) => {
    expect(parseDuration(iso)).toBe(sec);
  });
});

describe("extractChapters", () => {
  it("줄 맨 앞의 m:ss, mm:ss, h:mm:ss 타임스탬프와 제목을 뽑는다", () => {
    const description = [
      "영상 소개입니다.",
      "0:00 인트로",
      "  03:12 - 본론 시작",
      "1:02:03 마무리",
      "중간에 5:00 이 있는 줄은 무시",
    ].join("\n");

    expect(extractChapters(description)).toEqual([
      { start: "0:00", seconds: 0, title: "인트로" },
      { start: "03:12", seconds: 192, title: "본론 시작" },
      { start: "1:02:03", seconds: 3723, title: "마무리" },
    ]);
  });

  it("챕터가 없는 설명이면 빈 배열", () => {
    expect(extractChapters("그냥 설명\n구독 좋아요")).toEqual([]);
    expect(extractChapters("")).toEqual([]);
  });
});

type BaseVideo = Parameters<typeof addMetrics>[0][number];

function baseVideo(overrides: Partial<BaseVideo>): BaseVideo {
  return {
    id: "v",
    title: "t",
    description: "",
    publishedAt: "2026-09-27T00:00:00Z",
    durationSec: 600,
    isShort: false,
    views: 0,
    likes: 0,
    comments: 0,
    tags: [],
    chapters: [],
    ...overrides,
  };
}

describe("addMetrics", () => {
  const now = new Date("2026-10-07T00:00:00Z");

  it("롱폼·쇼츠 그룹별 중앙값으로 outlierScore를 계산한다", () => {
    const videos = addMetrics(
      [
        baseVideo({ id: "l1", views: 100 }),
        baseVideo({ id: "l2", views: 200 }),
        baseVideo({ id: "l3", views: 600 }),
        baseVideo({ id: "s1", views: 1000, isShort: true, durationSec: 30 }),
        baseVideo({ id: "s2", views: 3000, isShort: true, durationSec: 60 }),
      ],
      now,
    );
    const byId = Object.fromEntries(videos.map((v) => [v.id, v]));

    // 롱폼 중앙값 200
    expect(byId.l1.outlierScore).toBe(0.5);
    expect(byId.l3.outlierScore).toBe(3);
    // 쇼츠 중앙값 (1000 + 3000) / 2 = 2000
    expect(byId.s1.outlierScore).toBe(0.5);
    expect(byId.s2.outlierScore).toBe(1.5);
  });

  it("viewsPerDay와 engagementRate를 계산하고 입력 순서를 유지한다", () => {
    const [video] = addMetrics(
      [baseVideo({ views: 1000, likes: 40, comments: 10 })],
      now,
    );
    expect(video.viewsPerDay).toBe(100); // 10일 경과
    expect(video.engagementRate).toBe(0.05);
  });

  it("views가 0이면 engagementRate·outlierScore는 0", () => {
    const videos = addMetrics(
      [
        baseVideo({ id: "a", views: 0, likes: 3 }),
        baseVideo({ id: "b", views: 0 }),
      ],
      now,
    );
    expect(videos.map((v) => v.id)).toEqual(["a", "b"]);
    for (const v of videos) {
      expect(v.engagementRate).toBe(0);
      expect(v.outlierScore).toBe(0);
      expect(v.viewsPerDay).toBe(0);
    }
  });

  it("업로드 당일 영상은 경과 일수를 1로 본다", () => {
    const [video] = addMetrics(
      [baseVideo({ views: 500, publishedAt: "2026-10-06T21:00:00Z" })],
      now,
    );
    expect(video.viewsPerDay).toBe(500);
  });
});

describe("fetchChannelData", () => {
  const API_KEY = "SECRET-KEY-123";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const channelsResponse = {
    items: [
      {
        id: "UC123",
        snippet: { title: "테스트 채널" },
        statistics: { subscriberCount: "12345" },
        contentDetails: { relatedPlaylists: { uploads: "UU123" } },
      },
    ],
  };

  const playlistResponse = {
    items: [
      { contentDetails: { videoId: "a" } },
      { contentDetails: { videoId: "b" } },
      { contentDetails: { videoId: "live" } },
    ],
  };

  const videosResponse = {
    items: [
      {
        id: "a",
        snippet: {
          title: "롱폼",
          description: "0:00 인트로\n5:30 본론",
          publishedAt: "2026-10-01T00:00:00Z",
          tags: ["게임"],
        },
        statistics: { viewCount: "1000", likeCount: "50", commentCount: "10" },
        contentDetails: { duration: "PT12M" },
      },
      {
        id: "b",
        snippet: {
          title: "쇼츠",
          description: "",
          publishedAt: "2026-10-02T00:00:00Z",
        },
        statistics: { viewCount: "300" },
        contentDetails: { duration: "PT45S" },
      },
      {
        id: "live",
        snippet: {
          title: "예정된 라이브",
          description: "",
          publishedAt: "2026-10-08T00:00:00Z",
        },
        statistics: { viewCount: "0" },
        contentDetails: { duration: "P0D" },
      },
    ],
  };

  function stubYouTube(channels: unknown = channelsResponse) {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/channels")) return json(channels);
      if (url.pathname.endsWith("/playlistItems")) return json(playlistResponse);
      if (url.pathname.endsWith("/videos")) return json(videosResponse);
      throw new Error(`unexpected ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function calledUrls(fetchMock: ReturnType<typeof stubYouTube>) {
    return fetchMock.mock.calls.map(([input]) => new URL(String(input)));
  }

  it("핸들이면 forHandle로 channels → playlistItems → videos를 3번 호출한다", async () => {
    const fetchMock = stubYouTube();
    await fetchChannelData("https://www.youtube.com/@tester", API_KEY);

    const [channels, playlist, videos] = calledUrls(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(channels.origin + channels.pathname).toBe(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    expect(channels.searchParams.get("part")).toBe(
      "snippet,statistics,contentDetails",
    );
    expect(channels.searchParams.get("forHandle")).toBe("tester");
    expect(channels.searchParams.has("id")).toBe(false);
    expect(channels.searchParams.get("key")).toBe(API_KEY);

    expect(playlist.pathname).toBe("/youtube/v3/playlistItems");
    expect(playlist.searchParams.get("part")).toBe("contentDetails");
    expect(playlist.searchParams.get("playlistId")).toBe("UU123");
    expect(playlist.searchParams.get("maxResults")).toBe("50");
    expect(playlist.searchParams.get("key")).toBe(API_KEY);

    expect(videos.pathname).toBe("/youtube/v3/videos");
    expect(videos.searchParams.get("part")).toBe(
      "snippet,statistics,contentDetails",
    );
    expect(videos.searchParams.get("id")).toBe("a,b,live");
    expect(videos.searchParams.get("key")).toBe(API_KEY);
  });

  it("채널 ID URL이면 id 파라미터를 쓴다", async () => {
    const fetchMock = stubYouTube();
    await fetchChannelData("https://www.youtube.com/channel/UC123", API_KEY);

    const [channels] = calledUrls(fetchMock);
    expect(channels.searchParams.get("id")).toBe("UC123");
    expect(channels.searchParams.has("forHandle")).toBe(false);
  });

  it("채널과 영상을 변환하고 누락 값은 0, 0초 영상은 제외한다", async () => {
    stubYouTube();
    const { channel, videos } = await fetchChannelData("@tester", API_KEY);

    expect(channel).toEqual({ id: "UC123", title: "테스트 채널", subscribers: 12345 });
    expect(videos.map((v) => v.id)).toEqual(["a", "b"]);

    const [long, short] = videos;
    expect(long).toMatchObject<Partial<Video>>({
      title: "롱폼",
      durationSec: 720,
      isShort: false,
      views: 1000,
      likes: 50,
      comments: 10,
      tags: ["게임"],
      chapters: [
        { start: "0:00", seconds: 0, title: "인트로" },
        { start: "5:30", seconds: 330, title: "본론" },
      ],
      engagementRate: 0.06,
      outlierScore: 1,
    });
    expect(short).toMatchObject<Partial<Video>>({
      durationSec: 45,
      isShort: true,
      views: 300,
      likes: 0,
      comments: 0,
      tags: [],
      chapters: [],
    });
  });

  it("구독자 수가 비공개면 subscribers는 null", async () => {
    stubYouTube({
      items: [
        {
          ...channelsResponse.items[0],
          statistics: { hiddenSubscriberCount: true },
        },
      ],
    });
    const { channel } = await fetchChannelData("@tester", API_KEY);
    expect(channel.subscribers).toBeNull();
  });

  it("채널이 없으면 한국어 메시지로 throw한다", async () => {
    const fetchMock = stubYouTube({ items: [] });
    await expect(fetchChannelData("@nobody", API_KEY)).rejects.toThrow(
      /채널을 찾을 수 없습니다/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, "quotaExceeded", /YouTube API 일일 할당량 초과/],
    [400, "badRequest", /YouTube API 키를 확인하세요/],
    [400, "keyInvalid", /YouTube API 키를 확인하세요/],
    [403, "forbidden", /YouTube API 키를 확인하세요/],
    [500, "backendError", /YouTube API/],
  ])(
    "%i %s 에러 응답은 상태 코드·reason을 담아 throw하고 키는 노출하지 않는다",
    async (status, reason, pattern) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json(
            {
              error: {
                code: status,
                message:
                  reason === "badRequest"
                    ? "API key not valid. Please pass a valid API key."
                    : "error",
                errors: [{ reason }],
              },
            },
            status,
          ),
        ),
      );

      const error = await fetchChannelData("@tester", API_KEY).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(pattern);
      expect(message).toContain(String(status));
      expect(message).toContain(reason);
      expect(message).not.toContain(API_KEY);
    },
  );

  it("잘못된 채널 URL이면 fetch 없이 throw한다", async () => {
    const fetchMock = stubYouTube();
    await expect(
      fetchChannelData("https://www.youtube.com/c/old", API_KEY),
    ).rejects.toThrow(/지원하지 않는/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
