import Link from "next/link";
import type { ReactNode } from "react";
import type { ArtistDetail, TrackDetail } from "@/lib/types";
import { energyColor, formatDuration, year } from "@/lib/ui";
import { DataRow } from "./StatNumber";
import { Tag } from "./Tag";
import { Credits } from "./Credits";
import { Connections } from "./Connections";
import { LinerNote } from "./LinerNote";
import { Recommendations } from "./Recommendations";
import { AddToList } from "./AddToList";

// One component serves both /track and /artist. The whole core record renders
// from a single server query (no client follow-ups). Fact vs Claude-inference is
// visually unambiguous throughout.
type Props = { kind: "track"; track: TrackDetail } | { kind: "artist"; artist: ArtistDetail };

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-hairline pt-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-faint">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DetailView(props: Props) {
  if (props.kind === "track") return <TrackDetailView t={props.track} />;
  return <ArtistDetailView a={props.artist} />;
}

function TrackDetailView({ t }: { t: TrackDetail }) {
  const facts = [
    t.release?.label,
    t.release?.country,
    t.release?.year ?? year(t.release_date),
    formatDuration(t.duration_sec),
  ].filter(Boolean);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-display leading-none text-bone">{t.title}</h1>
        <p className="text-lg text-sand">
          {t.artists.length ? (
            t.artists.map((a, i) => (
              <span key={a.artist_id + a.role}>
                {i > 0 && ", "}
                <Link href={`/artist/${a.artist_id}`} prefetch={false} className="hover:text-bone">
                  {a.name}
                </Link>
              </span>
            ))
          ) : (
            <span>{t.artist_name}</span>
          )}
          {t.album_title ? <span className="text-faint"> · {t.album_title}</span> : null}
        </p>
        {facts.length > 0 && <p className="text-sm text-faint">{facts.join(" · ")}</p>}
      </header>

      {/* instrument readout */}
      <div className="grid grid-cols-2 gap-x-8 rounded-lg border border-hairline bg-surface px-4 py-3 sm:grid-cols-3">
        <DataRow label="BPM">{t.bpm ? Math.round(Number(t.bpm)) : "—"}</DataRow>
        <DataRow label="Key">{t.musical_key ?? "—"}</DataRow>
        <DataRow label="Energy">
          {t.energy != null ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-16 overflow-hidden rounded-full bg-raised">
                <span className="block h-full" style={{ width: `${(t.energy / 10) * 100}%`, background: energyColor(t.energy) }} />
              </span>
              {t.energy}
            </span>
          ) : (
            "—"
          )}
        </DataRow>
      </div>

      {/* tags — verified vs inferred, always distinguishable */}
      <Section title="Tags">
        <div className="flex flex-wrap gap-2">
          {t.tags.map((g, i) => (
            <Tag key={`tag-${i}`} label={g.value ?? g.tag} source={g.source} confidence={g.confidence} />
          ))}
          {(t.mood ?? []).map((m, i) => (
            <Tag key={`mood-${i}`} label={m} source="claude" confidence={null} />
          ))}
          {t.tags.length === 0 && (t.mood ?? []).length === 0 && <span className="text-sm text-faint">No tags yet.</span>}
        </div>
      </Section>

      <Section title="Credits" action={<AddToList trackId={t.id} title={t.title} />}>
        <Credits credits={t.credits} />
      </Section>

      {t.narrative && (
        <Section title="Liner note">
          <LinerNote narrative={t.narrative} />
        </Section>
      )}

      <Section title="Dig deeper">
        <Recommendations />
      </Section>
    </article>
  );
}

function ArtistDetailView({ a }: { a: ArtistDetail }) {
  const facts = [a.origin_city, a.origin_country, a.scene, a.began_year ? `since ${a.began_year}` : null].filter(Boolean);
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-display leading-none text-bone">{a.name}</h1>
        {facts.length > 0 && <p className="text-sm text-faint">{facts.join(" · ")}</p>}
      </header>

      <Section title={`In your library (${a.tracks.length})`}>
        <ul className="flex flex-col">
          {a.tracks.map((tr) => (
            <li key={tr.id}>
              <Link
                href={`/track/${tr.id}`}
                prefetch={false}
                className="flex items-center gap-3 border-b border-hairline py-2.5 hover:bg-surface"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: energyColor(tr.energy) }} />
                <span className="flex-1 truncate text-bone">{tr.title}</span>
                <span className="truncate text-sm text-faint">{tr.album_title ?? ""}</span>
              </Link>
            </li>
          ))}
          {a.tracks.length === 0 && <li className="py-3 text-sm text-faint">No saved tracks.</li>}
        </ul>
      </Section>

      <Section title="The Web">
        <Connections edges={a.connections} />
      </Section>

      {a.narrative && (
        <Section title="Liner note">
          <LinerNote narrative={a.narrative} />
        </Section>
      )}

      <Section title="Dig deeper">
        <Recommendations />
      </Section>
    </article>
  );
}
