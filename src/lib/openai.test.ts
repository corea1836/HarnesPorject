import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeChannel,
  buildPrompt,
  validateAnalysis,
  type ChannelAnalysis,
} from "./openai";
import type { Channel, Video } from "./youtube";

const channel: Channel = { id: "UC123", title: "테스트 채널", subscribers: 12345 };

function video(overrides: Partial<Video>): Video {
  return {
    id: "v",
    title: "t",
    description: "",
    publishedAt: "2026-10-01T00:00:00Z",
    durationSec: 720,
    isShort: false,
    views: 1000,
    likes: 50,
    comments: 10,
    tags: [],
    chapters: [],
    viewsPerDay: 166.6667,
    outlierScore: 1,
    engagementRate: 0.06,
    ...overrides,
  };
}

const longWithChapters = video({
  id: "long1",
  title: "롱폼 영상 제목",
  description: "0:00 인트로\n5:30 본론",
  publishedAt: "2026-09-15T12:00:00Z",
  durationSec: 3723,
  views: 54321,
  viewsPerDay: 2500.4,
  outlierScore: 2.5,
  engagementRate: 0.0456,
  tags: ["태그1", "태그2", "태그3", "태그4", "태그5", "태그6"],
  chapters: [
    { start: "0:00", seconds: 0, title: "인트로" },
    { start: "5:30", seconds: 330, title: "본론" },
  ],
});
const longNoChapters = video({ id: "long2", title: "챕터 없는 롱폼" });
const short = video({ id: "short1", title: "쇼츠 영상", durationSec: 45, isShort: true });
const videos = [longWithChapters, longNoChapters, short];

function candidate(
  overrides: Partial<ChannelAnalysis["shortsCandidates"][number]>,
): ChannelAnalysis["shortsCandidates"][number] {
  return {
    videoId: "long1",
    chapterStart: null,
    hook: "훅",
    reason: "이유",
    score: 5,
    ...overrides,
  };
}

function analysis(candidates: ChannelAnalysis["shortsCandidates"]): ChannelAnalysis {
  return {
    channelSummary: "요약",
    categories: [{ name: "게임", description: "게임 실황" }],
    shortsCandidates: candidates,
  };
}

describe("buildPrompt", () => {
  const prompt = buildPrompt(channel, videos);

  it("채널명·구독자 수·분석 영상 수를 넣는다", () => {
    expect(prompt).toContain("테스트 채널");
    expect(prompt).toContain("12345");
    expect(prompt).toMatch(/분석 영상 수: 3개/);
  });

  it("구독자 수가 비공개면 비공개로 표시한다", () => {
    expect(buildPrompt({ ...channel, subscribers: null }, videos)).toMatch(
      /구독자 수: 비공개/,
    );
  });

  it("영상마다 id·제목·형식·업로드일·길이를 넣는다", () => {
    for (const v of videos) {
      expect(prompt).toContain(v.id);
      expect(prompt).toContain(v.title);
    }
    expect(prompt).toContain("롱폼");
    expect(prompt).toContain("쇼츠");
    expect(prompt).toContain("2026-09-15");
    expect(prompt).toContain("1:02:03"); // 3723초
    expect(prompt).toContain("0:45"); // 45초
  });

  it("지표(조회수·일평균 조회수·평소 대비 배수·참여율)를 넣는다", () => {
    expect(prompt).toContain("54321");
    expect(prompt).toContain("2500"); // 일평균 조회수 반올림
    expect(prompt).toContain("2.50배");
    expect(prompt).toContain("4.56%");
  });

  it("태그는 앞 5개만 넣는다", () => {
    expect(prompt).toContain("태그5");
    expect(prompt).not.toContain("태그6");
  });

  it("챕터를 'start 제목' 형식으로 넣는다", () => {
    expect(prompt).toContain("0:00 인트로");
    expect(prompt).toContain("5:30 본론");
  });

  it("설명은 앞 300자로 자른다", () => {
    const description = "가".repeat(300) + "TRUNCATED_TAIL";
    const p = buildPrompt(channel, [video({ description })]);
    expect(p).toContain("가".repeat(300));
    expect(p).not.toContain("TRUNCATED");
  });

  it("롱폼 중에서만 후보를 고르고 챕터 시간을 지어내지 말라고 요청한다", () => {
    expect(prompt).toContain("channelSummary");
    expect(prompt).toContain("categories");
    expect(prompt).toContain("shortsCandidates");
    expect(prompt).toContain("chapterStart");
    expect(prompt).toMatch(/롱폼 영상 중에서만/);
    expect(prompt).toMatch(/null/);
    expect(prompt).toMatch(/지어내지/);
    expect(prompt).toMatch(/한국어/);
  });
});

describe("validateAnalysis", () => {
  it("입력에 없는 videoId 후보는 제거한다", () => {
    const result = validateAnalysis(
      analysis([candidate({ videoId: "long1" }), candidate({ videoId: "ghost" })]),
      videos,
    );
    expect(result.shortsCandidates.map((c) => c.videoId)).toEqual(["long1"]);
  });

  it("쇼츠 영상을 가리키는 후보는 제거한다", () => {
    const result = validateAnalysis(
      analysis([candidate({ videoId: "short1" }), candidate({ videoId: "long2" })]),
      videos,
    );
    expect(result.shortsCandidates.map((c) => c.videoId)).toEqual(["long2"]);
  });

  it("chapterStart가 해당 영상 챕터에 없으면 null로 바꾼다", () => {
    const result = validateAnalysis(
      analysis([
        candidate({ videoId: "long1", chapterStart: "5:30", score: 9 }),
        candidate({ videoId: "long1", chapterStart: "7:77", score: 8 }),
        candidate({ videoId: "long2", chapterStart: "0:00", score: 7 }),
        candidate({ videoId: "long1", chapterStart: null, score: 6 }),
      ]),
      videos,
    );
    expect(result.shortsCandidates.map((c) => c.chapterStart)).toEqual([
      "5:30",
      null,
      null,
      null,
    ]);
  });

  it("score는 반올림 후 1~10으로 clamp한다", () => {
    const result = validateAnalysis(
      analysis([
        candidate({ score: 7.6 }),
        candidate({ score: 15 }),
        candidate({ score: -3 }),
        candidate({ score: 0.4 }),
        candidate({ score: 3.2 }),
      ]),
      videos,
    );
    expect(result.shortsCandidates.map((c) => c.score)).toEqual([10, 8, 3, 1, 1]);
  });

  it("score 내림차순으로 정렬하고 최대 6개만 남긴다", () => {
    const scores = [3, 9, 5, 1, 7, 10, 2, 8];
    const result = validateAnalysis(
      analysis(scores.map((score) => candidate({ score, hook: `훅${score}` }))),
      videos,
    );
    expect(result.shortsCandidates.map((c) => c.score)).toEqual([10, 9, 8, 7, 5, 3]);
    expect(result.shortsCandidates[0].hook).toBe("훅10");
  });

  it("요약·카테고리와 후보의 나머지 필드는 그대로 둔다", () => {
    const input = analysis([
      candidate({ videoId: "long1", chapterStart: "0:00", hook: "첫 3초", reason: "근거", score: 6 }),
    ]);
    expect(validateAnalysis(input, videos)).toEqual(input);
  });

  it("입력 객체를 변경하지 않고 새 객체를 반환한다", () => {
    const input = analysis([
      candidate({ videoId: "ghost", score: 9 }),
      candidate({ videoId: "long1", chapterStart: "9:99", score: 3.4 }),
      candidate({ videoId: "long2", score: 12 }),
    ]);
    const snapshot = structuredClone(input);

    const result = validateAnalysis(input, videos);

    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
    expect(result.shortsCandidates).not.toBe(input.shortsCandidates);
    expect(result.shortsCandidates[1]).not.toBe(input.shortsCandidates[1]);
  });
});

describe("analyzeChannel", () => {
  function mockClient(response: unknown) {
    const parse = vi.fn().mockResolvedValue(response);
    const client = { responses: { parse } } as unknown as OpenAI;
    return { client, parse };
  }

  const parsedOutput = analysis([
    candidate({ videoId: "ghost", score: 10 }),
    candidate({ videoId: "short1", score: 9 }),
    candidate({ videoId: "long1", chapterStart: "5:30", score: 8.7 }),
    candidate({ videoId: "long2", chapterStart: "1:00", score: 4 }),
  ]);

  const completed = {
    status: "completed",
    incomplete_details: null,
    output: [],
    output_parsed: parsedOutput,
  };

  it("gpt-6.1-sol을 구조화 응답(strict json_schema)으로 1회 호출한다", async () => {
    const { client, parse } = mockClient(completed);
    await analyzeChannel(channel, videos, client);

    expect(parse).toHaveBeenCalledTimes(1);
    const params = parse.mock.calls[0][0];
    expect(params).toMatchObject({
      model: "gpt-6.1-sol",
      max_output_tokens: 16000,
      reasoning: { effort: "medium" },
      input: buildPrompt(channel, videos),
    });
    expect(params.text.format).toMatchObject({
      type: "json_schema",
      name: "channel_analysis",
      strict: true,
    });
    for (const key of ["temperature", "top_p", "stream", "tools"]) {
      expect(params).not.toHaveProperty(key);
    }
  });

  it("정상 응답은 validateAnalysis를 거쳐 반환한다", async () => {
    const { client } = mockClient(completed);
    const result = await analyzeChannel(channel, videos, client);
    expect(result).toEqual(validateAnalysis(parsedOutput, videos));
    expect(result.shortsCandidates).toEqual([
      candidate({ videoId: "long1", chapterStart: "5:30", score: 9 }),
      candidate({ videoId: "long2", chapterStart: null, score: 4 }),
    ]);
  });

  it("refusal이면 한국어 메시지로 throw한다", async () => {
    const { client } = mockClient({
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "I can't help with that." }],
        },
      ],
      output_parsed: null,
    });
    await expect(analyzeChannel(channel, videos, client)).rejects.toThrow(/거절/);
  });

  it("응답이 잘려 output_parsed가 null이면 이유를 담아 throw한다", async () => {
    const { client } = mockClient({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
      output_parsed: null,
    });
    await expect(analyzeChannel(channel, videos, client)).rejects.toThrow(/max_output_tokens/);
  });

  it("SDK 에러는 삼키지 않고 그대로 던진다", async () => {
    const error = new Error("401 invalid_api_key");
    const parse = vi.fn().mockRejectedValue(error);
    const client = { responses: { parse } } as unknown as OpenAI;
    await expect(analyzeChannel(channel, videos, client)).rejects.toBe(error);
  });
});
