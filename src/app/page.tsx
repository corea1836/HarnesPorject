import type { ReactNode } from "react";
import { analyzeChannel, type ChannelAnalysis } from "@/lib/claude";
import { fetchChannelData, type Channel, type Video } from "@/lib/youtube";

// 빌드 시 미리 렌더하지 않고 요청마다 수집·분석한다.
export const dynamic = "force-dynamic";

const ENV_KEYS = ["YOUTUBE_CHANNEL_URL", "YOUTUBE_API_KEY", "ANTHROPIC_API_KEY"] as const;
const TOP_VIDEOS = 10;

const integer = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("ko-KR", { notation: "compact" });
const ratio = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("ko-KR", { style: "percent", maximumFractionDigits: 0 });
const percent1 = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

type Result =
  | { kind: "report"; channel: Channel; videos: Video[]; analysis: ChannelAnalysis }
  | { kind: "empty"; channel: Channel }
  | { kind: "error"; message: string };

export default async function Page() {
  const missing = ENV_KEYS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    return (
      <Shell>
        <Notice title="설정이 필요합니다">
          <p>다음 환경 변수가 비어 있습니다.</p>
          <ul className="list-disc pl-5">
            {missing.map((key) => (
              <li key={key}>
                <code>{key}</code>
              </li>
            ))}
          </ul>
          <p>
            <code>.env.example</code>을 <code>.env.local</code>로 복사해 값을 채운 뒤
            새로고침하세요.
          </p>
        </Notice>
      </Shell>
    );
  }

  // ANTHROPIC_API_KEY는 SDK가 env에서 직접 읽는다.
  const result = await analyze(process.env.YOUTUBE_CHANNEL_URL!, process.env.YOUTUBE_API_KEY!);

  if (result.kind === "error") {
    return (
      <Shell>
        <Notice title="분석에 실패했습니다">
          <p>{result.message}</p>
        </Notice>
      </Shell>
    );
  }
  if (result.kind === "empty") {
    return (
      <Shell>
        <Notice title="분석할 영상이 없습니다">
          <p>「{result.channel.title}」 채널의 최근 업로드에서 분석할 수 있는 영상을 찾지 못했습니다.</p>
        </Notice>
      </Shell>
    );
  }

  const { channel, videos, analysis } = result;
  return (
    <Shell>
      <Overview channel={channel} videos={videos} />
      <Summary analysis={analysis} />
      <TopVideos videos={videos} />
      <Candidates analysis={analysis} videos={videos} />
    </Shell>
  );
}

async function analyze(channelUrl: string, youtubeKey: string): Promise<Result> {
  try {
    const { channel, videos } = await fetchChannelData(channelUrl, youtubeKey);
    if (videos.length === 0) return { kind: "empty", channel };
    const analysis = await analyzeChannel(channel, videos);
    return { kind: "report", channel, videos, analysis };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------- 레이아웃 ----------

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-10 px-6 py-10 text-neutral-900">
      <p className="text-sm font-semibold text-neutral-500">Shorts Scout</p>
      {children}
    </main>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded border border-neutral-300 p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="space-y-2 text-neutral-700">{children}</div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="border-b border-neutral-200 pb-2 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function VideoLink({ id, title, seconds }: { id: string; title: string; seconds?: number }) {
  const href = `https://www.youtube.com/watch?v=${id}${seconds === undefined ? "" : `&t=${seconds}s`}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-700 underline-offset-2 hover:underline"
    >
      {title}
    </a>
  );
}

// ---------- 섹션 ----------

function Overview({ channel, videos }: { channel: Channel; videos: Video[] }) {
  const shortsCount = videos.filter((v) => v.isShort).length;
  const stats = [
    ["구독자", channel.subscribers === null ? "비공개" : compact.format(channel.subscribers)],
    ["분석 영상", `${integer.format(videos.length)}개 (최근 업로드)`],
    ["쇼츠 비중", percent.format(shortsCount / videos.length)],
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{channel.title}</h1>
        <p className="text-sm text-neutral-500">새로고침하면 다시 분석합니다</p>
      </div>
      <dl className="grid grid-cols-3 gap-4 rounded border border-neutral-200 p-4">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-neutral-500">{label}</dt>
            <dd className="text-lg font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Summary({ analysis }: { analysis: ChannelAnalysis }) {
  return (
    <Section title="이 채널은 어떤 콘텐츠를 하나">
      <p className="leading-relaxed">{analysis.channelSummary}</p>
      <dl className="space-y-2">
        {analysis.categories.map((category) => (
          <div key={category.name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="shrink-0 font-medium sm:w-40">{category.name}</dt>
            <dd className="text-neutral-700">{category.description}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function TopVideos({ videos }: { videos: Video[] }) {
  const top = [...videos].sort((a, b) => b.outlierScore - a.outlierScore).slice(0, TOP_VIDEOS);

  return (
    <Section title={`지금 뜨는 영상 Top ${TOP_VIDEOS}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th className="py-2 pr-4 font-medium">제목</th>
              <th className="py-2 pr-4 font-medium whitespace-nowrap">형식</th>
              <th className="py-2 pr-4 font-medium whitespace-nowrap">업로드일</th>
              <th className="py-2 pr-4 text-right font-medium whitespace-nowrap">조회수</th>
              <th className="py-2 pr-4 text-right font-medium whitespace-nowrap">일평균 조회수</th>
              <th className="py-2 pr-4 text-right font-medium whitespace-nowrap">평소 대비</th>
              <th className="py-2 text-right font-medium whitespace-nowrap">참여율</th>
            </tr>
          </thead>
          <tbody>
            {top.map((video) => (
              <tr key={video.id} className="border-b border-neutral-100 align-top">
                <td className="py-2 pr-4">
                  <VideoLink id={video.id} title={video.title} />
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">{video.isShort ? "쇼츠" : "롱폼"}</td>
                <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                  {video.publishedAt.slice(0, 10)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{compact.format(video.views)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {integer.format(video.viewsPerDay)}
                </td>
                <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                  {ratio.format(video.outlierScore)}배
                </td>
                <td className="py-2 text-right tabular-nums">
                  {percent1.format(video.engagementRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Candidates({ analysis, videos }: { analysis: ChannelAnalysis; videos: Video[] }) {
  const videosById = new Map(videos.map((v) => [v.id, v]));
  // validateAnalysis가 없는 영상 ID를 이미 제거했지만 타입상 한 번 더 거른다.
  const candidates = analysis.shortsCandidates.flatMap((candidate) => {
    const video = videosById.get(candidate.videoId);
    return video ? [{ candidate, video }] : [];
  });

  return (
    <Section title="쇼츠 후보">
      {candidates.length === 0 ? (
        <p className="text-neutral-500">추천할 쇼츠 후보가 없습니다</p>
      ) : (
        <ol className="space-y-4">
          {candidates.map(({ candidate, video }, i) => (
            <li
              key={i}
              className="space-y-2 rounded border border-neutral-200 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <p>
                  <VideoLink id={video.id} title={video.title} />
                  <span className="ml-2 text-sm whitespace-nowrap text-neutral-500">
                    평소 대비 {ratio.format(video.outlierScore)}배
                  </span>
                </p>
                <p className="shrink-0 font-semibold text-blue-700 tabular-nums">
                  {candidate.score} / 10
                </p>
              </div>
              <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-sm">
                <dt className="text-neutral-500">구간</dt>
                <dd>
                  <Segment video={video} chapterStart={candidate.chapterStart} />
                </dd>
                <dt className="text-neutral-500">훅</dt>
                <dd className="font-medium">{candidate.hook}</dd>
                <dt className="text-neutral-500">이유</dt>
                <dd className="text-neutral-700">{candidate.reason}</dd>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Segment({ video, chapterStart }: { video: Video; chapterStart: string | null }) {
  const index = video.chapters.findIndex((c) => c.start === chapterStart);
  if (index === -1) return <span className="text-neutral-500">구간 정보 없음 — 영상 전체 검토</span>;

  const chapter = video.chapters[index];
  const end = video.chapters[index + 1]?.start ?? "끝";
  return (
    <>
      <VideoLink id={video.id} title={`${chapter.start} ~ ${end}`} seconds={chapter.seconds} />
      {chapter.title && <span className="ml-2">「{chapter.title}」</span>}
    </>
  );
}
