import { useState } from "react";
import type { Channel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { bestTag, saveVersionPref, tagLabel, versionTags } from "@/lib/versions";

/**
 * Ficha do filme/serie: as versoes que existem (Dublado, Legendado, HD, FHD, 4K, Cinema) para escolher antes do
 * play. A escolha vira a preferencia do perfil (o play e os proximos titulos abrem nela quando existir).
 */
export default function VersionPicker({ items, name = "" }: { items: Channel[]; /** Serie: nome dela, para achar "[L]" quando o episodio nao diz. */ name?: string }) {
  const tags = versionTags(items, name);
  const [picked, setPicked] = useState(() => bestTag(tags, items[0]?.tag));
  if (!tags.length) return null;
  const active = tags.includes(picked) ? picked : bestTag(tags);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Versão</span>
      {tags.map((tag) => (
        <button
          key={tag}
          aria-pressed={tag === active}
          onClick={() => {
            saveVersionPref(tag);
            setPicked(tag);
          }}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
            tag === active ? "border-transparent bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {tagLabel(tag, tags)}
        </button>
      ))}
    </div>
  );
}
