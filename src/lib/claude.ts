import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Channel, Video } from "./youtube";

export const AnalysisSchema = z.object({
  channelSummary: z.string(),
  categories: z.array(z.object({ name: z.string(), description: z.string() })),
  shortsCandidates: z.array(
    z.object({
      videoId: z.string(),
      chapterStart: z.string().nullable(), // 해당 영상 Chapter.start 값 그대로, 없으면 null
      hook: z.string(),
      reason: z.string(),
      score: z.number(), // 1~10
    }),
  ),
});
export type ChannelAnalysis = z.infer<typeof AnalysisSchema>;

const MODEL = "claude-opus-5-5";
const MAX_CANDIDATES = 6;
const MAX_TAGS = 5;
const MAX_DESCRIPTION_CHARS = 300;

// ---------- 프롬프트 ----------

export function buildPrompt(channel: Channel, videos: Video[]): string {
  const longCount = videos.filter((v) => !v.isShort).length;
  const subscribers = channel.subscribers === null ? "비공개" : `${channel.subscribers}명`;

  return `당신은 유튜브 쇼츠 기획자입니다. 아래 채널의 최근 업로드 영상 데이터를 보고 이 채널이 어떤 콘텐츠를 하는지 파악한 뒤, 롱폼 영상 중 쇼츠로 잘라낼 만한 영상을 추천하세요.

지표는 모두 코드로 계산한 값입니다.
- 일평균 조회수: 조회수 / 업로드 후 경과 일수
- 평소 대비 배수: 같은 형식(롱폼·쇼츠) 영상들의 조회수 중앙값 대비 이 영상의 조회수
- 참여율: (좋아요 + 댓글) / 조회수

## 채널
- 채널명: ${channel.title}
- 구독자 수: ${subscribers}
- 분석 영상 수: ${videos.length}개 (롱폼 ${longCount}개, 쇼츠 ${videos.length - longCount}개)

## 영상
${videos.map((v, i) => formatVideo(v, i + 1)).join("\n\n")}

## 요청
1. channelSummary: 이 채널이 어떤 콘텐츠를 하는지 한 단락으로 요약하세요.
2. categories: 주요 콘텐츠 카테고리 3~6개를 name(카테고리 이름)과 description(한 문장 설명)으로 쓰세요.
3. shortsCandidates: 롱폼 영상 중에서만 쇼츠로 잘라낼 만한 영상을 최대 6개 고르세요. 쇼츠 영상은 후보에 넣지 마세요. 평소 대비 배수·참여율이 높고 짧게 떼어내도 이해되는 장면이 있는 영상을 우선하고, 이미 성과가 좋은 쇼츠의 주제를 참고하세요. 롱폼 영상이 없으면 빈 배열로 두세요.
   - videoId: 위 영상 목록의 id 값 그대로
   - chapterStart: 그 영상의 챕터 목록에 있는 start 값 중 하나를 그대로 쓰세요. 적절한 챕터가 없거나 챕터가 없으면 null로 두세요. 시간을 지어내지 마세요.
   - hook: 쇼츠 첫 3초에 쓸 자막/제목, 30자 이내
   - reason: 왜 쇼츠로 터질 만한지 2~3문장, 지표 근거 포함
   - score: 1~10 정수

모든 텍스트는 한국어로 쓰세요.`;
}

function formatVideo(video: Video, index: number): string {
  const chapters =
    video.chapters.length === 0
      ? " 없음"
      : video.chapters.map((c) => `\n  - ${c.start} ${c.title}`).join("");
  return [
    `### 영상 ${index}`,
    `- id: ${video.id}`,
    `- 제목: ${video.title}`,
    `- 형식: ${video.isShort ? "쇼츠" : "롱폼"}`,
    `- 업로드일: ${video.publishedAt.slice(0, 10)}`,
    `- 길이: ${formatDuration(video.durationSec)}`,
    `- 조회수: ${video.views}`,
    `- 일평균 조회수: ${Math.round(video.viewsPerDay)}`,
    `- 평소 대비 배수: ${video.outlierScore.toFixed(2)}배`,
    `- 참여율: ${(video.engagementRate * 100).toFixed(2)}%`,
    `- 태그: ${video.tags.slice(0, MAX_TAGS).join(", ") || "없음"}`,
    `- 설명: ${truncate(video.description.replace(/\s+/g, " ").trim(), MAX_DESCRIPTION_CHARS) || "없음"}`,
    `- 챕터:${chapters}`,
  ].join("\n");
}

// 챕터 start와 같은 "m:ss" / "h:mm:ss" 형식
function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = String(totalSec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text); // 이모지 등 서로게이트 쌍이 깨지지 않게
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : text;
}

// ---------- 응답 검증 (ADR-004) ----------

export function validateAnalysis(analysis: ChannelAnalysis, videos: Video[]): ChannelAnalysis {
  const videosById = new Map(videos.map((v) => [v.id, v]));

  const shortsCandidates = analysis.shortsCandidates
    .flatMap((candidate) => {
      const video = videosById.get(candidate.videoId);
      if (!video || video.isShort) return [];
      const chapterExists = video.chapters.some((c) => c.start === candidate.chapterStart);
      return [
        {
          ...candidate,
          chapterStart: chapterExists ? candidate.chapterStart : null,
          score: Math.min(10, Math.max(1, Math.round(candidate.score))),
        },
      ];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  return { ...analysis, shortsCandidates };
}

// ---------- Claude 호출 ----------

export async function analyzeChannel(
  channel: Channel,
  videos: Video[],
  client: Anthropic = new Anthropic(),
): Promise<ChannelAnalysis> {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
    messages: [{ role: "user", content: buildPrompt(channel, videos) }],
  });

  if (res.stop_reason === "refusal") {
    const category = res.stop_details?.category;
    throw new Error(
      `Claude가 채널 분석 요청을 거절했습니다${category ? ` (${category})` : ""}. 다른 채널로 시도해 보세요.`,
    );
  }
  if (!res.parsed_output) {
    throw new Error(`Claude 응답에서 분석 결과를 읽지 못했습니다 (stop_reason: ${res.stop_reason}).`);
  }
  return validateAnalysis(res.parsed_output, videos);
}
